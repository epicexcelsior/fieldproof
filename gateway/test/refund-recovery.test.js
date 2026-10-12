import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PurchaseStore } from '../store.js';
import { createLocalBuyer, inspectLocalBuyer, recoverBuyerLockForReview } from '../local-buyer.js';
import { reconcileRefund } from '../reconcile-refund.js';
import { PAY_TO, USDC } from '../constants.js';

const purchase = JSON.parse(readFileSync(new URL('../../docs/evidence/device-signed-purchase.json', import.meta.url))).purchase;
const original = { network: 'Solana Devnet', slot: 100, transaction: purchase.settlement.transaction,
  mint: USDC, payer: purchase.settlement.payer, merchant: PAY_TO, payer_delta_base_units: '-1000',
  merchant_delta_base_units: '1000', decimals: 6 };
const refund = { ...original, slot: 101, transaction: '4'.repeat(88), original_transaction: original.transaction,
  payer_delta_base_units: '1000', merchant_delta_base_units: '-1000' };

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'fieldproof-refund-')), store = new PurchaseStore(':memory:');
  const operation = randomUUID();
  store.create({ ...purchase.challenge, expires_at: purchase.challenge.created_at + 120 });
  store.finish(purchase.purchase_id, 'delivery_failed', { settlement: purchase.settlement, error: 'Observation failed' });
  const record = { operation_id: operation, purchase_id: purchase.purchase_id, status: 'review', error: 'HTTP 503',
    started_ms: 100, elapsed_ms: 1000, events: [{ phase: 'settled', elapsed_ms: 100 }] };
  writeFileSync(join(directory, operation + '.json'), JSON.stringify(record), { mode: 0o600 });
  t.after(() => { store.close(); rmSync(directory, { force: true, recursive: true }); });
  return { store, directory, operation, record, purchaseId: purchase.purchase_id, transaction: refund.transaction,
    queryPayment: async () => original, queryReturn: async () => refund };
}

test('verified refund releases review without fulfilling the purchase or resetting the budget', async t => {
  const f = fixture(t);
  assert.equal(inspectLocalBuyer(f).blocked, true);
  const outcome = await reconcileRefund(f);
  assert.equal(outcome.status, 'refunded');
  assert.equal(outcome.remaining, 99);
  assert.equal(outcome.blocked, false);
  assert.equal(outcome.spending, false);
  assert.equal(outcome.fulfilled, false);
  assert.deepEqual(JSON.parse(readFileSync(join(f.directory, '.review-' + f.operation + '.json'))), f.record);
  assert.equal(f.store.get(f.purchaseId).state, 'delivery_failed');
  assert.equal(f.store.get(f.purchaseId).result, null);
  assert.equal(inspectLocalBuyer(f).blocked, false);
  assert.deepEqual(await reconcileRefund(f), outcome);
  const controller = createLocalBuyer({ directory: f.directory, payer: original.payer, payTo: PAY_TO,
    buy: () => assert.fail('No new purchase') });
  try {
    assert.equal(controller.start(f.operation).value.status, 'refunded');
    assert.equal(controller.config().remaining, 99);
    assert.equal(controller.status(f.operation).run, undefined);
  } finally { controller.close(); }
});

test('wrong refund, unknown RPC outcome, and unrelated operation retain the review block', async t => {
  const f = fixture(t), path = join(f.directory, f.operation + '.json'), before = readFileSync(path, 'utf8');
  await assert.rejects(reconcileRefund({ ...f, queryReturn: async () => { throw new Error('RPC unavailable'); } }), /RPC unavailable/);
  await assert.rejects(reconcileRefund({ ...f, queryReturn: async () => ({ ...refund, original_transaction: '5'.repeat(88) }) }), /resolution/);
  await assert.rejects(reconcileRefund({ ...f, queryReturn: async () => ({ ...refund, payer_delta_base_units: '999' }) }), /resolution/);
  await assert.rejects(reconcileRefund({ ...f, queryReturn: async () => ({ ...refund, transaction: '5'.repeat(88) }) }), /exact original/);
  await assert.rejects(reconcileRefund({ ...f, operation: randomUUID() }), /preserved/);
  assert.equal(readFileSync(path, 'utf8'), before);
  assert.equal(inspectLocalBuyer(f).blocked, true);
});

test('the running buyer lock prevents refund reconciliation and remains intact', async t => {
  const f = fixture(t);
  const controller = createLocalBuyer({ directory: f.directory, payer: original.payer, payTo: PAY_TO,
    buy: () => assert.fail('No purchase') });
  try {
    await assert.rejects(reconcileRefund(f), /EEXIST/);
    assert.equal(controller.config().blocked, true);
  } finally { controller.close(); }
});

test('a pending facilitator result can resolve only after a verified payment and exact refund', async t => {
  const f = fixture(t);
  const pending = { ...purchase.settlement, success: false, errorReason: 'settlement_pending' };
  f.store.finish(f.purchaseId, 'payment_failed', { settlement: pending, error: 'Facilitator confirmation rate limited' });
  const result = await reconcileRefund(f);
  assert.equal(result.status, 'refunded');
  assert.equal(result.blocked, false);
  assert.equal(result.remaining, 99);
  assert.deepEqual(JSON.parse(f.store.get(f.purchaseId).settlement), pending);
  assert.equal(f.store.get(f.purchaseId).result, null);
});

test('a dead-owner lock can archive for review while the unresolved operation still blocks spending', t => {
  const f = fixture(t);
  writeFileSync(join(f.directory, '.lock'), JSON.stringify({ pid: 1000000, started_at: new Date().toISOString() }));
  for (const ownerState of [() => 'alive', () => 'unknown']) {
    assert.throws(() => recoverBuyerLockForReview({ ...f, ownerState }), /active or unknown/);
  }
  assert.throws(() => recoverBuyerLockForReview({ ...f, purchaseId: 'fedcba9876543210', ownerState: () => 'absent' }), /preserved review/);
  const result = recoverBuyerLockForReview({ ...f, ownerState: () => 'absent' });
  assert.equal(result.recovered, true);
  assert.equal(inspectLocalBuyer(f).blocked, true);
  assert.deepEqual(JSON.parse(readFileSync(join(f.directory, f.operation + '.json'))), f.record);
  assert.equal(inspectLocalBuyer(f).remaining, 99);
});

test('a copied refund cannot resolve a second operation and corrupt refund records fail closed', async t => {
  const f = fixture(t);
  await reconcileRefund(f);
  const duplicate = randomUUID();
  writeFileSync(join(f.directory, duplicate + '.json'), JSON.stringify({ ...f.record, operation_id: duplicate }));
  await assert.rejects(reconcileRefund({ ...f, operation: duplicate }), /already resolves/);
  const saved = JSON.parse(readFileSync(join(f.directory, f.operation + '.json')));
  saved.resolution.refund.mint = 'invalid';
  writeFileSync(join(f.directory, f.operation + '.json'), JSON.stringify(saved));
  assert.equal(inspectLocalBuyer(f).blocked, true);
});
