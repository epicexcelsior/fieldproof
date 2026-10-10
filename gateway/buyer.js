import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt, verify } from 'node:crypto';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { createKeyPairSignerFromBytes } from '@solana/kit';
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { ExactSvmScheme } from '@x402/svm/exact/client';
import { decodePaymentResponseHeader } from '@x402/core/http';
import { NETWORK, USDC, PAY_TO } from './server.js';
import { contactContract, DEFAULT_CONTACT, loadReceiptPins, receiptKey } from './contact.js';
import { saveBuyerRun } from './buyer-output.js';
import { contactPolicy } from '../docs/settlement.mjs';
import { checkIdentity, validateProviderPolicy } from './peaq.js';

const provisionedKey = loadReceiptPins()[DEFAULT_CONTACT.provider];

export function allowedOffers(offers, payTo = PAY_TO) {
  return offers.filter(offer => offer.scheme === 'exact' && offer.network === NETWORK && offer.asset === USDC &&
    offer.payTo === payTo && /^\d+$/.test(offer.amount) && BigInt(offer.amount) > 0n && BigInt(offer.amount) <= 1000n);
}

export async function loadBuyerSigner(path) {
  const bytes = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every(v => Number.isInteger(v) && v >= 0 && v <= 255)) {
    throw new Error('Use a 64-byte Solana CLI keypair file');
  }
  return createKeyPairSignerFromBytes(Uint8Array.from(bytes));
}

export function checkEvidence(body, purchase, now = Math.floor(Date.now() / 1000), publicKey = provisionedKey, selectedContact = DEFAULT_CONTACT, purpose = 'gate-access') {
  const contact = contactContract(selectedContact);
  const policy = contactPolicy(purpose, contact.sensor);
  const r = body?.receipt, s = r?.result;
  if (!r || r.protocol !== 'capmesh/0.1' || r.status !== 'success' || r.provider !== contact.provider ||
      r.capability !== 'state.observe' || r.request_id !== purchase.id || r.nonce !== purchase.nonce ||
      r.parameters?.location !== 'demo-gate' || Object.keys(r.parameters).length !== 1 ||
      s?.metric !== 'gate.closed' || s.sensor !== contact.sensor ||
      typeof s.closed !== 'boolean' || s.total_samples !== 5 || s.stable_samples !== 5 ||
      !Number.isInteger(r.started_at) || !Number.isInteger(r.completed_at) || r.started_at > r.completed_at ||
      r.started_at < purchase.created_at - 2 || r.completed_at > now + 2 || now - r.completed_at > purchase.max_age_seconds) {
    throw new Error('Evidence does not satisfy the buyer challenge, contact contract, or freshness limit');
  }
  const message = ['fieldproof-observation-v1', r.protocol, r.request_id, r.provider, r.capability,
    r.parameters.location, r.nonce, s.metric, s.sensor, Number(s.closed), s.stable_samples, s.total_samples,
    r.started_at, r.completed_at].join('|');
  const key = receiptKey(publicKey);
  const encoded = r.receipt_signature?.startsWith('v3:') ? r.receipt_signature.slice(3) : '';
  const signature = Buffer.from(encoded, 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== encoded ||
      !verify('sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' }, signature)) {
    throw new Error('Receipt authentication failed');
  }
  return { decision: policy.decision(true, s.closed), evidence_age_seconds: Math.max(0, now - r.completed_at),
    receipt_identity: 'pinned-device-p256' };
}

export async function buyObservation(signer, origin = 'http://127.0.0.1:4021', options = {}) {
  const contact = contactContract(options.contact);
  const purpose = options.purpose ?? 'gate-access';
  contactPolicy(purpose, contact.sensor); // Reject incompatible local policy before any request or payment.
  const receiptPublicKey = options.receiptPublicKey ?? loadReceiptPins(options.pinsPath)[contact.provider];
  receiptKey(receiptPublicKey); // Buyer configuration, never a key from the gateway response.
  let identity;
  if (options.peaq !== undefined) {
    const policy = validateProviderPolicy(options.peaq.policy);
    if (policy.provider !== contact.provider || policy.sensor !== contact.sensor || policy.receipt_public_key !== receiptPublicKey ||
        typeof options.peaq.resolve !== 'function') throw new Error('peaq policy does not match the trusted buyer contact and key');
    identity = checkIdentity(await options.peaq.resolve(), policy);
    options.onProgress?.({ phase: 'identity', machine_id: identity.machine_id });
  }
  const url = new URL(origin);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('The prototype buyer accepts only a loopback gateway');
  const nonce = randomInt(1, 0x7fffffff);
  const createdAt = Math.floor(Date.now() / 1000);
  const created = await fetch(new URL('/requests', url), { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nonce, location: 'demo-gate', max_age_seconds: 10, contact, receipt_public_key: receiptPublicKey }),
    signal: AbortSignal.timeout(10000) });
  if (created.status !== 201) throw new Error(`Request creation failed: HTTP ${created.status}`);
  const purchase = { ...await created.json(), created_at: createdAt };
  const expectedUrl = new URL(`/observe/${purchase.id}`, url).href;
  if (!/^[0-9a-f]{16}$/.test(purchase.id) || purchase.nonce !== nonce || purchase.observe_url !== expectedUrl ||
      purchase.location !== 'demo-gate' || purchase.max_age_seconds !== 10 || !isDeepStrictEqual(purchase.contact, contact) ||
      purchase.receipt_public_key !== receiptPublicKey) {
    throw new Error('Gateway changed the buyer challenge, contact contract, public pin, location, freshness limit, or endpoint');
  }
  options.onProgress?.({ phase: 'request', purchase_id: purchase.id });
  const client = new x402Client();
  client.registerPolicy((_version, offers) => allowedOffers(offers));
  client.register(NETWORK, new ExactSvmScheme(signer));
  const trackedFetch = async (input, init) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (headers.has('PAYMENT-SIGNATURE')) options.onProgress?.({ phase: 'paying', purchase_id: purchase.id });
    const response = await fetch(input, init);
    if (response.status === 402) options.onProgress?.({ phase: 'quote', purchase_id: purchase.id });
    return response;
  };
  const paidFetch = wrapFetchWithPayment(trackedFetch, client);
  let response;
  try { response = await paidFetch(expectedUrl, { signal: AbortSignal.timeout(45000) }); }
  catch { throw new Error(`Payment outcome is unknown. Keep purchase ID ${purchase.id} for review before another payment.`); }
  if (!response.ok) throw new Error(`Purchase failed: HTTP ${response.status}. Keep purchase ID ${purchase.id} for review.`);
  try {
    const settlement = decodePaymentResponseHeader(response.headers.get('PAYMENT-RESPONSE') || '');
    if (settlement.success !== true || settlement.network !== NETWORK || !settlement.transaction) throw new Error('No successful Devnet settlement response');
    const body = await response.json();
    const result = { purchase_id: purchase.id, challenge: { id: purchase.id, nonce, created_at: createdAt,
      location: purchase.location, max_age_seconds: purchase.max_age_seconds, contact }, settlement,
      ...checkEvidence(body, purchase, Math.floor(Date.now() / 1000), receiptPublicKey, contact, purpose),
      ...(purpose === 'package-pickup' ? { purpose } : {}), receipt: body.receipt,
      ...(identity ? { peaq_identity: identity } : {}) };
    options.onProgress?.({ phase: 'verified', purchase_id: purchase.id, transaction: settlement.transaction });
    return result;
  } catch { throw new Error(`Payment response or evidence failed verification. Keep purchase ID ${purchase.id} for review before another payment.`); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    provider: { type: 'string', default: DEFAULT_CONTACT.provider },
    sensor: { type: 'string', default: DEFAULT_CONTACT.sensor }, pins: { type: 'string' }, output: { type: 'string' },
    package: { type: 'boolean', default: false },
  } });
  const [path, origin] = positionals;
  if (!path || positionals.length > 2) throw new Error('Usage: node buyer.js keypair.json [http://127.0.0.1:4021] [--output new-result.json] [--provider ID --sensor gpio18-contact --pins public-pins.json] [--package --sensor gpio20-contact]');
  const contact = contactContract({ provider: values.provider, sensor: values.sensor });
  const receiptPublicKey = loadReceiptPins(values.pins)[contact.provider];
  receiptKey(receiptPublicKey);
  const signer = await loadBuyerSigner(path);
  const action = async () => {
    const result = await buyObservation(signer, origin, { contact, receiptPublicKey, purpose: values.package ? 'package-pickup' : 'gate-access' });
    console.log(JSON.stringify(result, null, 2)); // Preserve successful evidence even if the output file fails.
    return result;
  };
  if (values.output) await saveBuyerRun(values.output, action);
  else await action();
}
