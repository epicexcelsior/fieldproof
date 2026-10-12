import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createTransactionMessage, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
  compileTransaction, getTransactionEncoder, getBase58Encoder, address } from '@solana/kit';
import { devnetRpcUrl, confirmPendingSettlement } from '../devnet-rpc.js';

const purchase = JSON.parse(readFileSync(new URL('../../docs/evidence/device-signed-purchase.json', import.meta.url))).purchase;
const parsed = JSON.parse(readFileSync(new URL('./fixtures/settlement-rpc.json', import.meta.url)));
const pending = { ...purchase.settlement, success: false, errorReason: 'settlement_pending' };
let message = createTransactionMessage({ version: 0 });
message = setTransactionMessageFeePayer(address(purchase.settlement.payer), message);
message = setTransactionMessageLifetimeUsingBlockhash({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1n }, message);
const compiled = compileTransaction(message);
const transaction = { ...compiled, signatures: { [purchase.settlement.payer]: getBase58Encoder().encode(purchase.settlement.transaction) } };
const wire = Buffer.from(getTransactionEncoder().encode(transaction)).toString('base64');
const hash = createHash('sha256').update(compiled.messageBytes).digest('hex');
const raw = { slot: parsed.slot, meta: { err: null }, transaction: [wire, 'base64'] };

test('Helius configuration is Devnet-only and invalid or unreadable keys never enter errors', () => {
  assert.equal(devnetRpcUrl({}), 'https://api.devnet.solana.com');
  const u = new URL(devnetRpcUrl({ HELIUS_API_KEY: 'test-key-not-a-real-key' }));
  assert.equal(u.hostname, 'devnet.helius-rpc.com');
  assert.equal(u.protocol, 'https:');
  assert.equal(devnetRpcUrl({ FIELDPROOF_HELIUS_KEY_FILE: 'private-file' }, () => 'test-key-not-a-real-key\n'), u.href);
  assert.throws(() => devnetRpcUrl({ HELIUS_API_KEY: 'invalid&key=PRIVATE' }), error => !error.message.includes('PRIVATE'));
  assert.throws(() => devnetRpcUrl({ FIELDPROOF_HELIUS_KEY_FILE: 'private-file' }, () => { throw new Error('PRIVATE'); }), error => !error.message.includes('PRIVATE'));
});

function query(override) {
  return async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.method, 'getTransaction');
    assert.equal(request.params[0], pending.transaction);
    assert.equal(request.params[1].commitment, 'confirmed');
    const result = request.params[1].encoding === 'jsonParsed' ? parsed : override ?? raw;
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  };
}

test('a pending settlement proceeds only after the exact transfer and original signed message match', async () => {
  const result = await confirmPendingSettlement(pending, hash, query());
  assert.equal(result.success, true);
  assert.equal(result.transaction, pending.transaction);
  await assert.rejects(confirmPendingSettlement(pending, '0'.repeat(64), query()), /signed message/);
  await assert.rejects(confirmPendingSettlement(pending, hash, query({ ...raw, slot: raw.slot + 1 })), /not confirmed/);
  await assert.rejects(confirmPendingSettlement(pending, hash, query({ ...raw, meta: { err: 'failed' } })), /not confirmed/);
  await assert.rejects(confirmPendingSettlement(pending, hash, async () => new Response('', { status: 429 })), /HTTP 429/);
  await assert.rejects(confirmPendingSettlement({ ...pending, errorReason: 'invalid_payment' }, hash, query()), /exact pending/);
});
