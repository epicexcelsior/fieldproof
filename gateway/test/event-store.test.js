import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PurchaseStore } from '../store.js';
import { EventStore } from '../event-store.js';
import { createJob } from '../job.js';
import { jobFixture } from './fixtures/job.js';

function delivered(store, fixture) {
  store.create({ ...fixture.run.challenge, expires_at: fixture.now + 120, receipt_public_key: fixture.policy.receipt_public_key });
  store.finish(fixture.run.purchase_id, 'delivered', { settlement: fixture.run.settlement, result: { receipt: fixture.run.receipt } });
  return createJob(fixture.run, fixture.policy, fixture.identity, fixture.now);
}

test('outbox rejects unpaid, changed, or duplicate contradictory jobs', () => {
  const store = new PurchaseStore(':memory:'), events = new EventStore(store), f = jobFixture();
  try {
    const envelope = createJob(f.run, f.policy, f.identity, f.now);
    assert.throws(() => events.enqueue(envelope, f.policy), /delivered purchase/);
    delivered(store, f);
    assert.equal(events.enqueue(envelope, f.policy).state, 'pending');
    assert.equal(events.enqueue(envelope, f.policy).state, 'pending');
    const changed = { ...f.run, settlement: { ...f.run.settlement, transaction: '3'.repeat(88) } };
    assert.throws(() => events.enqueue(createJob(changed, f.policy, f.identity, f.now), f.policy), /matching delivered/);
    assert.equal(events.list().length, 1);
  } finally { store.close(); }
});

test('interrupted submissions persist and never become retryable after restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fieldproof-outbox-'));
  const path = join(directory, 'purchases.sqlite');
  let store = new PurchaseStore(path);
  const f = jobFixture();
  try {
    let events = new EventStore(store);
    events.enqueue(delivered(store, f), f.policy);
    assert.equal(events.claim(f.run.purchase_id), false);
    events.recordPayment(f.run.purchase_id, f.paymentVerification);
    assert.equal(events.claim(f.run.purchase_id), true);
    assert.equal(events.claim(f.run.purchase_id), false);
    store.close(); store = new PurchaseStore(path); events = new EventStore(store);
    assert.equal(events.recover(), 1);
    assert.equal(events.get(f.run.purchase_id).state, 'uncertain');
    assert.equal(events.claim(f.run.purchase_id), false);
    const transaction = '0x' + 'ab'.repeat(32), hash = '0x' + 'cd'.repeat(32);
    events.recordRecoveredSubmission(f.run.purchase_id, transaction, hash);
    const readback = { verified: true, transaction_hash: transaction, data_hash: hash,
      job_sha256: events.get(f.run.purchase_id).job_sha256, finalized_block: 101 };
    assert.throws(() => events.confirm(f.run.purchase_id, { ...readback, data_hash: '0x' + 'ef'.repeat(32) }), /readback/);
    events.confirm(f.run.purchase_id, readback);
    assert.equal(events.get(f.run.purchase_id).state, 'confirmed');
    assert.equal(events.claim(f.run.purchase_id), false);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('two gateway processes cannot claim one event twice', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fieldproof-outbox-race-'));
  const path = join(directory, 'purchases.sqlite');
  const a = new PurchaseStore(path), b = new PurchaseStore(path), f = jobFixture();
  try {
    const first = new EventStore(a), second = new EventStore(b);
    first.enqueue(delivered(a, f), f.policy);
    first.recordPayment(f.run.purchase_id, f.paymentVerification);
    assert.equal(first.claim(f.run.purchase_id), true);
    assert.equal(second.claim(f.run.purchase_id), false);
  } finally { a.close(); b.close(); rmSync(directory, { recursive: true, force: true }); }
});
