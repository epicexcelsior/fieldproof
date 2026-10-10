import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { canonicalJSON, inspectSource, loadTrustedPin, INSTALLED_PIN, paymentQueryInput, decisionAt } from '../../docs/jobs.mjs';

const original = JSON.parse(readFileSync(new URL('../../docs/evidence/device-signed-purchase.json', import.meta.url)));
const atCapture = original.purchase.receipt.completed_at + 7;

test('historical paid evidence verifies the original P-256 signature and expires', async () => {
  const fresh = await inspectSource(original, { now: atCapture });
  assert.equal(fresh.signature, true);
  assert.equal(fresh.terms, true);
  assert.equal(fresh.fresh, true);
  assert.equal(fresh.receiptDecision, 'DISPATCH');
  assert.equal(fresh.decision, 'WAIT'); // A file does not verify its own Solana transfer.
  assert.equal(paymentQueryInput(fresh.source).settlement.transaction, original.purchase.settlement.transaction);
  const expired = await inspectSource(original, { now: atCapture + 10 });
  assert.equal(expired.signature, true);
  assert.equal(expired.fresh, false);
  assert.equal(expired.receiptDecision, 'WAIT');
});

test('changed contact, nonce, and request terms fail independently', async () => {
  const changed = structuredClone(original);
  changed.purchase.receipt.result.closed = true;
  assert.equal((await inspectSource(changed, { now: atCapture })).signature, false);
  const nonce = structuredClone(original);
  nonce.purchase.challenge.nonce += 1;
  assert.equal((await inspectSource(nonce, { now: atCapture })).terms, false);
  const location = structuredClone(original);
  location.purchase.challenge.location = 'another-site';
  assert.equal((await inspectSource(location, { now: atCapture })).terms, false);
});

test('job file ties the trusted pin, receipt digest, and fixed test-token terms', async () => {
  const run = original.purchase;
  const receipt = structuredClone(run.receipt);
  const job = {
    schema: 'fieldproof-job-v1', job_id: run.purchase_id, provider: receipt.provider,
    request: { ...run.challenge, contact: { provider: receipt.provider, sensor: receipt.result.sensor } },
    receipt, receipt_sha256: createHash('sha256').update(canonicalJSON(receipt)).digest('hex'),
    payment: { network: run.settlement.network, asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      recipient: 'CaQAKBcwf7G5vXeu2RNuNGJafnJ8724Uj4wv9ivfxfQA', amount_base_units: '1000',
      kind: 'test-token', transaction: run.settlement.transaction, payer: run.settlement.payer },
    identity: { schema: 'fieldproof-peaq-identity-v1', machine_id: '123', receipt_public_key: INSTALLED_PIN,
      service: { endpoint: 'urn:fieldproof:ble-contact:esp32-c6-96a2:gpio9-contact:state.observe' }, finalized_block: 1 },
    acceptance: { accepted: true, verified_at: receipt.completed_at + 1, decision: 'DISPATCH' },
  };
  const valid = await inspectSource({ job, event: { state: 'pending' } }, { now: atCapture });
  assert.equal(valid.signature, true);
  assert.equal(valid.terms, true);
  assert.equal(valid.receiptDigest, true);
  assert.equal(valid.identityConsistent, true);
  const changedIdentity = structuredClone(job);
  changedIdentity.identity.receipt_public_key = '04' + '00'.repeat(64);
  const untrusted = await inspectSource(changedIdentity, { now: atCapture });
  assert.equal(untrusted.signature, true);
  assert.equal(untrusted.identityConsistent, false);
  assert.equal(untrusted.terms, false);
  const changedReceipt = structuredClone(job);
  changedReceipt.receipt.result.closed = true;
  const tampered = await inspectSource(changedReceipt, { now: atCapture });
  assert.equal(tampered.signature, false);
  assert.equal(tampered.receiptDigest, false);
});

test('served pin mismatch fails instead of trusting changed configuration', async () => {
  assert.equal(canonicalJSON({ '2': true, '10': false }), '{"10":false,"2":true}');
  assert.equal(await loadTrustedPin(async () => ({ status: 404 })), INSTALLED_PIN);
  await assert.rejects(loadTrustedPin(async () => ({ ok: true, text: async () => JSON.stringify({
    algorithm: 'ecdsa-p256-sha256', providers: { 'esp32-c6-96a2': '04' + '00'.repeat(64) },
  }) })), /differs/);
});

test('a verified payment never keeps an expired contact decision usable', async () => {
  const checked = await inspectSource(original, { now: atCapture });
  assert.equal(decisionAt(checked, false, atCapture).decision, 'WAIT');
  assert.equal(decisionAt(checked, true, atCapture).decision, 'DISPATCH');
  assert.equal(decisionAt(checked, true, original.purchase.receipt.completed_at + 10).decision, 'DISPATCH');
  assert.equal(decisionAt(checked, true, original.purchase.receipt.completed_at + 11).decision, 'WAIT');
  assert.throws(() => decisionAt(checked, true, NaN), /time/);
});
