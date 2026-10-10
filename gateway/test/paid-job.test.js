import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PurchaseStore } from '../store.js';
import { EventStore } from '../event-store.js';
import { performPaidJob } from '../paid-job.js';
import { jobFixture } from './fixtures/job.js';

test('paid job saves evidence before payment verification and blocks submission and refuses a paid retry on query failure', async () => {
  const f = jobFixture(Math.floor(Date.now() / 1000));
  const directory = mkdtempSync(join(tmpdir(), 'fieldproof-paid-job-'));
  const policyPath = join(directory, 'policy.json'); writeFileSync(policyPath, JSON.stringify(f.policy));
  const purchases = new PurchaseStore(':memory:'); const events = new EventStore(purchases);
  purchases.create({ ...f.run.challenge, expires_at: f.now + 120, receipt_public_key: f.policy.receipt_public_key });
  purchases.finish(f.run.purchase_id, 'delivered', { settlement: f.run.settlement, result: { receipt: f.run.receipt } });
  let paymentChecks = 0;
  const buy = async (_signer, _origin, options) => {
    assert.equal(options.peaq.policy.machine_id, f.policy.machine_id);
    assert.equal(options.receiptPublicKey, f.policy.receipt_public_key);
    return { ...f.run, peaq_identity: f.identity };
  };
  try {
    await assert.rejects(performPaidJob({ policyPath, events, buy, verifyPayment: async () => { paymentChecks++; throw new Error('RPC unavailable'); } }),
      /Payment settled.*0123456789abcdef.*No new payment/);
    assert.equal(events.list().length, 1);
    assert.equal(events.get(f.run.purchase_id).settlement_verified, 0);
    assert.equal(events.claim(f.run.purchase_id), false);
    const result = await performPaidJob({ policyPath, events, buy,
      verifyPayment: async run => { paymentChecks++; assert.equal(run.settlement.transaction, f.run.settlement.transaction); return f.paymentVerification; } });
    assert.equal(result.job.job_id, f.run.purchase_id);
    assert.equal(result.peaq_event.state, 'pending');
    assert.equal(paymentChecks, 2);
    assert.equal(events.list().length, 1);
  } finally { purchases.close(); rmSync(directory, { recursive: true, force: true }); }
});
