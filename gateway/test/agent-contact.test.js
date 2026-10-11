import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { contactToolPreview, runContactOperation } from '../agent-contact.js';
import { PAY_TO, NETWORK, USDC } from '../constants.js';
import { inspectSource } from '../../docs/jobs.mjs';

// Reuse original recorded bytes. The test clock does not represent a new physical capture.
const { purchase } = JSON.parse(await readFile(new URL('../../docs/evidence/device-signed-purchase.json', import.meta.url), 'utf8'));

async function options(t, extra = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'fieldproof-agent-contact-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, operation: randomUUID(), signer: { address: purchase.settlement.payer },
    readPurchaseState: () => 'delivered', now: () => purchase.receipt.completed_at,
    buy: async (_signer, _origin, config) => {
      config.onProgress({ phase: 'request', purchase_id: purchase.purchase_id });
      config.onProgress({ phase: 'verified', purchase_id: purchase.purchase_id });
      return structuredClone(purchase);
    }, verifyPayment: async () => ({ transaction: purchase.settlement.transaction }), ...extra };
}

test('agent no-spend preview pins Devnet, recipient, device key, budget and no peaq claim', () => {
  const preview = contactToolPreview();
  assert.equal(preview.status, 'configuration_checked'); assert.equal(preview.spending, false);
  assert.deepEqual(preview.payment, { network: NETWORK, asset: USDC, recipient: PAY_TO, maximum_base_units: '1000', kind: 'test-token' });
  assert.equal(preview.maximum_operations, 10); assert.equal(preview.max_age_seconds, 10);
  assert.match(preview.receipt_public_key, /^04[0-9a-f]{128}$/); assert.equal(preview.peaq, 'not_used');
  for (const origin of ['https://127.0.0.1:4021', 'http://example.com', 'http://user:password@127.0.0.1:4021',
    'http://127.0.0.1:4021/path', 'http://127.0.0.1:4021?query=true']) assert.throws(() => contactToolPreview(origin));
});

test('same agent operation pays once across restart and checks current age without refreshing evidence', async t => {
  let payments = 0, queries = 0, reported = false;
  const config = await options(t);
  const originalBuy = config.buy;
  config.report = event => { assert.equal(event.operation_id, config.operation); reported = true; };
  config.buy = async (signer, origin, terms) => {
    assert.equal(reported, true); payments++;
    assert.equal(terms.contact.sensor, 'gpio9-contact'); assert.equal(Object.hasOwn(terms, 'peaq'), false);
    return originalBuy(signer, origin, terms);
  };
  config.verifyPayment = async saved => { queries++; assert.equal(saved.receipt.completed_at, purchase.receipt.completed_at);
    return { transaction: purchase.settlement.transaction }; };
  const first = await runContactOperation(config);
  assert.equal(first.current_decision, 'DISPATCH'); assert.equal(first.peaq, 'not_used');
  assert.equal(first.commercial_revenue, false); assert.equal(Object.hasOwn(first, 'job'), false);
  const inspected = await inspectSource(first, { pin: contactToolPreview().receipt_public_key, now: purchase.receipt.completed_at });
  assert.equal(inspected.signature, true); assert.equal(inspected.terms, true);
  config.now = () => purchase.receipt.completed_at + 11;
  const second = await runContactOperation(config);
  assert.equal(second.current_decision, 'WAIT'); assert.equal(second.current_evidence, 'unusable');
  assert.deepEqual(second.purchase, first.purchase); assert.equal(payments, 1); assert.equal(queries, 2);
});

test('payment query failure preserves accepted evidence and a repeat operation performs only a read', async t => {
  let payments = 0;
  const config = await options(t), originalBuy = config.buy;
  config.buy = async (...args) => { payments++; return originalBuy(...args); };
  config.verifyPayment = async () => { throw new Error('private RPC diagnostics must not appear'); };
  const first = await runContactOperation(config);
  assert.equal(first.status, 'done'); assert.equal(first.payment_verification.state, 'unavailable');
  assert.equal(first.current_decision, 'WAIT'); assert.equal(JSON.stringify(first).includes('private RPC'), false);
  config.verifyPayment = async () => ({ transaction: purchase.settlement.transaction });
  const second = await runContactOperation(config);
  assert.equal(second.payment_verification.state, 'verified'); assert.equal(payments, 1);
});

test('age is checked after a slow independent query and cannot retain DISPATCH', async t => {
  let clock = purchase.receipt.completed_at;
  const config = await options(t, { now: () => clock, verifyPayment: async () => {
    clock += 11; return { transaction: purchase.settlement.transaction };
  } });
  const result = await runContactOperation(config);
  assert.equal(result.payment_verification.state, 'verified'); assert.equal(result.current_decision, 'WAIT');
});

test('unknown paid outcome blocks another operation and invalid input never reaches the signer', async t => {
  let attempts = 0;
  const config = await options(t, { buy: async (_signer, _origin, terms) => {
    attempts++; terms.onProgress({ phase: 'paying', purchase_id: purchase.purchase_id });
    throw new Error('Payment outcome is unknown');
  } });
  await assert.rejects(runContactOperation({ ...config, operation: 'invalid' }), /UUID/);
  assert.equal(attempts, 0);
  await assert.rejects(runContactOperation(config), /Keep operation/);
  await assert.rejects(runContactOperation({ ...config, operation: randomUUID() }), /earlier purchase requires review/);
  assert.equal(attempts, 1);
});
