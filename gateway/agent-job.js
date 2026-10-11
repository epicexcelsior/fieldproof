// A bounded CLI tool for an agent. Job input cannot choose wallets, recipients, networks, or budgets.
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { loadBuyerSigner } from './buyer.js';
import { loadProviderPolicy, resolveIdentity, checkIdentity } from './peaq.js';
import { PurchaseStore } from './store.js';
import { EventStore } from './event-store.js';
import { createLocalBuyer, DEFAULT_BUYER_MAXIMUM } from './local-buyer.js';
import { performPaidJob } from './paid-job.js';

async function main() {
const { values } = parseArgs({ options: {
  policy: { type: 'string' }, keypair: { type: 'string' }, origin: { type: 'string', default: 'http://127.0.0.1:4026' },
  execute: { type: 'boolean', default: false }, operation: { type: 'string' },
  database: { type: 'string', default: '.local/purchases.sqlite' },
} });
if (!values.policy) throw new Error('Use --policy public-policy.json. Add --execute --keypair only after approving the test budget.');
const policyPath = resolve(values.policy);
const policy = await loadProviderPolicy(policyPath);
if (!values.execute) {
  const identity = checkIdentity(await resolveIdentity(policyPath), policy);
  console.log(JSON.stringify({ ready: true, spending: false, identity, price_base_units: '1000',
    maximum_operations: DEFAULT_BUYER_MAXIMUM, maximum_total_base_units: String(DEFAULT_BUYER_MAXIMUM * 1000),
    token: 'Devnet USDC (test tokens)', action: 'check-contact' }, null, 2));
} else {
  if (!values.keypair) throw new Error('Explicit execution requires a disposable Devnet keypair file');
  const signer = await loadBuyerSigner(values.keypair);
  const purchases = new PurchaseStore(values.database);
  const events = new EventStore(purchases);
  const controller = createLocalBuyer({ directory: resolve('.local/live-buyer', signer.address), payer: signer.address,
    payTo: policy.pay_to, readPurchaseState: id => purchases.get(id)?.state,
    buy: onProgress => performPaidJob({ signer, origin: values.origin, policyPath, events, onProgress }) });
  try {
    const id = values.operation ?? randomUUID();
    const started = controller.start(id);
    if (started.code >= 400) throw new Error(started.error);
    let status = controller.status(id);
    while (status.status === 'pending') {
      await new Promise(resolveWait => setTimeout(resolveWait, 250));
      status = controller.status(id);
    }
    if (status.status !== 'done') throw new Error(`Keep operation ${id} and purchase ${status.purchase_id ?? 'not created'} for review. No automatic paid retry.`);
    const row = events.get(status.purchase_id);
    console.log(JSON.stringify({ operation_id: id, status: 'done', job: JSON.parse(row.job_utf8),
      event: { state: row.state, submitted: false } }, null, 2));
  } finally {
    controller.close();
    purchases.close();
  }
}
}
main().catch(error => { console.error(JSON.stringify({ status: 'error', message: error.message })); process.exitCode = 1; });
