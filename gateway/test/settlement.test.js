import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEVNET_RPC, querySettlement, verifySettlement, publicBuyerRun, contactPolicy, verifyRefund, refundMemo } from '../../docs/settlement.mjs';

// Minimal public RPC fixture derived from the recorded October 1 transaction.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/settlement-rpc.json', import.meta.url)));
const purchase = JSON.parse(readFileSync(new URL('../../docs/evidence/device-signed-purchase.json', import.meta.url))).purchase;

test('refund proves the reverse transfer and binds its memo to the original failed purchase', () => {
  const p = { purchase_id: '0123456789abcdef', settlement: purchase.settlement };
  const result = structuredClone(fixture), tx = '4'.repeat(88);
  result.transaction.signatures[0] = tx;
  [result.meta.preTokenBalances, result.meta.postTokenBalances] = [result.meta.postTokenBalances, result.meta.preTokenBalances];
  const transfer = result.transaction.message.instructions.find(ix => ix.parsed?.type === 'transferChecked');
  [transfer.parsed.info.source, transfer.parsed.info.destination] = [transfer.parsed.info.destination, transfer.parsed.info.source];
  transfer.parsed.info.authority = 'CaQAKBcwf7G5vXeu2RNuNGJafnJ8724Uj4wv9ivfxfQA';
  result.transaction.message.instructions.push({ programId: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', parsed: refundMemo(p) });
  assert.equal(verifyRefund(result, p, tx).payer_delta_base_units, '1000');
  assert.equal(verifyRefund(result, p, tx).merchant_delta_base_units, '-1000');
  assert.throws(() => verifyRefund(result, p, p.settlement.transaction), /separate/);
  assert.throws(() => verifyRefund(result, { ...p, purchase_id: 'fedcba9876543210' }, tx), /memo/);
  transfer.parsed.info.tokenAmount.amount = '2000';
  assert.throws(() => verifyRefund(result, p, tx), /transfer instruction/);
});

test('package view requires explicit new GPIO20 buyer terms and never relabels GPIO9 records', () => {
  assert.throws(() => publicBuyerRun(purchase, 'package-pickup'));
  const p = structuredClone(purchase);
  p.purpose = 'package-pickup';
  p.challenge.contact = { provider: 'esp32-c6-96a2', sensor: 'gpio20-contact' };
  p.receipt.result.sensor = 'gpio20-contact';
  assert.equal(publicBuyerRun(p, 'package-pickup').receipt.result.sensor, 'gpio20-contact');
  assert.throws(() => publicBuyerRun(p));
  delete p.purpose;
  assert.throws(() => publicBuyerRun(p, 'package-pickup'));
  const policy = contactPolicy('package-pickup', 'gpio20-contact');
  assert.equal(policy.state(false), 'PACKAGE_ABSENT');
  assert.equal(policy.state(true), 'PACKAGE_PRESENT');
  assert.equal(policy.decision(true, true), 'DISPATCH');
  assert.equal(policy.decision(true, false), 'WAIT');
  assert.equal(policy.decision(false, true), 'WAIT');
  assert.equal(policy.decision(true, undefined), 'WAIT');
});

test('buyer inspection selects public contract fields without trusting a supplied key or decision', () => {
  const input = structuredClone(purchase);
  input.secret = 'PRIVATE FIXTURE';
  input.receipt_public_key = 'UNTRUSTED';
  input.receipt.result.extra = 'PRIVATE FIXTURE';
  input.decision = { decision: 'DISPATCH' };
  const result = publicBuyerRun({ purchase: input, secret: 'PRIVATE FIXTURE' });
  assert.equal(result.receipt.receipt_signature, purchase.receipt.receipt_signature);
  assert.equal(result.challenge.nonce, purchase.challenge.nonce);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE FIXTURE|UNTRUSTED|decision/);
  assert.deepEqual(Object.keys(result).sort(), ['challenge', 'purchase_id', 'receipt', 'settlement']);
});

test('buyer inspection rejects wallet arrays, mismatched contract, challenge, and payment fields', () => {
  const changes = [
    p => { p.challenge.nonce += 1; },
    p => { p.purchase_id = p.challenge.id = p.receipt.request_id = 1234567890123456; },
    p => { p.challenge.contact = { provider: 'esp32-c6-96a2', sensor: 'gpio18-contact' }; },
    p => { p.challenge.contact = { provider: 'another-board', sensor: 'gpio9-contact' }; },
    p => { p.receipt.parameters.extra = 'unsupported'; },
    p => { p.receipt.provider = 'another-board'; },
    p => { p.receipt.result.sensor = 'gpio18-contact'; },
    p => { p.receipt.result.closed = 'false'; },
    p => { p.receipt.result.stable_samples = 4; },
    p => { p.challenge.max_age_seconds = 100; },
    p => { p.receipt.started_at = 0; },
    p => { p.receipt.receipt_signature += '='; },
    p => { p.settlement.success = false; },
    p => { p.settlement.network = 'mainnet'; },
  ];
  for (const change of changes) {
    const input = structuredClone(purchase); change(input);
    assert.throws(() => publicBuyerRun(input));
  }
  assert.throws(() => publicBuyerRun(Array(64).fill(1)));
  assert.throws(() => publicBuyerRun({ status: 'failed' }));
});

test('chain check confirms the exact recorded transfer, independently of the stored chain summary', () => {
  const proof = verifySettlement(structuredClone(fixture), purchase);
  assert.equal(proof.payer_delta_base_units, '-1000');
  assert.equal(proof.merchant_delta_base_units, '1000');
  assert.equal(proof.slot, 506374923);
});

test('chain check rejects failed transactions, another signature, mint, owner, amount, and instruction', () => {
  const changes = [
    r => { r.meta.err = { InstructionError: [2, 'failed'] }; },
    r => { r.transaction.signatures[0] = 'another-transaction'; },
    r => { r.meta.postTokenBalances[0].mint = 'another-mint'; },
    r => { r.meta.postTokenBalances[0].owner = purchase.settlement.payer; },
    r => { r.meta.postTokenBalances[0].uiTokenAmount.amount = '86615401'; },
    r => { r.meta.preTokenBalances[0].uiTokenAmount.amount = 86614400; },
    r => { r.meta.postTokenBalances.push(r.meta.postTokenBalances[0]); },
    r => { r.transaction.message.instructions[0].parsed.info.authority = 'another-payer'; },
    r => { r.transaction.message.instructions[0].programId = 'impostor-token-program'; },
    r => { r.transaction.message.instructions[0].parsed.info.tokenAmount.amount = '999'; },
    r => { r.meta.innerInstructions = [{ instructions: null }]; },
    r => { r.transaction.message.instructions.unshift(null); },
  ];
  for (const change of changes) {
    const result = structuredClone(fixture);
    change(result);
    assert.throws(() => verifySettlement(result, purchase));
  }
  assert.throws(() => verifySettlement(null, purchase), /cannot find/);
  assert.throws(() => verifySettlement(fixture, { settlement: { ...purchase.settlement, network: 'mainnet' } }), /supported/);
});

test('chain check accepts a matching inner transfer instruction', () => {
  const result = structuredClone(fixture);
  result.meta.innerInstructions = [{ index: 0, instructions: result.transaction.message.instructions }];
  result.transaction.message.instructions = [];
  assert.equal(verifySettlement(result, purchase).merchant_delta_base_units, '1000');
});

test('RPC request is read-only, Devnet-only, and correlates the response', async () => {
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(url, DEVNET_RPC);
    const body = JSON.parse(options.body);
    assert.equal(body.method, 'getTransaction');
    assert.deepEqual(body.params, [purchase.settlement.transaction,
      { commitment: 'confirmed', encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
    return Response.json({ jsonrpc: '2.0', id: body.id, result: fixture });
  };
  assert.equal((await querySettlement(purchase, fetcher)).network, 'Solana Devnet');
  await assert.rejects(querySettlement({ settlement: { ...purchase.settlement, network: 'mainnet' } }, fetcher), /supported/);
  assert.equal(calls, 1);
  await assert.rejects(querySettlement(purchase, async () => Response.json({ jsonrpc: '2.0', id: 'wrong', result: fixture })), /correlated/);
  await assert.rejects(querySettlement(purchase, async () => new Response('', { status: 429 })), /HTTP 429/);
  await assert.rejects(querySettlement(purchase, async () => { throw new Error('Network unavailable'); }), /Network unavailable/);
  await assert.rejects(querySettlement(purchase, async () => { throw new TypeError('Failed to fetch'); }), /cannot reach Solana Devnet/);
  await assert.rejects(querySettlement(purchase, async () => new Response('not json')), /invalid JSON/);
  await assert.rejects(querySettlement(purchase, async () => new Response('x'.repeat(262145))), /inspection limit/);
});
