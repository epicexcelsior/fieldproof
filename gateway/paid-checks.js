// Real-only unattended rehearsal. No simulation flag, GPIO output, or automatic paid retry.
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { createGateway, createPaymentServer, observeHardware } from './server.js';
import { checkEvidence, loadBuyerSigner } from './buyer.js';
import { contactToolPreview, runContactOperation } from './agent-contact.js';
import { PurchaseStore } from './store.js';
import { saveBuyerRun } from './buyer-output.js';

const root = fileURLToPath(new URL('../', import.meta.url));

function privateJSON(path, value) {
  const file = openSync(path, 'wx', 0o600);
  try { writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); fsyncSync(file); }
  finally { closeSync(file); }
}

function checkCount(count) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 3) throw new Error('Select one to three paid checks within the existing shared ten-operation limit.');
}

function deviceFailure(error) {
  return /Operation not permitted|EPERM/.test(error?.message ?? '') ? 'runtime_access_denied' : 'real_observation_unavailable';
}

export async function checkPhysicalContact({ observe = observeHardware, now = () => Math.floor(Date.now() / 1000) } = {}) {
  const terms = contactToolPreview();
  const created = now();
  const request = { id: randomBytes(8).toString('hex'), nonce: randomInt(1, 0x7fffffff),
    location: 'demo-gate', max_age_seconds: 10, created_at: created,
    contact: terms.contact, receipt_public_key: terms.receipt_public_key, simulated: false };
  const answer = await observe(request);
  const verified = checkEvidence(answer, request, now(), terms.receipt_public_key);
  return { schema: 'fieldproof-physical-preflight-v1', payment: 'none', transport: 'real-ble',
    question: 'gate.closed', closed: answer.receipt.result.closed, request, receipt: answer.receipt,
    receipt_identity: verified.receipt_identity };
}

export async function runPaidChecks({ directory, count = 3, preflight = checkPhysicalContact, purchase, report = () => {} }) {
  checkCount(count);
  mkdirSync(dirname(directory), { recursive: true, mode: 0o700 });
  mkdirSync(directory, { mode: 0o700 }); // Never reuse or overwrite an earlier batch.
  const operations = Array.from({ length: count }, (_, index) => ({
    operation_id: randomUUID(), output: `check-${index + 1}.json` }));
  const plan = { schema: 'fieldproof-paid-checks-plan-v1', operations, requested: count,
    maximum_base_units: String(count * 1000), asset_kind: 'Devnet USDC test tokens',
    automatic_paid_retry: false, peaq: 'not_used', physical_input_change_required: false };
  privateJSON(resolve(directory, 'plan.json'), plan);
  report({ phase: 'plan_saved', directory, requested: count, maximum_base_units: plan.maximum_base_units });
  const summary = { schema: 'fieldproof-paid-checks-result-v1', status: 'blocked', requested: count,
    attempted: 0, completed: 0, peaq: 'not_used', commercial_revenue: false,
    total_verified_base_units: '0',
    transactions: [], contact_states: [], receipts: [], purchase_duration_ms: [],
    note: 'Repeated input state is valid. No physical state change is claimed. This is founder test activity.' };
  try {
    let physical;
    try { physical = await preflight(); }
    catch (error) {
      summary.reason = 'physical_preflight_failed';
      summary.preflight_error = deviceFailure(error);
      throw new Error(`Real signed board preflight failed (${summary.preflight_error}). Run scripts/check_execution_access.py. No payment started.`);
    }
    if (physical?.schema !== 'fieldproof-physical-preflight-v1' || physical.payment !== 'none' ||
        physical.transport !== 'real-ble' || physical.receipt_identity !== 'pinned-device-p256' ||
        typeof physical.closed !== 'boolean') {
      summary.reason = 'physical_preflight_invalid';
      throw new Error('The preflight does not establish a real pinned-device contact reading. No payment started.');
    }
    privateJSON(resolve(directory, 'preflight.json'), physical);
    report({ phase: 'physical_preflight_verified', closed: physical.closed, spending: false });
    const ids = new Set(), transactions = new Set();
    for (const operation of operations) {
      summary.attempted++;
      let result;
      try {
        result = await saveBuyerRun(resolve(directory, operation.output), () => purchase(operation.operation_id));
      } catch {
        summary.reason = 'purchase_requires_review';
        summary.review_operation_id = operation.operation_id;
        throw new Error(`Keep operation ${operation.operation_id} for review. No next payment starts.`);
      }
      if (result?.schema !== 'fieldproof-agent-contact-v1' || result.status !== 'done' ||
          result.operation_id !== operation.operation_id || result.peaq !== 'not_used' || result.commercial_revenue !== false ||
          result.payment_verification?.state !== 'verified' || !result.purchase?.purchase_id ||
          !result.purchase?.settlement?.transaction || typeof result.purchase?.receipt?.result?.closed !== 'boolean' ||
          result.payment_verification.transaction !== result.purchase.settlement.transaction ||
          result.payment_verification.merchant_delta_base_units !== '1000' ||
          result.purchase.receipt.request_id !== result.purchase.purchase_id ||
          !Number.isSafeInteger(result.purchase_duration_ms) || result.purchase_duration_ms < 0 ||
          ids.has(result.purchase.purchase_id) || transactions.has(result.purchase.settlement.transaction)) {
        summary.reason = 'payment_or_distinct_receipt_not_verified';
        summary.review_operation_id = operation.operation_id;
        throw new Error('Saved result requires review. No next payment starts.');
      }
      ids.add(result.purchase.purchase_id); transactions.add(result.purchase.settlement.transaction);
      summary.transactions.push(result.purchase.settlement.transaction);
      summary.receipts.push({ operation_id: operation.operation_id, purchase_id: result.purchase.purchase_id,
        file: operation.output, completed_at: result.purchase.receipt.completed_at,
        current_evidence: result.current_evidence, current_decision: result.current_decision });
      summary.contact_states.push(result.purchase.receipt.result.closed ? 'CLOSED' : 'OPEN');
      summary.purchase_duration_ms.push(result.purchase_duration_ms);
      summary.completed++;
      summary.total_verified_base_units = String(summary.completed * 1000);
      report({ phase: 'paid_check_verified', completed: summary.completed, operation_id: operation.operation_id,
        transaction: result.purchase.settlement.transaction, closed: result.purchase.receipt.result.closed });
    }
    summary.status = 'completed';
    summary.observed_input_change = new Set(summary.contact_states).size > 1;
    return summary;
  } finally { privateJSON(resolve(directory, 'result.json'), summary); }
}

async function main() {
  const { values } = parseArgs({ options: {
    execute: { type: 'boolean', default: false }, 'check-device': { type: 'boolean', default: false },
    keypair: { type: 'string' }, count: { type: 'string', default: '3' },
    'output-directory': { type: 'string' }, port: { type: 'string', default: '4027' },
    'ble-address': { type: 'string' },
  } });
  const count = Number(values.count), port = Number(values.port);
  checkCount(count);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Select a local port from 1024 to 65535.');
  if (values.execute && values['check-device']) throw new Error('Select either a no-payment device check or explicit paid execution.');
  if (values['ble-address']) {
    if (!/^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(values['ble-address'])) throw new Error('Use the trusted board Bluetooth MAC address.');
    process.env.FIELDPROOF_BLE_ADDRESS = values['ble-address'];
  }
  // Use installed host dependencies and a writable cache. Do not install packages during paid delivery.
  process.env.UV_CACHE_DIR ??= '/tmp/fieldproof-uv-cache';
  if (!values.execute) {
    if (values.keypair || values['output-directory']) throw new Error('Wallet and output-directory options require explicit execution.');
    if (values['check-device']) {
      try { console.log(JSON.stringify(await checkPhysicalContact(), null, 2)); }
      catch (error) { throw new Error(`Real board check failed (${deviceFailure(error)}). Run scripts/check_execution_access.py. No wallet was read or payment started.`); }
    } else console.log(JSON.stringify({ ...contactToolPreview(`http://127.0.0.1:${port}`), requested: count,
      maximum_batch_base_units: String(count * 1000), physical_input_change_required: false }, null, 2));
    return;
  }
  if (!values.keypair || !values['output-directory']) throw new Error('Explicit execution requires a disposable Devnet keypair and a new output directory.');
  let store, server, signer;
  const origin = `http://127.0.0.1:${port}`;
  try {
    const result = await runPaidChecks({ directory: resolve(values['output-directory']), count,
      report: event => console.log(JSON.stringify(event)),
      purchase: async operation => {
        if (!server) {
          const paymentServer = await createPaymentServer(new HTTPFacilitatorClient({ url: 'https://x402.org/facilitator' }));
          store = new PurchaseStore(resolve(root, '.local/purchases.sqlite'));
          const app = await createGateway({ paymentServer, store, origin });
          await new Promise((done, reject) => {
            server = app.listen(port, '127.0.0.1', done);
            server.once('error', reject);
          });
          signer = await loadBuyerSigner(values.keypair);
        }
        return runContactOperation({ signer, operation, origin,
          directory: resolve(root, '.local/live-buyer', signer.address),
          readPurchaseState: id => store.get(id)?.state });
      } });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (server?.listening) await new Promise(done => server.close(done));
    store?.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ status: 'blocked',
    message: error.code ? 'Local storage or port is unavailable. Preserve existing run files. No automatic retry.' : error.message })); process.exitCode = 1; });
}
