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
import { verifyJob, sha256 } from './job.js';
import { querySettlement } from '../docs/settlement.mjs';
import { createLocalBuyer } from './local-buyer.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const EVM_HASH = /^0x[0-9a-fA-F]{64}$/;

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

export async function verifySavedPayment({ events, id, policy, query = querySettlement }) {
  const row = checkedRow(events, id, policy), job = JSON.parse(row.job_utf8);
  const result = await query({ settlement: { success: true, network: job.payment.network,
    transaction: job.payment.transaction, payer: job.payment.payer } });
  events.recordPayment(id, result);
  return { purchase_id: id, state: events.get(id).state, payment_verification: result, spending: false };
}

export async function recoverSavedBuyer({ events, id, policy, operation, query = querySettlement,
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
  const { values } = parseArgs({ options: {
    action: { type: 'string', default: 'list' }, database: { type: 'string', default: '.local/purchases.sqlite' },
    purchase: { type: 'string' }, operation: { type: 'string' }, policy: { type: 'string' }, registry: { type: 'string' }, transaction: { type: 'string' }, output: { type: 'string' },
    index: { type: 'string' }, 'gas-cap-wei': { type: 'string' }, 'key-file': { type: 'string' },
    'execute-agung-test-write': { type: 'boolean', default: false }, 'workers-stopped': { type: 'boolean', default: false },
  } });
  if (!['list', 'prepare', 'verify-payment', 'recover-buyer', 'submit', 'inspect', 'recover', 'manifest'].includes(values.action)) throw new Error('Unsupported event action.');
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
      else result = savedEvidenceManifest(events, values.purchase, policy);
    }
    if (values.output) result = await saveEvidenceManifest(result, values.output);
    console.log(JSON.stringify(result, null, 2));
  } finally { purchases.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ status: 'error', message: error.message })); process.exitCode = 1; });
}
