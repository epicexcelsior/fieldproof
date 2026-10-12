// Local operator workflow. Read-only by default. Interrupted writes require reconciliation.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PurchaseStore } from './store.js';
import { EventStore } from './event-store.js';
import { loadProviderPolicy } from './peaq.js';
import { verifyJob, sha256, canonicalJSON } from './job.js';
import { queryDevnetSettlement, configureLocalDevnetRpc } from './devnet-rpc.js';
import { createLocalBuyer } from './local-buyer.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const EVM_HASH = /^0x[0-9a-fA-F]{64}$/;
export const PEAQ_STORAGE_ADDRESS = '0x0000000000000000000000000000000000000801';
const MAX_STORAGE_GAS_WEI = 10000000000000000n; // 0.01 AGUNG for one explicit storage activity

export function runPeaqPython(module, args, { timeout = 240000 } = {}) {
  const python = process.env.FIELDPROOF_PEAQ_PYTHON || 'python3';
  return new Promise((done, fail) => {
    const child = spawn(python, ['-m', module, ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', size = 0, settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) fail(error); else done(value);
    };
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(new Error('Peaq command timed out. Reconcile any private transaction journal before another write.')); }, timeout);
    child.on('error', () => finish(new Error('Cannot start the isolated peaq Python environment.')));
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
      size += data.length;
      if (size > 131072) { child.kill('SIGTERM'); finish(new Error('Peaq command exceeded its output limit.')); }
    });
    child.stdout.on('data', data => { output += data.toString('utf8'); });
    child.on('close', code => {
      if (code !== 0) return finish(new Error('Peaq command failed. Check RPC access and local inputs. Reconcile any attempted write before retry.'));
      try { finish(null, JSON.parse(output)); }
      catch { finish(new Error('Peaq command returned invalid JSON. Reconcile any attempted write before retry.')); }
    });
  });
}

async function withRaw(row, action) {
  const directory = join(ROOT, '.local', 'peaq-event-inputs');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(join(directory, 'job-'));
  const path = join(scratch, 'job.raw.json');
  try {
    await writeFile(path, row.job_utf8, { flag: 'wx', mode: 0o600 });
    return await action(path);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

function checkedRow(events, id, policy) {
  const row = events.get(id);
  if (!row) throw new Error('No saved job exists for this purchase. Do not make another payment to recover it.');
  const rebuilt = verifyJob(JSON.parse(row.job_utf8), policy);
  if (rebuilt.raw !== row.job_utf8 || sha256(row.job_utf8) !== row.job_sha256) throw new Error('Saved job bytes changed. Stop and review the database.');
  return row;
}

function checkPreparation(prepared, row, policy) {
  if (prepared?.schema !== 'fieldproof-peaq-event-preparation-v1' || prepared.machine_id !== policy.machine_id ||
      prepared.raw_data_utf8 !== row.job_utf8 || prepared.raw_data_sha256 !== row.job_sha256 || !EVM_HASH.test(prepared.data_hash)) {
    throw new Error('Prepared event does not bind the saved job.');
  }
  return prepared;
}

export async function prepareSavedEvent({ events, id, policy, policyPath, run = runPeaqPython }) {
  const row = checkedRow(events, id, policy);
  return withRaw(row, async raw => checkPreparation(await run('scripts.prepare_peaq_event', ['--policy', policyPath, '--raw', raw]), row, policy));
}

export async function verifySavedPayment({ events, id, policy, query = queryDevnetSettlement }) {
  const row = checkedRow(events, id, policy), job = JSON.parse(row.job_utf8);
  const result = await query({ settlement: { success: true, network: job.payment.network,
    transaction: job.payment.transaction, payer: job.payment.payer } });
  events.recordPayment(id, result);
  return { purchase_id: id, state: events.get(id).state, payment_verification: result, spending: false };
}

export async function recoverSavedBuyer({ events, id, policy, operation, query = queryDevnetSettlement,
    directory = join(ROOT, '.local', 'live-buyer', JSON.parse(checkedRow(events, id, policy).job_utf8).payment.payer) }) {
  const row = checkedRow(events, id, policy), job = JSON.parse(row.job_utf8);
  await verifySavedPayment({ events, id, policy, query }); // read the existing transfer, never buy again
  const controller = createLocalBuyer({ directory, payer: job.payment.payer, payTo: policy.pay_to,
    buy: () => { throw new Error('This recovery command cannot purchase.'); },
    readPurchaseState: purchase => events.purchases.get(purchase)?.state });
  try {
    const run = { purchase_id: job.job_id, challenge: job.request, receipt: job.receipt,
      settlement: { success: true, network: job.payment.network, transaction: job.payment.transaction, payer: job.payment.payer } };
    const result = controller.completeReviewed(operation, run);
    return { operation_id: result.operation_id, purchase_id: id, status: result.status,
      recovered: true, spending: false, remaining: controller.config().remaining,
      note: 'Original accepted job restored. Its receipt remains subject to current expiry.' };
  } finally { controller.close(); }
}

function inspectionArgs({ policyPath, registry, transaction, index }, raw, policy) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(registry || '') || /^0x0{40}$/i.test(registry) ||
      !EVM_HASH.test(transaction || '') || !Number.isSafeInteger(index) || index < 0) {
    throw new Error('Inspection requires an explicit registry, transaction hash, and nonnegative event index.');
  }
  return ['--policy', policyPath, '--raw', raw, '--registry', registry, '--machine-id', policy.machine_id,
    '--transaction', transaction, '--index', String(index)];
}

export async function inspectSavedEvent({ events, id, policy, policyPath, registry, transaction, index, run = runPeaqPython }) {
  const row = checkedRow(events, id, policy);
  const reference = row.submission_reference && JSON.parse(row.submission_reference);
  const confirmation = row.confirmation && JSON.parse(row.confirmation);
  if (reference?.route === 'storage' || confirmation?.route === 'storage') {
    throw new Error('This job uses peaq Storage. Use storage-inspect to check its original transaction.');
  }
  const inputs = { policyPath, registry: registry ?? reference?.registry,
    transaction: transaction ?? row.transaction_hash, index: index ?? reference?.index };
  if (!['submitted', 'uncertain', 'confirmed'].includes(row.state)) throw new Error('No attempted event exists to reconcile.');
  const result = await withRaw(row, async raw => {
    const args = inspectionArgs(inputs, raw, policy);
    const prepared = checkPreparation(await run('scripts.prepare_peaq_event', ['--policy', policyPath, '--raw', raw]), row, policy);
    const readback = await run('scripts.inspect_peaq_event', args);
    if (readback?.verified !== true || readback.transaction_hash?.toLowerCase() !== inputs.transaction.toLowerCase() ||
        readback.data_hash?.toLowerCase() !== prepared.data_hash.toLowerCase() || readback.job_sha256 !== row.job_sha256 ||
        !Number.isSafeInteger(readback.finalized_block) || readback.finalized_block < 1) {
      throw new Error('Finalized readback does not match the exact saved job.');
    }
    return readback;
  });
  if (row.state === 'confirmed') return result;
  if (!row.transaction_hash) events.recordRecoveredSubmission(id, inputs.transaction, result.data_hash);
  events.confirm(id, result);
  return result;
}

export async function submitSavedEvent({ events, id, policy, policyPath, registry, execute, gasCap, keyFile, run = runPeaqPython }) {
  if (execute !== true || !/^[1-9][0-9]*$/.test(gasCap || '') || BigInt(gasCap) >= 2n ** 256n || !keyFile ||
      !/^0x[0-9a-fA-F]{40}$/.test(registry || '') || /^0x0{40}$/i.test(registry)) {
    throw new Error('Submission requires explicit test-write approval, a reviewed gas cap, a local key file, and an approved registry.');
  }
  const row = checkedRow(events, id, policy);
  if (row.state !== 'pending' || row.settlement_verified !== 1) throw new Error('Only an independently verified pending job can submit. Reconcile other states.');
  const prepared = await prepareSavedEvent({ events, id, policy, policyPath, run });
  if (!events.claim(id)) throw new Error('Another worker claimed this event. No transaction sent by this worker.');
  const journal = `${id}-${randomUUID()}.jsonl`;
  try {
    const result = await withRaw(row, raw => run('scripts.peaq_operator', ['event', '--policy', policyPath, '--raw', raw,
      '--registry', registry, '--execute-agung-test-write', '--max-total-gas-wei', gasCap, '--key-file', keyFile,
      '--journal', join(ROOT, '.local', 'peaq-journals', journal)]));
    if (result?.schema !== 'fieldproof-agung-event-result-v1' || result.status !== 'finalized_and_inspected' ||
        result.data_hash?.toLowerCase() !== prepared.data_hash.toLowerCase() || result.job_sha256 !== row.job_sha256 ||
        !EVM_HASH.test(result.transaction_hash || '') || !Number.isSafeInteger(result.index) || result.index < 0 || result.journal !== journal) {
      throw new Error('Operator result does not match the claimed job.');
    }
    events.submitted(id, result.transaction_hash, prepared.data_hash, { registry, index: result.index, journal });
    return await inspectSavedEvent({ events, id, policy, policyPath, run });
  } catch (error) {
    events.uncertain(id, `Inspect private journal ${journal}. Reconcile this purchase before another write.`);
    throw new Error(`Peaq submission remains uncertain for purchase ${id}. Inspect private journal ${journal}. No automatic retry.`, { cause: error });
  }
}

function storageGasCap(gasCap = MAX_STORAGE_GAS_WEI.toString()) {
  if (typeof gasCap !== 'string' || gasCap.length > 17 || !/^[1-9][0-9]*$/.test(gasCap) || BigInt(gasCap) > MAX_STORAGE_GAS_WEI) {
    throw new Error('One storage activity requires a positive gas ceiling at or below 0.01 AGUNG.');
  }
  return gasCap;
}

function checkStoragePreparation(prepared, row, policy, schema = 'fieldproof-peaq-storage-preparation-v1') {
  if (prepared?.schema !== schema || prepared.route !== 'storage' || prepared.chain_id !== 9990 ||
      prepared.machine_id !== policy.machine_id || prepared.owner?.toLowerCase() !== policy.owner.toLowerCase() ||
      prepared.storage_address?.toLowerCase() !== PEAQ_STORAGE_ADDRESS || prepared.raw_data_utf8 !== row.job_utf8 ||
      prepared.job_sha256 !== row.job_sha256 || !EVM_HASH.test(prepared.data_hash || '') ||
      prepared.key_utf8 !== `fieldproof.job:${row.purchase_id}` ||
      prepared.value_utf8 !== canonicalJSON({ v: 1, machine_id: policy.machine_id, data_hash: prepared.data_hash }) ||
      Buffer.byteLength(prepared.key_utf8) > 64 || Buffer.byteLength(prepared.value_utf8) > 256 ||
      prepared.official_event_registry !== false || prepared.machine_credit_rating !== false ||
      prepared.machine_authority_at_request_verified !== true) {
    throw new Error('Prepared peaq Storage record does not bind the exact saved job and approved owner.');
  }
  return prepared;
}

export async function prepareSavedStorage({ events, id, policy, policyPath, run = runPeaqPython }) {
  const row = checkedRow(events, id, policy);
  return withRaw(row, async raw => checkStoragePreparation(
    await run('scripts.peaq_storage_activity', ['prepare', '--policy', policyPath, '--raw', raw]), row, policy));
}

export async function previewSavedStorage({ events, id, policy, policyPath, gasCap, run = runPeaqPython }) {
  const row = checkedRow(events, id, policy), cap = storageGasCap(gasCap);
  const result = await withRaw(row, raw => run('scripts.peaq_storage_activity', ['preview', '--policy', policyPath,
    '--raw', raw, '--max-total-gas-wei', cap]));
  checkStoragePreparation(result, row, policy, 'fieldproof-peaq-storage-preview-v1');
  if (result.signing !== false || result.write_authorized !== false || result.native_value_wei !== '0' ||
      result.approved_max_total_gas_wei !== cap || !/^[1-9][0-9]*$/.test(result.gas_ceiling_wei || '') ||
      BigInt(result.gas_ceiling_wei) > BigInt(cap) || result.settlement_proof !== 'finalized_solana_rpc_read') {
    throw new Error('Storage preview does not satisfy the reviewed read-only gas ceiling.');
  }
  return result;
}

function checkStorageReadback(result, prepared, row, policy, transaction, schema) {
  if (result?.schema !== schema || result.route !== 'storage' || result.verified !== true ||
      result.chain_id !== 9990 || result.deployment_id !== policy.deployment_id ||
      result.machine_id !== policy.machine_id || result.owner?.toLowerCase() !== policy.owner.toLowerCase() ||
      result.storage_address?.toLowerCase() !== PEAQ_STORAGE_ADDRESS ||
      !EVM_HASH.test(result.transaction_hash || '') ||
      (transaction && result.transaction_hash.toLowerCase() !== transaction.toLowerCase()) ||
      result.data_hash?.toLowerCase() !== prepared.data_hash.toLowerCase() || result.job_sha256 !== row.job_sha256 ||
      result.key_utf8 !== prepared.key_utf8 || result.value_utf8 !== prepared.value_utf8 ||
      !Number.isSafeInteger(result.finalized_block) || result.finalized_block < 1 ||
      !Number.isSafeInteger(result.submission_block) || result.submission_block < 1 ||
      result.submission_block > result.finalized_block || !EVM_HASH.test(result.block_hash || '') ||
      result.official_event_registry !== false || result.machine_credit_rating !== false ||
      result.storage_mutable_by_owner !== true || result.machine_authority_at_submission_verified !== true ||
      result.machine_authority_at_request_verified !== true) {
    throw new Error('Finalized storage readback does not match the exact saved job, owner, and original addItem transaction.');
  }
  return result;
}

export async function inspectSavedStorage({ events, id, policy, policyPath, transaction, run = runPeaqPython }) {
  const row = checkedRow(events, id, policy);
  const reference = row.submission_reference && JSON.parse(row.submission_reference);
  const confirmation = row.confirmation && JSON.parse(row.confirmation);
  if ((reference && reference.route !== 'storage') || (confirmation && confirmation.route !== 'storage')) {
    throw new Error('This job uses EventRegistry. Use inspect to check its original event.');
  }
  if (!['submitted', 'uncertain', 'confirmed'].includes(row.state)) throw new Error('No attempted storage activity exists to reconcile.');
  const selected = transaction ?? row.transaction_hash;
  if (!EVM_HASH.test(selected || '') || (row.transaction_hash && selected.toLowerCase() !== row.transaction_hash.toLowerCase())) {
    throw new Error('Storage inspection requires the original explicit transaction hash.');
  }
  const prepared = await prepareSavedStorage({ events, id, policy, policyPath, run });
  const result = await withRaw(row, raw => run('scripts.peaq_storage_activity', ['inspect', '--policy', policyPath,
    '--raw', raw, '--transaction', selected]));
  checkStorageReadback(result, prepared, row, policy, selected, 'fieldproof-peaq-storage-inspection-v1');
  if (row.state === 'confirmed') return result;
  if (!row.transaction_hash) events.recordRecoveredSubmission(id, selected, result.data_hash);
  events.confirm(id, result);
  return result;
}

export async function submitSavedStorage({ events, id, policy, policyPath, execute, gasCap, keyFile, run = runPeaqPython }) {
  if (execute !== true || !keyFile || gasCap === undefined) {
    throw new Error('Storage submission requires explicit test-write approval, a reviewed gas cap, and a local key file.');
  }
  const cap = storageGasCap(gasCap), row = checkedRow(events, id, policy);
  if (row.state !== 'pending' || row.settlement_verified !== 1) {
    throw new Error('Only an independently verified pending job can submit storage. Reconcile other states.');
  }
  const prepared = await prepareSavedStorage({ events, id, policy, policyPath, run });
  if (!events.claim(id)) throw new Error('Another worker claimed this activity. No transaction sent by this worker.');
  const journal = `${id}-${randomUUID()}.jsonl`;
  try {
    const result = await withRaw(row, raw => run('scripts.peaq_storage_activity', ['submit', '--policy', policyPath,
      '--raw', raw, '--execute-agung-test-write', '--max-total-gas-wei', cap, '--key-file', keyFile,
      '--journal', join(ROOT, '.local', 'peaq-journals', journal)]));
    checkStorageReadback(result, prepared, row, policy, undefined, 'fieldproof-agung-storage-result-v1');
    if (result.status !== 'finalized_and_inspected' || result.journal !== journal) {
      throw new Error('Storage operator result differs from the claimed private journal.');
    }
    events.submitted(id, result.transaction_hash, prepared.data_hash, { route: 'storage',
      storage_address: PEAQ_STORAGE_ADDRESS, owner: policy.owner,
      key_utf8: prepared.key_utf8, value_utf8: prepared.value_utf8, journal });
    return await inspectSavedStorage({ events, id, policy, policyPath, run });
  } catch (error) {
    events.uncertain(id, `Inspect private journal ${journal}. Reconcile this purchase before another write.`);
    throw new Error(`Peaq Storage submission remains uncertain for purchase ${id}. Inspect private journal ${journal}. No automatic retry.`, { cause: error });
  }
}

export function savedEvidenceManifest(events, id, policy) {
  const row = checkedRow(events, id, policy);
  return { schema: 'fieldproof-evidence-manifest-v1', job: JSON.parse(row.job_utf8), job_sha256: row.job_sha256,
    payment_verification: row.payment_verification && JSON.parse(row.payment_verification),
    peaq_event: { state: row.state, transaction_hash: row.transaction_hash, data_hash: row.data_hash,
      reference: row.submission_reference && JSON.parse(row.submission_reference),
      confirmation: row.confirmation && JSON.parse(row.confirmation) },
    commercial_revenue: false, verification_note: 'Saved evidence. Imported metadata does not establish a current independent chain read.' };
}

export async function saveEvidenceManifest(manifest, output) {
  if (manifest?.schema !== 'fieldproof-evidence-manifest-v1' || manifest.commercial_revenue !== false) {
    throw new Error('Only a saved test-token evidence manifest can use this output command.');
  }
  await writeFile(resolve(output), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { saved: true, purchase_id: manifest.job.job_id, spending: false };
}

async function main() {
  configureLocalDevnetRpc();
  const { values } = parseArgs({ options: {
    action: { type: 'string', default: 'list' }, database: { type: 'string', default: '.local/purchases.sqlite' },
    purchase: { type: 'string' }, operation: { type: 'string' }, policy: { type: 'string' }, registry: { type: 'string' }, transaction: { type: 'string' }, output: { type: 'string' },
    index: { type: 'string' }, 'gas-cap-wei': { type: 'string' }, 'key-file': { type: 'string' },
    'execute-agung-test-write': { type: 'boolean', default: false }, 'workers-stopped': { type: 'boolean', default: false },
  } });
  if (!['list', 'prepare', 'verify-payment', 'recover-buyer', 'submit', 'inspect', 'recover', 'manifest',
      'storage-prepare', 'storage-preview', 'storage-submit', 'storage-inspect'].includes(values.action)) throw new Error('Unsupported event action.');
  if (values.action.startsWith('storage-') && (values.registry || values.index)) {
    throw new Error('Storage actions use the official fixed precompile. Do not supply an EventRegistry or event index.');
  }
  if (values.output && values.action !== 'manifest') throw new Error('--output saves a manifest only. It cannot execute an event.');
  const purchases = new PurchaseStore(values.database), events = new EventStore(purchases);
  try {
    let result;
    if (values.action === 'list') result = events.list().map(row => ({ purchase_id: row.purchase_id, state: row.state,
      payment_verified: row.settlement_verified === 1, transaction_hash: row.transaction_hash }));
    else if (values.action === 'recover') {
      if (!values['workers-stopped']) throw new Error('Stop every event worker before --action recover --workers-stopped.');
      result = { marked_uncertain: events.recover(), spending: false };
    } else {
      if (!values.policy || !/^[0-9a-f]{16}$/.test(values.purchase || '')) throw new Error('Use --policy FILE and --purchase 16-hex-ID.');
      const policyPath = resolve(values.policy), policy = await loadProviderPolicy(policyPath);
      const options = { events, id: values.purchase, operation: values.operation, policy, policyPath, registry: values.registry,
        transaction: values.transaction, index: values.index === undefined ? undefined : Number(values.index),
        execute: values['execute-agung-test-write'], gasCap: values['gas-cap-wei'], keyFile: values['key-file'] && resolve(values['key-file']) };
      if (values.action === 'prepare') result = await prepareSavedEvent(options);
      else if (values.action === 'verify-payment') result = await verifySavedPayment(options);
      else if (values.action === 'recover-buyer') result = await recoverSavedBuyer(options);
      else if (values.action === 'submit') result = await submitSavedEvent(options);
      else if (values.action === 'inspect') result = await inspectSavedEvent(options);
      else if (values.action === 'storage-prepare') result = await prepareSavedStorage(options);
      else if (values.action === 'storage-preview') result = await previewSavedStorage(options);
      else if (values.action === 'storage-submit') result = await submitSavedStorage(options);
      else if (values.action === 'storage-inspect') result = await inspectSavedStorage(options);
      else result = savedEvidenceManifest(events, values.purchase, policy);
    }
    if (values.output) result = await saveEvidenceManifest(result, values.output);
    console.log(JSON.stringify(result, null, 2));
  } finally { purchases.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ status: 'error', message: error.message })); process.exitCode = 1; });
}
