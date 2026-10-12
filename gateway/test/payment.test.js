import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { address, appendTransactionMessageInstruction, compileTransaction, createTransactionMessage,
  generateKeyPairSigner, getAddressEncoder, getTransactionDecoder, getTransactionEncoder,
  setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash } from '@solana/kit';
import { createGateway, createPaymentServer, NETWORK, PAY_TO, USDC } from '../server.js';
import { PurchaseStore } from '../store.js';
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { publicBuyerRun } from '../../docs/settlement.mjs';

async function fixture(t, { valid = true, settled = true, unknown = false, deliveryFails = false, path = ':memory:', sensor = 'simulated-contact', provider, receiptPins, assetsRoot, buyerRunPath, buyerPurpose, simulated = true, settlementResult, confirmPending, paymentRpcFetch } = {}) {
  const events = [];
  const observations = [];
  const facilitator = {
    getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: 'exact', network: NETWORK, extra: { feePayer: PAY_TO } }], extensions: [], signers: {} }),
    verify: async () => { events.push('verify'); return { isValid: valid, payer: PAY_TO }; },
    settle: async () => { events.push('settle'); if (unknown) throw new Error('timeout');
      return settlementResult ?? { success: settled, transaction: 'SIMULATED-TRANSACTION', network: NETWORK, payer: PAY_TO }; },
  };
  const paymentServer = await createPaymentServer(facilitator);
  const store = new PurchaseStore(path);
  const app = await createGateway({ paymentServer, store, simulated, sensor, provider, receiptPins, assetsRoot, buyerRunPath, buyerPurpose, confirmPending, paymentRpcFetch, observe: async purchase => {
    events.push('measure');
    observations.push(purchase);
    if (deliveryFails) throw new Error('device unavailable');
    return { decision: { decision: 'DISPATCH', evidence_mode: 'simulated' }, receipt: { simulated: true, completed_at: Math.floor(Date.now() / 1000) } };
  } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const health = await (await fetch(`${url}/health`)).json();
  const contact = health.contact;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); });
  async function purchase(nonce = 123) {
    const created = await fetch(`${url}/requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce, contact, receipt_public_key: health.receipt_public_key }) });
    assert.equal(created.status, 201);
    const request = await created.json();
    const route = `${url}/observe/${request.id}`;
    const response = await fetch(route);
    assert.equal(response.status, 402);
    const challenge = decodePaymentRequiredHeader(response.headers.get('PAYMENT-REQUIRED'));
    let transaction = Buffer.from('FIELDPROOF-SIM:fixture-proof').toString('base64');
    if (!simulated) {
      let message = createTransactionMessage({ version: 0 });
      message = setTransactionMessageFeePayer(address(PAY_TO), message);
      message = setTransactionMessageLifetimeUsingBlockhash({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1n }, message);
      transaction = Buffer.from(getTransactionEncoder().encode(compileTransaction(message))).toString('base64');
    }
    return { route, request, payload: { x402Version: 2, accepted: challenge.accepts[0], resource: challenge.resource,
      payload: { transaction } }, challenge };
  }
  const pay = (route, payload) => fetch(route, { headers: { 'PAYMENT-SIGNATURE': encodePaymentSignatureHeader(payload) } });
  return { url, events, observations, store, purchase, pay };
}

test('public buyer output route is bounded, sanitized, recoverable, and performs no payment or observation', async t => {
  const unconfigured = await fixture(t);
  assert.equal((await fetch(`${unconfigured.url}/buyer-run`)).status, 404);
  const dir = mkdtempSync(join(tmpdir(), 'fieldproof-public-output-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'run.json');
  const f = await fixture(t, { buyerRunPath: path });
  assert.equal((await fetch(`${f.url}/buyer-run`)).status, 404);
  for (const contents of ['{', '[1,2,3]', 'x'.repeat(32769), '{"status":"failed","error":"PRIVATE FIXTURE"}']) {
    writeFileSync(path, contents);
    const response = await fetch(`${f.url}/buyer-run`);
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.doesNotMatch(body, /PRIVATE FIXTURE|fieldproof-public-output/);
  }
  const input = JSON.parse(readFileSync(new URL('../../docs/evidence/device-signed-purchase.json', import.meta.url)));
  input.purchase.secret = 'PRIVATE FIXTURE';
  writeFileSync(path, JSON.stringify(input));
  const response = await fetch(`${f.url}/buyer-run`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const publicRun = await response.json();
  assert.equal(publicRun.purchase_id, input.purchase.purchase_id);
  assert.doesNotMatch(JSON.stringify(publicRun), /PRIVATE FIXTURE/);
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.store.demand(), []);
});

test('package output route keeps its configured purpose and rejects the old GPIO9 record without measurement', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'fieldproof-package-output-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'run.json');
  const f = await fixture(t, { buyerRunPath: path, sensor: 'gpio20-contact', buyerPurpose: 'package-pickup' });
  const input = JSON.parse(readFileSync(new URL('../../docs/evidence/device-signed-purchase.json', import.meta.url))).purchase;
  writeFileSync(path, JSON.stringify(input));
  assert.equal((await fetch(`${f.url}/buyer-run`)).status, 503);
  input.purpose = 'package-pickup';
  input.challenge.contact = { provider: 'esp32-c6-96a2', sensor: 'gpio20-contact' };
  input.receipt.result.sensor = 'gpio20-contact';
  input.secret = 'PRIVATE FIXTURE';
  writeFileSync(path, JSON.stringify(input));
  const response = await fetch(`${f.url}/buyer-run`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.purpose, 'package-pickup');
  assert.equal(body.receipt.result.sensor, 'gpio20-contact');
  assert.deepEqual(publicBuyerRun(body, 'package-pickup'), body);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE FIXTURE/);
  assert.deepEqual(f.events, []);
});

test('external contact terms survive restart and reach the observation worker unchanged', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'fieldproof-contact-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'purchases.sqlite');
  const first = await fixture(t, { path, sensor: 'gpio18-contact' });
  const p = await first.purchase();
  assert.deepEqual(p.request.contact, { provider: 'esp32-c6-96a2', sensor: 'gpio18-contact' });
  const second = await fixture(t, { path, sensor: 'gpio18-contact' });
  assert.deepEqual(second.store.get(p.request.id).contact, p.request.contact);
  assert.equal((await second.pay(`${second.url}/observe/${p.request.id}`, p.payload)).status, 200);
  assert.deepEqual(second.events, ['verify', 'settle', 'measure']);
  assert.deepEqual(second.observations[0].contact, p.request.contact);
  assert.match(second.observations[0].receipt_public_key, /^04[0-9a-f]{128}$/);
});

test('sensor, provider, or key changes reject old quotes before a payment challenge', async t => {
  const rotatedPin = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'der', type: 'spki' }).subarray(-65).toString('hex');
  for (const change of [{ sensor: 'gpio19-contact' },
    { provider: 'second-board', receiptPins: { 'second-board': rotatedPin } },
    { receiptPins: { 'esp32-c6-96a2': rotatedPin } }]) {
    const dir = mkdtempSync(join(tmpdir(), 'fieldproof-reconfigure-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'purchases.sqlite');
    const first = await fixture(t, { path, sensor: 'gpio18-contact' });
    const p = await first.purchase();
    const second = await fixture(t, { path, sensor: 'gpio18-contact', ...change });
    const route = `${second.url}/observe/${p.request.id}`;
    assert.equal((await fetch(route)).status, 409);
    assert.equal((await second.pay(route, p.payload)).status, 409);
    assert.deepEqual(second.events, []);
    assert.equal(second.store.get(p.request.id).state, 'quoted');
  }
});

test('cached delivered evidence remains retrievable after contact configuration changes', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'fieldproof-cached-contact-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'purchases.sqlite');
  const first = await fixture(t, { path, sensor: 'gpio18-contact' });
  const p = await first.purchase();
  assert.equal((await first.pay(p.route, p.payload)).status, 200);
  const second = await fixture(t, { path, sensor: 'gpio19-contact' });
  const response = await second.pay(`${second.url}/observe/${p.request.id}`, p.payload);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).evidence_cached, true);
  assert.deepEqual(second.events, []);
});

test('external input requests require matching explicit terms and reject an empty body', async t => {
  const f = await fixture(t, { sensor: 'gpio18-contact' });
  for (const body of [{}, { nonce: 1 }, { nonce: 1, contact: { provider: 'esp32-c6-96a2', sensor: 'gpio9-contact' } }]) {
    const response = await fetch(`${f.url}/requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 400);
  }
  assert.equal((await fetch(`${f.url}/requests`, { method: 'POST' })).status, 400);
  assert.deepEqual(f.store.demand(), []);
  assert.deepEqual(f.events, []);
});

test('legacy ledger migration preserves rows and rejects unbound quotes without payment', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'fieldproof-migration-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'purchases.sqlite');
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE purchases (id TEXT PRIMARY KEY, nonce INTEGER NOT NULL UNIQUE,
    location TEXT NOT NULL, max_age_seconds INTEGER NOT NULL, expires_at INTEGER NOT NULL, state TEXT NOT NULL,
    proof_hash TEXT UNIQUE, settlement TEXT, result TEXT, error TEXT);
    INSERT INTO purchases VALUES ('legacy', 1, 'demo-gate', 10, 9999999999, 'quoted', NULL, NULL, NULL, NULL);
    INSERT INTO purchases VALUES ('delivered', 2, 'demo-gate', 10, 9999999999, 'delivered', 'proof', NULL, '{"receipt":{}}', NULL);`);
  old.close();
  const f = await fixture(t, { path });
  assert.equal(f.store.get('legacy').contact, null);
  assert.equal(f.store.get('delivered').result, '{"receipt":{}}');
  assert.equal((await fetch(`${f.url}/observe/legacy`)).status, 410);
  assert.deepEqual(f.events, []);
});

test('unprovisioned physical provider fails startup before building a payment offer', async () => {
  const store = new PurchaseStore(':memory:');
  try {
    const paymentServer = { buildPaymentRequirements: () => assert.fail('No quote for an unprovisioned provider') };
    await assert.rejects(createGateway({ paymentServer, store, provider: 'missing', sensor: 'gpio18-contact' }), /provisioned/);
  } finally { store.close(); }
});

test('a different buyer pin fails before quote creation, verification, settlement, or measurement', async t => {
  const f = await fixture(t, { sensor: 'gpio18-contact' });
  const otherPin = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'der', type: 'spki' }).subarray(-65).toString('hex');
  const response = await fetch(`${f.url}/requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nonce: 789, contact: { provider: 'esp32-c6-96a2', sensor: 'gpio18-contact' }, receipt_public_key: otherPin }) });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /public pin/);
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.store.demand(), []);
});

test('physical contact metadata stays separate from simulated settlement', async t => {
  const f = await fixture(t, { sensor: 'gpio9-contact' });
  const health = await (await fetch(`${f.url}/health`)).json();
  const manifest = await (await fetch(`${f.url}/manifest`)).json();
  assert.equal(health.sensor, 'gpio9-contact');
  assert.equal(manifest.sensor, 'gpio9-contact');
  assert.equal(health.mode, 'simulated settlement; no funds moved');
  assert.equal(health.receipt_identity, 'pinned-device-p256');
  assert.deepEqual(f.events, []);
});

test('known assets serve inside a hidden checkout without exposing private paths', async t => {
  const dir = mkdtempSync(join(tmpdir(), '.fieldproof-assets-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'docs'));
  mkdirSync(join(dir, 'docs/evidence'));
  mkdirSync(join(dir, 'docs/assets'));
  mkdirSync(join(dir, '.local'));
  writeFileSync(join(dir, 'docs/proof.html'), '<h1>Receipt inspection</h1>');
  writeFileSync(join(dir, 'docs/HOW_IT_WORKS.html'), '<h1>Learn and rehearse</h1>');
  writeFileSync(join(dir, 'docs/evidence/device-signed-contact-states.json'), '{"public":"contact fixture"}');
  for (const name of ['fieldproof-service-boundaries.svg', 'fieldproof-service-expansion.svg', 'fieldproof-payment-to-observation.svg']) {
    writeFileSync(join(dir, 'docs/assets', name), '<svg xmlns="http://www.w3.org/2000/svg"><title>Public diagram</title></svg>');
  }
  writeFileSync(join(dir, '.local/private.json'), '{"private":"fixture only"}');
  const f = await fixture(t, { assetsRoot: dir });
  const page = await fetch(`${f.url}/proof`);
  assert.equal(page.status, 200);
  assert.equal(await page.text(), '<h1>Receipt inspection</h1>');
  const guide = await fetch(`${f.url}/learn`);
  assert.equal(guide.status, 200);
  assert.match(await guide.text(), /Learn and rehearse/);
  const contacts = await fetch(`${f.url}/evidence/device-signed-contact-states.json`);
  assert.equal(contacts.status, 200);
  assert.deepEqual(await contacts.json(), { public: 'contact fixture' });
  for (const name of ['fieldproof-service-boundaries.svg', 'fieldproof-service-expansion.svg', 'fieldproof-payment-to-observation.svg']) {
    const diagram = await fetch(`${f.url}/assets/${name}`);
    assert.equal(diagram.status, 200);
    assert.match(diagram.headers.get('content-type'), /image\/svg\+xml/);
    assert.match(await diagram.text(), /Public diagram/);
  }
  for (const path of ['/.local/private.json', '/gateway/buyer.js', '/.git/config', '/receipt-keys.json/../.local/private.json']) {
    assert.equal((await fetch(f.url + path)).status, 404);
  }
  assert.deepEqual(f.events, []);
});

test('actual founder guide links reach public assets or repository references', async t => {
  const f = await fixture(t);
  const response = await fetch(`${f.url}/learn`);
  assert.equal(response.status, 200);
  const page = await response.text();
  let references = 0;
  for (const match of page.matchAll(/href="([^"]+)"/g)) {
    const target = match[1];
    if (target.startsWith('#')) continue;
    const link = new URL(target, `${f.url}/learn`);
    if (link.origin !== f.url) {
      if (link.hostname === 'github.com') {
        assert.ok(link.pathname.startsWith('/epicexcelsior/fieldproof/blob/main/docs/'));
        references += 1;
      }
      continue;
    }
    assert.equal((await fetch(link)).status, 200, `Broken guide link: ${target}`);
  }
  assert.ok(page.includes('href="/proof?present=1"'));
  assert.ok(references >= 10, 'The technical references must link to the public repository');
  assert.deepEqual(f.events, []);
});

test('unpaid and malformed payments never measure', async t => {
  const f = await fixture(t);
  const p = await f.purchase();
  assert.equal(p.challenge.accepts[0].network, NETWORK);
  assert.equal(p.challenge.accepts[0].asset, USDC);
  assert.equal(p.challenge.accepts[0].amount, '1000');
  assert.deepEqual(f.events, []);
  const bad = await fetch(p.route, { headers: { 'PAYMENT-SIGNATURE': 'garbage' } });
  assert.equal(bad.status, 402);
  p.payload.payload.transaction = Buffer.from('not-a-solana-transaction').toString('base64');
  assert.equal((await f.pay(p.route, p.payload)).status, 402);
  assert.deepEqual(f.events, []);
});
test('wrong amount and resource fail before verification', async t => {
  const f = await fixture(t);
  const p = await f.purchase();
  for (const payload of [{ ...p.payload, accepted: { ...p.payload.accepted, amount: '1' } },
                         { ...p.payload, resource: { ...p.payload.resource, url: 'https://other.invalid/' } }]) {
    assert.equal((await f.pay(p.route, payload)).status, 402);
  }
  assert.deepEqual(f.events, []);
});
test('invalid facilitator verification never settles or measures', async t => {
  const f = await fixture(t, { valid: false });
  const p = await f.purchase();
  assert.equal((await f.pay(p.route, p.payload)).status, 402);
  assert.deepEqual(f.events, ['verify']);
});
test('settlement precedes measurement and retry returns the original evidence', async t => {
  const f = await fixture(t);
  const p = await f.purchase();
  const paid = await f.pay(p.route, p.payload);
  assert.equal(paid.status, 200);
  assert.ok(paid.headers.get('PAYMENT-RESPONSE'));
  assert.equal((await paid.json()).payment_mode, 'simulated; no funds moved');
  assert.deepEqual(f.events, ['verify', 'settle', 'measure']);
  const retry = await f.pay(p.route, p.payload);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).evidence_cached, true);
  assert.deepEqual(f.events, ['verify', 'settle', 'measure']);
});
test('a second purchase cannot reuse the transaction by rewriting resource JSON', async t => {
  const f = await fixture(t);
  const first = await f.purchase();
  assert.equal((await f.pay(first.route, first.payload)).status, 200);
  const second = await f.purchase(456);
  assert.equal((await f.pay(second.route, second.payload)).status, 409);
  assert.equal(f.events.filter(e => e === 'settle').length, 1);
  assert.equal(f.events.filter(e => e === 'measure').length, 1);
});
test('changing the facilitator signature cannot purchase a second observation with the same signed message', async t => {
  const buyer = await generateKeyPairSigner();
  let message = setTransactionMessageFeePayer(address(PAY_TO), createTransactionMessage({ version: 0 }));
  message = setTransactionMessageLifetimeUsingBlockhash({
    blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n,
  }, message);
  message = appendTransactionMessageInstruction({ programAddress: address('11111111111111111111111111111111'),
    accounts: [{ address: buyer.address, role: 2 }], data: new Uint8Array() }, message);
  const tx = compileTransaction(message);
  const [signatures] = await buyer.signTransactions([tx]);
  const original = Uint8Array.from(getTransactionEncoder().encode({ ...tx, signatures: { ...tx.signatures, ...signatures } }));
  const altered = Uint8Array.from(original);
  altered[1] ^= 1; // The facilitator replaces its own signature before broadcasting.
  const decoded = getTransactionDecoder().decode(altered);
  assert.deepEqual(decoded.messageBytes, tx.messageBytes);
  const key = await crypto.subtle.importKey('raw', getAddressEncoder().encode(buyer.address), 'Ed25519', false, ['verify']);
  assert.equal(await crypto.subtle.verify('Ed25519', key, decoded.signatures[buyer.address], decoded.messageBytes), true);
  const f = await fixture(t);
  const first = await f.purchase();
  first.payload.payload.transaction = Buffer.from(original).toString('base64');
  assert.equal((await f.pay(first.route, first.payload)).status, 200);
  const second = await f.purchase(456);
  second.payload.payload.transaction = Buffer.from(altered).toString('base64');
  assert.equal((await f.pay(second.route, second.payload)).status, 409);
  first.payload.payload.transaction = Buffer.from(altered).toString('base64');
  const retry = await f.pay(first.route, first.payload);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).evidence_cached, true);
  assert.equal(f.events.filter(e => e === 'settle').length, 1);
  assert.equal(f.events.filter(e => e === 'measure').length, 1);
});
test('an expired cached receipt returns WAIT without repeating payment or measurement', async t => {
  const f = await fixture(t);
  const p = await f.purchase();
  const response = await f.pay(p.route, p.payload);
  const original = await response.json();
  original.receipt.completed_at -= 100;
  f.store.finish(p.request.id, 'delivered', { result: original });
  const retry = await f.pay(p.route, p.payload);
  const cached = await retry.json();
  assert.equal(cached.decision.decision, 'WAIT');
  assert.equal(cached.evidence_cached, true);
  assert.equal(f.events.filter(e => e === 'measure').length, 1);
  assert.equal(f.events.filter(e => e === 'settle').length, 1);
});
test('concurrent requests settle and measure once', async t => {
  const f = await fixture(t);
  const p = await f.purchase();
  const responses = await Promise.all([f.pay(p.route, p.payload), f.pay(p.route, p.payload)]);
  assert.ok(responses.some(r => r.status === 200));
  assert.equal(f.events.filter(e => e === 'settle').length, 1);
  assert.equal(f.events.filter(e => e === 'measure').length, 1);
});

test('pending facilitator confirmation uses an exact readback and a cached client retry never pays or measures again', async t => {
  let checks = 0;
  const pending = { success: false, errorReason: 'settlement_pending', transaction: '2'.repeat(88), network: NETWORK, payer: PAY_TO };
  const f = await fixture(t, { simulated: false, sensor: 'gpio9-contact', settlementResult: pending,
    confirmPending: async (settlement, hash) => { checks++; assert.deepEqual(settlement, pending); assert.match(hash, /^[0-9a-f]{64}$/); return { ...pending, success: true }; } });
  const p = await f.purchase();
  assert.equal((await f.pay(p.route, p.payload)).status, 200);
  const settlementCalls = f.events.filter(e => e === 'settle').length;
  assert.equal((await f.pay(p.route, p.payload)).status, 200);
  assert.equal(checks, 1);
  // The resource SDK can reconfirm the same pending payload. The cached retry must add no settlement call.
  assert.equal(f.events.filter(x => x === 'settle').length, settlementCalls);
  assert.equal(f.events.filter(x => x === 'measure').length, 1);
});

test('an unavailable pending-confirmation query blocks measurement and preserves the original signature', async t => {
  const pending = { success: false, errorReason: 'settlement_pending', transaction: '2'.repeat(88), network: NETWORK, payer: PAY_TO };
  const f = await fixture(t, { simulated: false, sensor: 'gpio9-contact', settlementResult: pending,
    confirmPending: async () => { throw new Error('RPC unavailable'); } });
  const p = await f.purchase();
  assert.equal((await f.pay(p.route, p.payload)).status, 503);
  assert.equal(f.store.get(p.request.id).state, 'settlement_unknown');
  assert.equal(JSON.parse(f.store.get(p.request.id).settlement).transaction, pending.transaction);
  assert.equal(f.events.filter(x => x === 'measure').length, 0);
  assert.equal((await f.pay(p.route, p.payload)).status, 409);
});

test('browser payment inspection can query only a stored signature and exposes no RPC credential', async t => {
  let queries = 0;
  const recorded = JSON.parse(readFileSync(new URL('../../docs/evidence/device-signed-purchase.json', import.meta.url))).purchase;
  const rpc = JSON.parse(readFileSync(new URL('./fixtures/settlement-rpc.json', import.meta.url)));
  const f = await fixture(t, { paymentRpcFetch: async (_url, options) => {
    queries++;const body = JSON.parse(options.body);
    assert.equal(body.method, 'getTransaction');assert.equal(body.params[0], recorded.settlement.transaction);
    return Response.json({ jsonrpc: '2.0', id: body.id, result: rpc });
  } });
  f.store.create({ ...recorded.challenge, expires_at: recorded.challenge.created_at + 120 });
  f.store.finish(recorded.purchase_id, 'delivered', { settlement: recorded.settlement });
  const headers = { Host: '127.0.0.1:4021' };
  const read = (id, extra = {}) => new Promise((resolve, reject) => {
    const req = httpRequest(f.url+'/payment-transactions/'+id, { headers: { ...headers, ...extra } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject); req.end();
  });
  assert.equal(await read(recorded.purchase_id), 200);
  assert.equal(await read(recorded.purchase_id, { Origin: 'https://foreign.example' }), 403);
  assert.equal(await read('fedcba9876543210'), 404);
  assert.equal(queries, 1);
});
for (const [name, options, status, state] of [
  ['failed settlement', { settled: false }, 402, 'payment_failed'],
  ['unknown settlement', { unknown: true }, 503, 'settlement_unknown'],
  ['failed delivery', { deliveryFails: true }, 503, 'delivery_failed'],
]) {
  test(`${name} preserves review state and never retries side effects`, async t => {
    const f = await fixture(t, options);
    const p = await f.purchase();
    assert.equal((await f.pay(p.route, p.payload)).status, status);
    assert.equal(f.store.get(p.request.id).state, state);
    assert.equal((await f.pay(p.route, p.payload)).status, 409);
    assert.equal(f.events.filter(e => e === 'settle').length, 1);
    assert.equal(f.events.filter(e => e === 'measure').length, options.deliveryFails ? 1 : 0);
  });
}
test('purchase ledger survives restart and enforces unique proof across writers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fieldproof-'));
  const path = join(dir, 'purchases.sqlite');
  try {
    const first = new PurchaseStore(path);
    first.create({ id: 'p1', nonce: 1, location: 'demo-gate', max_age_seconds: 10, expires_at: 9999999999 });
    assert.equal(first.reserve('p1', 'proof'), true);
    first.close();
    const reopened = new PurchaseStore(path);
    const concurrent = new PurchaseStore(path);
    reopened.create({ id: 'p2', nonce: 2, location: 'demo-gate', max_age_seconds: 10, expires_at: 9999999999 });
    assert.equal(concurrent.reserve('p2', 'proof'), false);
    assert.equal(reopened.get('p1').state, 'settling');
    reopened.close(); concurrent.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('purchase ledger waits for a concurrent startup lock before enabling WAL', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fieldproof-startup-'));
  const path = join(dir, 'purchases.sqlite');
  const writer = new DatabaseSync(path);
  writer.exec('CREATE TABLE probe(id INTEGER); BEGIN EXCLUSIVE;');
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `import { PurchaseStore } from ${JSON.stringify(new URL('../store.js', import.meta.url).href)};
     console.log('opening'); new PurchaseStore(process.argv[1]).close();`, path],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '', release;
  child.stderr.on('data', chunk => { stderr += chunk; });
  const closed = once(child, 'close');
  try {
    await once(child.stdout, 'data');
    release = setTimeout(() => writer.exec('COMMIT'), 200);
    const [code] = await closed;
    assert.equal(code, 0, stderr);
  } finally {
    clearTimeout(release);
    if (writer.isTransaction) writer.exec('ROLLBACK');
    writer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
