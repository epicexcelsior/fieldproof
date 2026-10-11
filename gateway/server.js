import express from 'express';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { ExactSvmScheme } from '@x402/svm/exact/server';
import { getTransactionDecoder } from '@solana/kit';
import { PurchaseStore } from './store.js';
import { contactContract, DEFAULT_CONTACT, loadReceiptPins, receiptKey } from './contact.js';
import { publicBuyerRun, contactPolicy } from '../docs/settlement.mjs';

import { NETWORK, USDC, PAY_TO } from './constants.js';
export { NETWORK, USDC, PAY_TO } from './constants.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const guideReferences = new Set(['README.md', 'FOCUS.md', 'REHEARSAL.md', 'STRATEGY.md', 'VERIFICATION.md', 'DEMO.md', 'JOBS.md',
  'SUBMISSION.md', 'BOUNTY_PLAN.md', 'PEAQ_INTEGRATION.md', 'CONTACT_SETUP.md', 'HARDWARE_NEXT.md',
  'CORROBORATION.md', 'PROTOCOL.md', 'RECEIPT_IDENTITY.md', 'OVERVIEW.md', 'diagnostics.html']);

export async function createPaymentServer(facilitator) {
  const server = new x402ResourceServer(facilitator).register(NETWORK, new ExactSvmScheme());
  await server.initialize();
  if (!server.getSupportedKind(2, NETWORK, 'exact')) throw new Error('Facilitator must support x402 V2 exact on Solana Devnet');
  return server;
}
export function observeHardware(purchase) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('uv', ['run', '--offline', '--no-sync', '--project', 'host', 'python', 'gateway/bridge_call.py'], {
      cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let error = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 32768) child.kill('SIGKILL'); });
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-4096); });
    child.on('error', err => { clearTimeout(timer); rejectPromise(err); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return rejectPromise(new Error(error.trim() || 'Observation bridge failed'));
      try { resolvePromise(JSON.parse(output)); } catch (err) { rejectPromise(err); }
    });
    child.stdin.on('error', () => {}); // The close/error handlers report an early bridge exit.
    child.stdin.end(JSON.stringify(purchase));
  });
}
export async function createGateway({ paymentServer, store, observe = observeHardware,
    origin = 'http://127.0.0.1:4021', payTo = PAY_TO, simulated = false,
    sensor = simulated ? 'simulated-contact' : 'gpio9-contact',
    provider = sensor === 'simulated-contact' ? 'sim-contact-01' : DEFAULT_CONTACT.provider, assetsRoot = root,
    receiptPins = loadReceiptPins(process.env.FIELDPROOF_RECEIPT_PINS), buyerRunPath, buyerPurpose = 'gate-access', events } = {}) {
  const contact = contactContract({ provider, sensor }, { simulated });
  contactPolicy(buyerPurpose, sensor);
  const publicKey = sensor === 'simulated-contact' ? null : receiptPins[provider];
  if (sensor !== 'simulated-contact') receiptKey(publicKey);
  const requirements = await paymentServer.buildPaymentRequirements({
    scheme: 'exact', price: { asset: USDC, amount: '1000' }, network: NETWORK, payTo,
  });
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2kb' }));
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/learn', (_req, res) => {
    const guide = readFileSync(resolve(assetsRoot, 'docs/HOW_IT_WORKS.html'), 'utf8');
    // The docs server and standalone export have different roots. Keep this route local and references public.
    res.type('html').send(guide.replace(/href="([^"]+)"/g, (attribute, target) => {
      if (target === 'http://127.0.0.1:4022/proof?present=1') return 'href="/proof?present=1"';
      if (target === 'overview.html') return 'href="/"';
      if (guideReferences.has(target.split('#')[0])) {
        return `href="https://github.com/epicexcelsior/fieldproof/blob/main/docs/${target}"`;
      }
      return attribute;
    }));
  });
  // Check only these relative asset names for dotfiles, not the trusted checkout path.
  for (const [route, file] of Object.entries({
    '/': 'docs/overview.html', '/proof': 'docs/proof.html', '/proof.js': 'docs/proof.js',
    '/jobs': 'docs/jobs.html', '/jobs.mjs': 'docs/jobs.mjs',
    '/settlement.mjs': 'docs/settlement.mjs',
    '/receipt-keys.json': 'host/capmesh/protocol/receipt_keys.json',
    '/evidence/device-signed-purchase.json': 'docs/evidence/device-signed-purchase.json',
    '/evidence/device-signed-contact-states.json': 'docs/evidence/device-signed-contact-states.json',
    '/assets/fieldproof-signed-receipt.webm': 'docs/assets/fieldproof-signed-receipt.webm',
    '/assets/fieldproof-service-boundaries.svg': 'docs/assets/fieldproof-service-boundaries.svg',
    '/assets/fieldproof-payment-to-observation.svg': 'docs/assets/fieldproof-payment-to-observation.svg',
    '/assets/fieldproof-service-expansion.svg': 'docs/assets/fieldproof-service-expansion.svg',
    '/assets/fieldproof-demo.webm': 'docs/assets/fieldproof-demo.webm',
    '/assets/fieldproof-walkthrough.webm': 'docs/assets/fieldproof-walkthrough.webm',
    '/assets/fieldproof-submission.webm': 'docs/assets/fieldproof-submission.webm',
    '/evidence/devnet-purchase.json': 'docs/evidence/devnet-purchase.json',
    '/evidence/contact-states.json': 'docs/evidence/contact-states.json',
  })) app.get(route, (_req, res) => res.sendFile(file, { root: assetsRoot }));
  app.get('/jobs/:id', (req, res) => {
    if (!/^[0-9a-f]{16}$/.test(req.params.id)) return res.status(400).json({ error: 'Use a valid job ID.' });
    const saved = events?.get(req.params.id);
    if (!saved) return res.status(404).json({ error: 'No peaq-linked job exists for this purchase.' });
    res.json({ job: JSON.parse(saved.job_utf8), event: { state: saved.state,
      transaction_hash: saved.transaction_hash, data_hash: saved.data_hash,
      confirmation: saved.confirmation ? JSON.parse(saved.confirmation) : null } });
  });
  app.get('/health', (_req, res) => res.json({ ready: true, network: NETWORK, payTo,
    capability: 'state.observe', location: 'demo-gate', price_base_units: '1000',
    provider, sensor, contact, receipt_public_key: publicKey,
    receipt_identity: sensor === 'simulated-contact' ? 'public-demo-hmac' : 'pinned-device-p256',
    mode: simulated ? 'simulated settlement; no funds moved' : 'Solana Devnet; physical contact demo' }));
  app.get('/demand', (_req, res) => res.json(store.demand()));
  app.get('/buyer-run', (_req, res) => {
    if (!buyerRunPath) return res.status(404).json({ error: 'No independent buyer output is configured.' });
    let file;
    try {
      file = openSync(buyerRunPath, 'r');
      const buffer = Buffer.alloc(32769), size = readSync(file, buffer, 0, buffer.length, 0);
      if (size > 32768) throw new Error('Buyer output exceeds its inspection limit');
      // Select only public contract fields. A wallet array or extra secret fields never reach the browser.
      res.json(publicBuyerRun(JSON.parse(buffer.subarray(0, size).toString('utf8')), buyerPurpose));
    } catch (error) {
      res.status(error.code === 'ENOENT' ? 404 : 503).json({ error: 'Buyer output is unavailable or incomplete. Preserve the buyer terminal result.' });
    } finally { if (file !== undefined) closeSync(file); }
  });
  app.get('/manifest', (_req, res) => res.json({ product: 'FieldProof', metric: 'gate.closed',
    location: 'demo-gate', sensor, provider, contact, receipt_public_key: publicKey,
    price: '0.001 USDC', confidence: null, create_request: '/requests' }));
  app.post('/requests', (req, res) => {
    const body = req.body || {};
    const { nonce, location = 'demo-gate', max_age_seconds = 10 } = body;
    if (!Number.isInteger(nonce) || nonce < 1 || nonce > 0x7fffffff || location !== 'demo-gate' ||
        !Number.isInteger(max_age_seconds) || max_age_seconds < 1 || max_age_seconds > 30) {
      return res.status(400).json({ error: 'Use a positive 32-bit nonce, demo-gate, and freshness from 1 to 30 seconds' });
    }
    if ((body.contact !== undefined && !isDeepStrictEqual(body.contact, contact)) ||
        (body.contact === undefined && sensor !== 'simulated-contact' && !isDeepStrictEqual(contact, DEFAULT_CONTACT))) {
      return res.status(400).json({ error: 'Request the configured provider and sensor explicitly. Check the local manifest.' });
    }
    if ((body.receipt_public_key !== undefined && body.receipt_public_key !== publicKey) ||
        (sensor !== 'simulated-contact' && !isDeepStrictEqual(contact, DEFAULT_CONTACT) && body.receipt_public_key === undefined)) {
      return res.status(400).json({ error: 'The requested public pin does not match the configured contact key. Use your trusted device pin.' });
    }
    const purchase = { id: randomUUID().replaceAll('-', '').slice(0, 16), nonce, location,
      contact, receipt_public_key: publicKey, max_age_seconds, expires_at: Math.floor(Date.now() / 1000) + 120 };
    try { store.create(purchase); }
    catch (error) {
      if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'Nonce already belongs to a purchase' });
      throw error;
    }
    res.status(201).json({ ...purchase, observe_url: `${origin}/observe/${purchase.id}` });
  });
  app.get('/observe/:id', async (req, res) => {
    const purchase = store.get(req.params.id);
    if (!purchase) return res.status(404).json({ error: 'Unknown observation purchase' });
    // Reject changed or legacy quotes before advertising a payment challenge.
    // Delivered receipts still use the cached-evidence path below.
    if (purchase.state === 'quoted') {
      if (Math.floor(Date.now() / 1000) > purchase.expires_at) return res.status(410).json({ error: 'Purchase expired. Create a new request.' });
      if (!purchase.contact) return res.status(410).json({ error: 'Legacy quote has no persisted device contract. Create a new request. No payment occurred.' });
      if (!isDeepStrictEqual(purchase.contact, contact) || purchase.receipt_public_key !== publicKey) {
        return res.status(409).json({ error: 'Gateway contact configuration changed. Create a new request. No payment occurred.' });
      }
    }
    const resource = { url: `${origin}/observe/${purchase.id}`, description: `Fresh gate contact evidence at demo-gate (${purchase.contact?.provider || 'legacy quote'}, ${purchase.contact?.sensor || 'unbound input'})`, mimeType: 'application/json' };
    const challenge = async error => {
      const required = await paymentServer.createPaymentRequiredResponse(requirements, resource, error);
      res.set('PAYMENT-REQUIRED', encodePaymentRequiredHeader(required));
      return res.status(402).json(required);
    };
    const header = req.get('PAYMENT-SIGNATURE');
    if (!header) return challenge();
    let payload;
    try { payload = decodePaymentSignatureHeader(header); } catch { return challenge('Malformed payment payload'); }
    if (payload.x402Version !== 2 || payload.resource?.url !== resource.url ||
        !isDeepStrictEqual(payload.accepted, requirements[0]) ||
        typeof payload.payload?.transaction !== 'string' || payload.payload.transaction.length > 12000) {
      return challenge('Payment does not match this resource and its requirements');
    }
    let proofHash;
    try {
      const bytes = Buffer.from(payload.payload.transaction, 'base64');
      // The facilitator replaces its signature. Deduplicate the signed message, which defines the payment.
      const message = simulated && bytes.toString('utf8').startsWith('FIELDPROOF-SIM:')
        ? bytes : getTransactionDecoder().decode(bytes).messageBytes;
      proofHash = createHash('sha256').update(message).digest('hex');
    } catch { return challenge('Malformed Solana transaction'); }
    if (purchase.state !== 'quoted') {
      if (purchase.proof_hash !== proofHash) return res.status(409).json({ error: 'Purchase already uses another payment' });
      if (purchase.settlement) res.set('PAYMENT-RESPONSE', encodePaymentResponseHeader(JSON.parse(purchase.settlement)));
      if (purchase.state === 'delivered') {
        const cached = JSON.parse(purchase.result);
        const measured = cached.receipt?.completed_at;
        const now = Math.floor(Date.now() / 1000);
        const fresh = Number.isInteger(measured) && now - measured <= purchase.max_age_seconds && measured <= now + 2;
        return res.json({ ...cached, evidence_cached: true, decision: {
          ...cached.decision, age_seconds: Number.isInteger(measured) ? Math.max(0, now - measured) : null,
          ...(fresh ? {} : { decision: 'WAIT', reason: 'Cached evidence expired. Create a new observation request.' }),
        } });
      }
      return res.status(409).json({ error: purchase.error || 'Purchase requires settlement or delivery review', state: purchase.state });
    }
    let verified;
    try { verified = await paymentServer.verifyPayment(payload, requirements[0]); }
    catch { return res.status(503).json({ error: 'Payment verification unavailable. No measurement occurred.' }); }
    if (!verified.isValid) return challenge('Payment verification failed');
    if (!store.reserve(purchase.id, proofHash)) return res.status(409).json({ error: 'Payment or purchase is already in progress or consumed' });
    let settlement;
    try {
      settlement = await paymentServer.settlePayment(payload, requirements[0]);
      if (!settlement.success) {
        store.finish(purchase.id, 'payment_failed', { settlement, error: 'Settlement failed. No measurement occurred.' });
        return challenge('Settlement failed');
      }
      if (settlement.network !== NETWORK || !settlement.transaction) throw new Error('Invalid settlement response');
    } catch {
      store.finish(purchase.id, 'settlement_unknown', { error: 'Settlement outcome is unknown. Review before retrying.' });
      return res.status(503).json({ error: 'Settlement outcome is unknown. No measurement occurred. Keep the purchase ID.', purchase_id: purchase.id });
    }
    store.finish(purchase.id, 'measuring', { settlement });
    res.set('PAYMENT-RESPONSE', encodePaymentResponseHeader(settlement));
    try {
      const evidence = await observe({ ...purchase, simulated });
      const result = { ...evidence, purchase_id: purchase.id,
        payment_mode: simulated ? 'simulated; no funds moved' : 'Solana Devnet USDC', settlement, evidence_cached: false };
      store.finish(purchase.id, 'delivered', { settlement, result });
      return res.json(result);
    } catch (error) {
      console.error('Observation delivery failed:', error.name);
      store.finish(purchase.id, 'delivery_failed', { settlement, error: 'Payment settled. Evidence delivery failed. Refund review required.' });
      return res.status(503).json({ error: 'Payment settled. Evidence delivery failed. Keep the purchase ID for refund review.', purchase_id: purchase.id });
    }
  });
  if (simulated) {
    app.post('/simulate/:id', async (req, res) => {
      const purchase = store.get(req.params.id);
      if (!purchase) return res.status(404).json({ error: 'Unknown simulation purchase' });
      const resource = { url: `${origin}/observe/${purchase.id}` };
      const transaction = Buffer.from(`FIELDPROOF-SIM:${purchase.id}`).toString('base64');
      const payload = { x402Version: 2, resource, accepted: requirements[0], payload: { transaction } };
      try {
        const response = await fetch(resource.url, { headers: { 'PAYMENT-SIGNATURE': encodePaymentSignatureHeader(payload) }, signal: AbortSignal.timeout(35000) });
        const body = await response.json();
        res.status(response.status).json(body);
      } catch { res.status(503).json({ error: 'Simulation request failed. Check the gateway process.' }); }
    });
  }
  app.use((error, _req, res, _next) => {
    res.status(error.type === 'entity.parse.failed' ? 400 : 500).json({ error: 'The request failed. Check the local gateway log.' });
  });
  return app;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.CAPMESH_GATEWAY_PORT || 4021);
  const contact = contactContract({ provider: process.env.FIELDPROOF_PROVIDER_ID || DEFAULT_CONTACT.provider,
    sensor: process.env.FIELDPROOF_CONTACT_SENSOR || DEFAULT_CONTACT.sensor });
  const receiptPins = loadReceiptPins(process.env.FIELDPROOF_RECEIPT_PINS);
  receiptKey(receiptPins[contact.provider]);
  const paymentServer = await createPaymentServer(new HTTPFacilitatorClient({ url: process.env.FACILITATOR_URL || 'https://x402.org/facilitator' }));
  const store = new PurchaseStore(resolve(root, '.local/purchases.sqlite'));
  const app = await createGateway({ paymentServer, store, origin: `http://127.0.0.1:${port}`, payTo: process.env.SOLANA_PAY_TO || PAY_TO,
    ...contact, receiptPins, buyerPurpose: process.env.FIELDPROOF_BUYER_PURPOSE || 'gate-access', buyerRunPath: process.env.FIELDPROOF_BUYER_RUN_FILE
      ? resolve(root, process.env.FIELDPROOF_BUYER_RUN_FILE) : undefined });
  app.listen(port, '127.0.0.1', () => console.log(`FieldProof gateway on http://127.0.0.1:${port}`));
}
