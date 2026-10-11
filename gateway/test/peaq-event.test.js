import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PurchaseStore } from '../store.js';
import { EventStore } from '../event-store.js';
import { createJob, sha256, canonicalJSON } from '../job.js';
import { jobFixture } from './fixtures/job.js';
import { prepareSavedEvent, verifySavedPayment, submitSavedEvent, inspectSavedEvent, savedEvidenceManifest, saveEvidenceManifest,
  prepareSavedStorage, previewSavedStorage, submitSavedStorage, inspectSavedStorage, PEAQ_STORAGE_ADDRESS } from '../peaq-event.js';

function fixture(t) {
  const f = jobFixture(), purchases = new PurchaseStore(':memory:'), events = new EventStore(purchases);
  t.after(() => purchases.close());
  purchases.create({ ...f.run.challenge, expires_at: f.now + 120, receipt_public_key: f.policy.receipt_public_key });
  purchases.finish(f.run.purchase_id, 'delivered', { settlement: f.run.settlement, result: { receipt: f.run.receipt } });
  events.enqueue(createJob(f.run, f.policy, f.identity, f.now), f.policy);
  return { ...f, events, id: f.run.purchase_id, policyPath: '/tmp/public-test-policy.json', registry: '0x' + '67'.repeat(20) };
}
const transaction = '0x' + 'ab'.repeat(32), hash = '0x' + 'cd'.repeat(32);
function runner(f, { failure, inspectMismatch = false } = {}) {
  const calls = [];
  const run = async (module, args) => {
    calls.push(module);
    const raw = await readFile(args[args.indexOf('--raw') + 1], 'utf8');
    assert.equal(raw, f.events.get(f.id).job_utf8);
    if (module === 'scripts.prepare_peaq_event') return { schema: 'fieldproof-peaq-event-preparation-v1',
      machine_id: f.policy.machine_id, raw_data_utf8: raw, raw_data_sha256: sha256(raw), data_hash: hash };
    if (module === 'scripts.peaq_operator') {
      assert.equal(f.events.get(f.id).state, 'submitting'); // durable claim precedes any write
      if (failure) throw new Error('RPC response lost after broadcast');
      return { schema: 'fieldproof-agung-event-result-v1', transaction_hash: transaction,
        data_hash: hash, job_sha256: sha256(raw), index: 0, journal: args[args.indexOf('--journal') + 1].split('/').at(-1),
        status: 'finalized_and_inspected' };
    }
    if (module === 'scripts.inspect_peaq_event') return { verified: true, transaction_hash: transaction,
      data_hash: inspectMismatch ? '0x' + 'ef'.repeat(32) : hash, job_sha256: sha256(raw), finalized_block: 102 };
    assert.fail(`Unexpected Python module ${module}`);
  };
  return { run, calls };
}

test('saved payment recovery queries the original transfer without buying or submitting', async t => {
  const f = fixture(t), { run, calls } = runner(f);
  await prepareSavedEvent({ ...f, run });
  assert.deepEqual(calls, ['scripts.prepare_peaq_event']);
  const result = await verifySavedPayment({ ...f, query: async request => {
    assert.equal(request.settlement.transaction, f.run.settlement.transaction);
    return f.paymentVerification;
  } });
  assert.equal(result.spending, false);
  assert.equal(f.events.get(f.id).settlement_verified, 1);
  const manifest = savedEvidenceManifest(f.events, f.id, f.policy);
  assert.equal(manifest.commercial_revenue, false);
  assert.equal(manifest.job_sha256, sha256(f.events.get(f.id).job_utf8));
});

test('event submission fails before signing without approval or independent payment verification', async t => {
  const f = fixture(t), { run, calls } = runner(f);
  await assert.rejects(submitSavedEvent({ ...f, run }), /explicit test-write/);
  await assert.rejects(submitSavedEvent({ ...f, run, execute: true, gasCap: '1000', keyFile: '/tmp/test-only.secret' }), /independently verified/);
  assert.deepEqual(calls, []);
  assert.equal(f.events.get(f.id).state, 'pending');
});

test('one claim leads to one write, saved references, and independent confirmation', async t => {
  const f = fixture(t), { run, calls } = runner(f);
  f.events.recordPayment(f.id, f.paymentVerification);
  const options = { ...f, run, execute: true, gasCap: '1000', keyFile: '/tmp/test-only.secret' };
  await submitSavedEvent(options);
  assert.equal(f.events.get(f.id).state, 'confirmed');
  assert.equal(JSON.parse(f.events.get(f.id).submission_reference).index, 0);
  await assert.rejects(submitSavedEvent(options), /pending job/);
  assert.equal(calls.filter(module => module === 'scripts.peaq_operator').length, 1);
});

test('lost write response blocks retries and requires read-only reconciliation', async t => {
  const f = fixture(t), failed = runner(f, { failure: true });
  f.events.recordPayment(f.id, f.paymentVerification);
  const options = { ...f, execute: true, gasCap: '1000', keyFile: '/tmp/test-only.secret' };
  await assert.rejects(submitSavedEvent({ ...options, run: failed.run }), /uncertain/);
  assert.equal(f.events.get(f.id).state, 'uncertain');
  await assert.rejects(submitSavedEvent({ ...options, run: failed.run }), /pending job/);
  const wrong = runner(f, { inspectMismatch: true });
  await assert.rejects(inspectSavedEvent({ ...f, run: wrong.run, transaction, index: 0 }), /readback/);
  assert.equal(f.events.get(f.id).transaction_hash, null);
  const recovered = runner(f);
  await inspectSavedEvent({ ...f, run: recovered.run, transaction, index: 0 });
  assert.equal(f.events.get(f.id).state, 'confirmed');
  assert.equal(recovered.calls.includes('scripts.peaq_operator'), false);
});

test('failed independent readback retains submitted references and blocks another write', async t => {
  const f = fixture(t), failed = runner(f, { inspectMismatch: true });
  f.events.recordPayment(f.id, f.paymentVerification);
  await assert.rejects(submitSavedEvent({ ...f, run: failed.run, execute: true, gasCap: '1000', keyFile: '/tmp/test-only.secret' }), /uncertain/);
  assert.equal(f.events.get(f.id).transaction_hash, transaction);
  const recovered = runner(f);
  await inspectSavedEvent({ ...f, run: recovered.run });
  assert.equal(f.events.get(f.id).state, 'confirmed');
});

test('saving a manifest creates a private file and never overwrites existing evidence', async t => {
  const f = fixture(t);
  const directory = await mkdtemp(join(tmpdir(), 'fieldproof-manifest-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'saved-manifest.json');
  const manifest = savedEvidenceManifest(f.events, f.id, f.policy);
  assert.deepEqual(await saveEvidenceManifest(manifest, path), { saved: true, purchase_id: f.id, spending: false });
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), manifest);
  await assert.rejects(saveEvidenceManifest(manifest, path), { code: 'EEXIST' });
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), manifest);
});

function storageRunner(f, { failure = false, inspectChange = {}, preparationChange = {} } = {}) {
  const calls = [];
  const run = async (module, args) => {
    assert.equal(module, 'scripts.peaq_storage_activity');
    const mode = args[0];
    calls.push(mode);
    const raw = await readFile(args[args.indexOf('--raw') + 1], 'utf8');
    assert.equal(raw, f.events.get(f.id).job_utf8);
    const binding = { route: 'storage', chain_id: 9990, machine_id: f.policy.machine_id, owner: f.policy.owner,
      storage_address: PEAQ_STORAGE_ADDRESS, key_utf8: `fieldproof.job:${f.id}`,
      value_utf8: canonicalJSON({ v: 1, machine_id: f.policy.machine_id, data_hash: hash }), data_hash: hash,
      job_sha256: sha256(raw), official_event_registry: false, machine_credit_rating: false,
      machine_authority_at_request_verified: true };
    if (mode === 'prepare') return { ...binding, schema: 'fieldproof-peaq-storage-preparation-v1',
      raw_data_utf8: raw, ...preparationChange };
    if (mode === 'preview') {
      assert.equal(f.events.get(f.id).state, 'pending');
      assert.equal(args.includes('--key-file'), false);
      assert.equal(args.includes('--journal'), false);
      return { ...binding, schema: 'fieldproof-peaq-storage-preview-v1', raw_data_utf8: raw,
        signing: false, write_authorized: false, native_value_wei: '0', gas_ceiling_wei: '1000',
        approved_max_total_gas_wei: args[args.indexOf('--max-total-gas-wei') + 1],
        settlement_proof: 'finalized_solana_rpc_read' };
    }
    const inspection = { ...binding, schema: 'fieldproof-peaq-storage-inspection-v1', verified: true,
      deployment_id: f.policy.deployment_id, transaction_hash: transaction, finalized_block: 102,
      submission_block: 100, block_hash: '0x' + 'ba'.repeat(32), storage_mutable_by_owner: true,
      machine_authority_at_submission_verified: true };
    if (mode === 'submit') {
      assert.equal(f.events.get(f.id).state, 'submitting'); // durable outbox claim precedes signing
      assert.equal(args.includes('--execute-agung-test-write'), true);
      if (failure) throw new Error('Storage RPC response lost after broadcast');
      return { ...inspection, schema: 'fieldproof-agung-storage-result-v1', status: 'finalized_and_inspected',
        journal: args[args.indexOf('--journal') + 1].split('/').at(-1) };
    }
    if (mode === 'inspect') {
      assert.equal(args.includes('--key-file'), false);
      assert.equal(args.includes('--execute-agung-test-write'), false);
      return { ...inspection, ...inspectChange };
    }
    assert.fail(`Unexpected storage mode ${mode}`);
  };
  return { run, calls };
}

test('storage preparation and gas preview bind the job without a claim, key, or write', async t => {
  const f = fixture(t), { run, calls } = storageRunner(f);
  const prepared = await prepareSavedStorage({ ...f, run });
  assert.equal(prepared.key_utf8, `fieldproof.job:${f.id}`);
  const preview = await previewSavedStorage({ ...f, run, gasCap: '1000' });
  assert.equal(preview.signing, false);
  assert.equal(f.events.get(f.id).state, 'pending');
  assert.deepEqual(calls, ['prepare', 'preview']);
});

test('storage requires explicit approval, verified payment, and bounded gas before claiming', async t => {
  const f = fixture(t), { run, calls } = storageRunner(f);
  await assert.rejects(submitSavedStorage({ ...f, run }), /explicit test-write/);
  await assert.rejects(submitSavedStorage({ ...f, run, execute: true, gasCap: '1000', keyFile: '/tmp/test-only.secret' }), /pending job/);
  f.events.recordPayment(f.id, f.paymentVerification);
  await assert.rejects(submitSavedStorage({ ...f, run, execute: true, gasCap: '10000000000000001', keyFile: '/tmp/test-only.secret' }), /0.01 AGUNG/);
  assert.deepEqual(calls, []);
  assert.equal(f.events.get(f.id).state, 'pending');
});

test('storage preparation rejects a different owner or key before a durable claim', async t => {
  const f = fixture(t);
  f.events.recordPayment(f.id, f.paymentVerification);
  for (const preparationChange of [{ owner: '0x' + '23'.repeat(20) }, { key_utf8: 'different' },
      { machine_authority_at_request_verified: false }]) {
    const { run, calls } = storageRunner(f, { preparationChange });
    await assert.rejects(submitSavedStorage({ ...f, run, execute: true, gasCap: '1000', keyFile: '/tmp/test-only.secret' }), /Prepared peaq Storage/);
    assert.deepEqual(calls, ['prepare']);
    assert.equal(f.events.get(f.id).state, 'pending');
  }
});

test('one storage claim writes once, saves explicit route, and independently confirms', async t => {
  const f = fixture(t), { run, calls } = storageRunner(f);
  f.events.recordPayment(f.id, f.paymentVerification);
  const options = { ...f, run, execute: true, gasCap: '1000', keyFile: '/tmp/test-only.secret' };
  const result = await submitSavedStorage(options);
  assert.equal(result.verified, true);
  assert.equal(f.events.get(f.id).state, 'confirmed');
  assert.equal(JSON.parse(f.events.get(f.id).submission_reference).route, 'storage');
  assert.equal(JSON.parse(f.events.get(f.id).confirmation).official_event_registry, false);
  await assert.rejects(submitSavedStorage(options), /pending job/);
  assert.equal(calls.filter(mode => mode === 'submit').length, 1);
  await assert.rejects(inspectSavedEvent({ ...f, registry: f.registry, index: 0, run }), /storage-inspect/);
});

test('lost storage response blocks retries and recovers through an explicit read-only hash', async t => {
  const f = fixture(t), failed = storageRunner(f, { failure: true });
  f.events.recordPayment(f.id, f.paymentVerification);
  const options = { ...f, execute: true, gasCap: '1000', keyFile: '/tmp/test-only.secret' };
  await assert.rejects(submitSavedStorage({ ...options, run: failed.run }), /uncertain/);
  assert.equal(f.events.get(f.id).state, 'uncertain');
  assert.equal(f.events.get(f.id).transaction_hash, null);
  await assert.rejects(submitSavedStorage({ ...options, run: failed.run }), /pending job/);
  const recovered = storageRunner(f);
  await inspectSavedStorage({ ...f, run: recovered.run, transaction });
  assert.equal(f.events.get(f.id).state, 'confirmed');
  assert.deepEqual(recovered.calls, ['prepare', 'inspect']);
  await assert.rejects(inspectSavedEvent({ ...f, registry: f.registry, transaction, index: 0, run: recovered.run }), /storage-inspect/);
});

test('storage confirmation rejects changed bytes, authority, or target and retains its write reference', async t => {
  for (const inspectChange of [{ value_utf8: 'changed' }, { owner: '0x' + '23'.repeat(20) },
      { storage_address: '0x' + '12'.repeat(20) }, { machine_authority_at_submission_verified: false },
      { machine_authority_at_request_verified: false }]) {
    const f = fixture(t), failed = storageRunner(f, { inspectChange });
    f.events.recordPayment(f.id, f.paymentVerification);
    await assert.rejects(submitSavedStorage({ ...f, run: failed.run, execute: true, gasCap: '1000', keyFile: '/tmp/test-only.secret' }), /uncertain/);
    assert.equal(f.events.get(f.id).transaction_hash, transaction);
    assert.equal(f.events.get(f.id).state, 'uncertain');
    const recovered = storageRunner(f);
    await inspectSavedStorage({ ...f, run: recovered.run });
    assert.equal(f.events.get(f.id).state, 'confirmed');
    assert.equal(recovered.calls.includes('submit'), false);
  }
});

test('storage inspection rejects EventRegistry references without invoking Python', async t => {
  const f = fixture(t), legacy = runner(f), stored = storageRunner(f);
  f.events.recordPayment(f.id, f.paymentVerification);
  await submitSavedEvent({ ...f, run: legacy.run, execute: true, gasCap: '1000', keyFile: '/tmp/test-only.secret' });
  await assert.rejects(inspectSavedStorage({ ...f, run: stored.run }), /uses EventRegistry/);
  assert.deepEqual(stored.calls, []);
});
