import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalBuyer } from '../local-buyer.js';
import { PurchaseStore } from '../store.js';
import { EventStore } from '../event-store.js';
import { createJob } from '../job.js';
import { recoverSavedBuyer } from '../peaq-event.js';
import { jobFixture } from './fixtures/job.js';

function fixture(t) {
  const f = jobFixture(), directory = mkdtempSync(join(tmpdir(), 'fieldproof-recovery-'));
  const purchases = new PurchaseStore(':memory:'), events = new EventStore(purchases), operation = randomUUID();
  t.after(() => { purchases.close(); rmSync(directory, { recursive: true, force: true }); });
  purchases.create({ ...f.run.challenge, expires_at: f.now + 120, receipt_public_key: f.policy.receipt_public_key });
  purchases.finish(f.run.purchase_id, 'delivered', { settlement: f.run.settlement, result: { receipt: f.run.receipt } });
  events.enqueue(createJob(f.run, f.policy, f.identity, f.now), f.policy);
  writeFileSync(join(directory, operation + '.json'), JSON.stringify({ operation_id: operation, purchase_id: f.run.purchase_id,
    status: 'review', events: [], started_ms: 100, elapsed_ms: 1000 }), { mode: 0o600 });
  return { ...f, id: f.run.purchase_id, directory, events, operation,
    query: async request => { assert.equal(request.settlement.transaction, f.run.settlement.transaction); return f.paymentVerification; } };
}

test('reviewed recovery keeps the original job, never buys, and retains the operation budget', async t => {
  const f = fixture(t);
  const result = await recoverSavedBuyer(f);
  assert.equal(result.spending, false);
  assert.equal(result.remaining, 9);
  assert.equal((await recoverSavedBuyer(f)).remaining, 9);
  let purchases = 0;
  const controller = createLocalBuyer({ directory: f.directory, payer: f.run.settlement.payer, payTo: f.policy.pay_to,
    maximum: 1, readPurchaseState: () => 'delivered', buy: () => { purchases++; } });
  try {
    assert.equal(controller.status(f.operation).run.receipt.completed_at, f.run.receipt.completed_at);
    assert.equal(controller.start(randomUUID()).code, 429);
    assert.equal(purchases, 0);
  } finally { controller.close(); }
});

test('failed payment verification or mismatched operation cannot clear review', async t => {
  const f = fixture(t);
  await assert.rejects(recoverSavedBuyer({ ...f, query: async () => { throw new Error('RPC unavailable'); } }), /RPC unavailable/);
  await assert.rejects(recoverSavedBuyer({ ...f, operation: randomUUID() }), /preserved operation/);
  const controller = createLocalBuyer({ directory: f.directory, payer: f.run.settlement.payer, payTo: f.policy.pay_to,
    readPurchaseState: () => 'delivered', buy: () => assert.fail('No purchase') });
  try { assert.equal(controller.status(f.operation).status, 'review'); assert.equal(controller.config().blocked, true); }
  finally { controller.close(); }
});

test('a running buyer lock blocks recovery without spending or deleting the lock', async t => {
  const f = fixture(t);
  const controller = createLocalBuyer({ directory: f.directory, payer: f.run.settlement.payer, payTo: f.policy.pay_to,
    readPurchaseState: () => 'delivered', buy: () => assert.fail('No purchase') });
  try { await assert.rejects(recoverSavedBuyer(f), /EEXIST/); assert.equal(controller.config().blocked, true); }
  finally { controller.close(); }
});
