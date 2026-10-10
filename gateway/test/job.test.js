import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSigner } from '@solana/kit';
import { jobFixture } from './fixtures/job.js';
import { checkIdentity, validateProviderPolicy } from '../peaq.js';
import { buyObservation } from '../buyer.js';
import { canonicalJSON, createJob, verifyJob } from '../job.js';

test('machine IDs survive the uint256 boundary without Number conversion', () => {
  const { policy } = jobFixture();
  const maximum = { ...policy, machine_id: (2n ** 256n - 1n).toString() };
  assert.equal(validateProviderPolicy(maximum).machine_id, maximum.machine_id);
  for (const machine_id of [1, '01', '-1', (2n ** 256n).toString(), '1e20']) {
    assert.throws(() => validateProviderPolicy({ ...policy, machine_id }));
  }
  assert.throws(() => validateProviderPolicy({ ...policy, pay_to: '11111111111111111111111111111111' }), /recipient/);
});

test('registry identity fails closed on key, owner, service, inactive state, and stale snapshots', () => {
  const { policy, identity, now } = jobFixture();
  assert.equal(checkIdentity(identity, policy, now).machine_id, policy.machine_id);
  for (const change of [{ owner: '0x' + '67'.repeat(20) }, { receipt_public_key: jobFixture().policy.receipt_public_key },
    { subscription: 'grace' }, { authentication: false }, { paused: true }, { available: false },
    { homed_locally: false }, { relocating: true }, { peers_match: false }, { finalized_block: 0 },
    { block_timestamp: now - 121 }, { resolved_at: now + 3 }, { unapproved: true },
    { contracts: { machine_registry: identity.contracts.machine_registry, info_desk: identity.contracts.info_desk } },
    { service: { ...identity.service, endpoint: 'changed' } }]) {
    assert.throws(() => checkIdentity({ ...identity, ...change }, policy, now), /peaq identity/);
  }
});

test('buyer rejects missing or mismatched peaq identity before any HTTP request or payment', async t => {
  const { policy, identity } = jobFixture(Math.floor(Date.now() / 1000));
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async () => assert.fail('No gateway request or payment is allowed');
  const signer = await generateKeyPairSigner();
  for (const snapshot of [null, { ...identity, subscription: 'terminated' }, { ...identity, receipt_public_key: jobFixture().policy.receipt_public_key }]) {
    await assert.rejects(buyObservation(signer, undefined, { receiptPublicKey: policy.receipt_public_key,
      peaq: { policy, resolve: async () => snapshot } }), /peaq identity/);
  }
  await assert.rejects(buyObservation(signer, undefined, { receiptPublicKey: policy.receipt_public_key,
    peaq: { policy: { ...policy, provider: 'another-device', service_endpoint: 'urn:fieldproof:ble-contact:another-device:gpio9-contact:state.observe' },
      resolve: async () => identity } }), /trusted buyer/);
});

test('job binds the original signed receipt, request, payment, and recorded acceptance', () => {
  const { run, policy, identity, now } = jobFixture();
  const envelope = createJob(run, policy, identity, now);
  assert.deepEqual(envelope.job.receipt, run.receipt);
  assert.equal(verifyJob(envelope.job, policy).sha256, envelope.sha256);
  assert.equal(envelope.raw, canonicalJSON(JSON.parse(envelope.raw)));
  for (const mutate of [job => { job.receipt.result.closed = true; }, job => { job.receipt_sha256 = '0'.repeat(64); },
    job => { job.payment.amount_base_units = '1001'; }, job => { job.request.nonce++; },
    job => { job.acceptance.decision = 'DISPATCH_ANYWAY'; }, job => { job.provider = 'other'; },
    job => { job.acceptance.verified_at = now + 11; }]) {
    const changed = structuredClone(envelope.job); mutate(changed);
    assert.throws(() => verifyJob(changed, policy));
  }
  assert.throws(() => createJob(run, policy, identity, now + 11), /freshness/);
});

test('canonical JSON refuses ambiguous numbers, invalid Unicode, and non-ASCII keys', () => {
  assert.equal(canonicalJSON({ z: [true, null], a: 'é' }), '{"a":"é","z":[true,null]}');
  assert.equal(canonicalJSON({ '2': true, '10': false }), '{"10":false,"2":true}');
  for (const value of [NaN, Infinity, 1.1, -0, 2 ** 53, undefined, '\ud800', { 'é': 1 }]) assert.throws(() => canonicalJSON(value));
});
