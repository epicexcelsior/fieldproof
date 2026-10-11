// Explicit opt-in: one local click authorizes one small Devnet purchase with a disposable buyer.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { createGateway, createPaymentServer, PAY_TO } from './server.js';
import { buyObservation, loadBuyerSigner } from './buyer.js';
import { PurchaseStore } from './store.js';
import { createLocalBuyer, mountLocalBuyer, DEFAULT_BUYER_MAXIMUM } from './local-buyer.js';
import { EventStore } from './event-store.js';
import { performPaidJob } from './paid-job.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  'ble-address': { type: 'string' }, 'peaq-policy': { type: 'string' },
} });
const [keyPath] = positionals;
if (!keyPath || positionals.length !== 1) throw new Error('Usage: node gateway/live-demo.js /path/to/disposable-devnet.keypair.json [--ble-address AA:BB:CC:DD:EE:FF] [--peaq-policy public-policy.json]');
const bleAddress = values['ble-address'] ?? process.env.FIELDPROOF_BLE_ADDRESS;
if (bleAddress !== undefined) {
  if (!/^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(bleAddress)) throw new Error('Use the configured board Bluetooth MAC address');
  process.env.FIELDPROOF_BLE_ADDRESS = bleAddress;
}
const signer = await loadBuyerSigner(keyPath);
const port = Number(process.env.CAPMESH_GATEWAY_PORT || 4026);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use a local port from 1024 to 65535');
const origin = `http://127.0.0.1:${port}`;
const paymentServer = await createPaymentServer(new HTTPFacilitatorClient({ url: 'https://x402.org/facilitator' }));
const store = new PurchaseStore(resolve(root, '.local/purchases.sqlite'));
const events = values['peaq-policy'] ? new EventStore(store) : undefined;
const policyPath = values['peaq-policy'] ? resolve(values['peaq-policy']) : undefined;
const app = await createGateway({ paymentServer, store, origin, events });
const directory = resolve(root, '.local/live-buyer', signer.address);
const controller = createLocalBuyer({ directory, payer: signer.address, payTo: PAY_TO,
  readPurchaseState: id => store.get(id)?.state,
  buy: onProgress => events ? performPaidJob({ signer, origin, policyPath, events, onProgress })
    : buyObservation(signer, origin, { onProgress }) });
mountLocalBuyer(app, controller, origin);
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`FieldProof real Devnet buyer: ${origin}/${events ? 'jobs' : 'proof?present=1'}`);
  console.log(`Buyer ${signer.address}. Each click pays up to 0.001 Devnet USDC. Maximum ${DEFAULT_BUYER_MAXIMUM} shared lifetime purchases (${(DEFAULT_BUYER_MAXIMUM / 1000).toFixed(3)} test USDC).`);
  console.log('The private key remains in this process. No purchase starts until the local button is selected.');
});
server.on('error', error => { controller.close(); throw error; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  server.close();
  if (!controller.close()) console.error('Purchase still active. Preserve its pending record and directory lock for review.');
  process.exit(0);
});
