// Solana-only agent tool. Payment terms and device trust come from local operator configuration.
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buyObservation, checkEvidence, loadBuyerSigner } from './buyer.js';
import { DEFAULT_CONTACT, loadReceiptPins, receiptKey } from './contact.js';
import { NETWORK, USDC, PAY_TO } from './constants.js';
import { PurchaseStore } from './store.js';
import { createLocalBuyer } from './local-buyer.js';
import { querySettlement } from '../docs/settlement.mjs';
import { saveBuyerRun } from './buyer-output.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const operationPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function localOrigin(origin) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) throw new Error('Use a loopback HTTP gateway origin without credentials or a path.');
  return url.origin;
}

export function contactToolPreview(origin = 'http://127.0.0.1:4021') {
  const pin = loadReceiptPins()[DEFAULT_CONTACT.provider];
  receiptKey(pin);
  return { schema: 'fieldproof-agent-contact-v1', status: 'configuration_checked', spending: false,
    gateway: localOrigin(origin), contact: DEFAULT_CONTACT, receipt_public_key: pin,
    payment: { network: NETWORK, asset: USDC, recipient: PAY_TO, maximum_base_units: '1000', kind: 'test-token' },
    max_age_seconds: 10, maximum_operations: 10, peaq: 'not_used',
    note: 'Local configuration only. Network, device, funds, and customer demand remain unverified.' };
}

export async function runContactOperation({ signer, operation, origin = 'http://127.0.0.1:4021', directory,
    readPurchaseState, buy = buyObservation, verifyPayment = querySettlement,
    now = () => Math.floor(Date.now() / 1000), report = () => {} }) {
  if (!operationPattern.test(operation ?? '')) throw new Error('Supply one UUID v4 operation ID. Reuse it to inspect the same purchase.');
  const terms = contactToolPreview(origin);
  const controller = createLocalBuyer({ directory, payer: signer.address, payTo: PAY_TO, maximum: 10,
    readPurchaseState, buy: onProgress => buy(signer, terms.gateway,
      { contact: DEFAULT_CONTACT, receiptPublicKey: terms.receipt_public_key, onProgress }) });
  try {
    // Print the recovery ID before the existing controller journals and starts a payment.
    report({ schema: terms.schema, operation_id: operation, phase: 'operation_selected', peaq: 'not_used' });
    const started = controller.start(operation);
    if (started.code >= 400) throw new Error(started.error);
    let status = controller.status(operation);
    while (status.status === 'pending') {
      await new Promise(wait => setTimeout(wait, 25));
      status = controller.status(operation);
    }
    if (status.status !== 'done') throw new Error(`Keep operation ${operation} and purchase ${status.purchase_id ?? 'not created'} for review. No automatic paid retry.`);
    // The original run is durable before this read-only RPC query. Reuse never pays again.
    const result = { schema: terms.schema, operation_id: operation, status: 'done',
      purchase: status.run, peaq: 'not_used', commercial_revenue: false,
      payment_verification: { state: 'unavailable' }, current_decision: 'WAIT',
      current_evidence: 'unusable', note: 'DISPATCH is a demo policy result, not permission to operate equipment.' };
    try {
      result.payment_verification = { state: 'verified', ...await verifyPayment(status.run) };
    } catch {
      result.payment_verification = { state: 'unavailable',
        note: 'Original purchase is saved. Reuse this operation ID for a read-only payment check. No new payment starts.' };
    }
    // Inspect age after the RPC wait. A slow payment query cannot preserve a stale DISPATCH.
    try {
      const checked = checkEvidence(status.run, status.run.challenge, now(), terms.receipt_public_key);
      result.current_evidence = 'fresh_and_authenticated';
      if (result.payment_verification.state === 'verified') result.current_decision = checked.decision;
    } catch { /* Reinspection does not make expired evidence fresh. Keep WAIT. */ }
    return result;
  } finally { controller.close(); }
}

async function main() {
  const { values } = parseArgs({ options: {
    execute: { type: 'boolean', default: false }, keypair: { type: 'string' }, operation: { type: 'string' },
    output: { type: 'string' },
    origin: { type: 'string', default: 'http://127.0.0.1:4021' },
  } });
  contactToolPreview(values.origin); // Validate public configuration before reading a wallet.
  if (!values.execute) {
    if (values.keypair || values.operation || values.output) throw new Error('Omit wallet, operation, and output options for the no-spend configuration check.');
    console.log(JSON.stringify(contactToolPreview(values.origin), null, 2));
    return;
  }
  if (!values.keypair || !operationPattern.test(values.operation ?? '')) {
    throw new Error('Explicit execution requires --keypair and --operation UUID-v4. Review the test-token budget first.');
  }
  const execute = async () => {
    const signer = await loadBuyerSigner(values.keypair);
    const purchases = new PurchaseStore(resolve(root, '.local/purchases.sqlite'));
    try {
      return await runContactOperation({ signer, operation: values.operation, origin: values.origin,
        directory: resolve(root, '.local/live-buyer', signer.address), readPurchaseState: id => purchases.get(id)?.state,
        report: value => console.log(JSON.stringify(value)) });
    } finally { purchases.close(); }
  };
  let result;
  try { result = values.output ? await saveBuyerRun(values.output, execute) : await execute(); }
  catch (error) {
    if (error.code) throw new Error('A local file cannot be reserved, read, or saved. Preserve the operation ID and use a new output file.', { cause: error });
    throw error;
  }
  console.log(JSON.stringify(result, null, 2));
  if (result.payment_verification.state !== 'verified') process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ status: 'error', message: error.message })); process.exitCode = 1; });
}
