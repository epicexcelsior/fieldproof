import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate as tick } from 'node:timers/promises';
import { DEVNET_RPC } from '../../docs/settlement.mjs';

const recorded = JSON.parse(readFileSync(new URL('../../docs/evidence/device-signed-purchase.json', import.meta.url)));
const rpc = JSON.parse(readFileSync(new URL('./fixtures/settlement-rpc.json', import.meta.url)));
const reviewed = JSON.parse(readFileSync(new URL('../../docs/evidence/current-job.json', import.meta.url)));
const markup = readFileSync(new URL('../../docs/jobs.html', import.meta.url), 'utf8');
let sequence = 0;

async function workbench(t, query, windowFixture, publishedStatus = 404, localFetch) {
  const previous = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch, now: Date.now };
  const elements = new Map();
  for (const match of markup.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    elements.set(match[1], { textContent: '', className: '', disabled: /\bdisabled\b/.test(match[0]),
      hidden: /\bhidden\b/.test(match[0]), listeners: {},
      addEventListener(name, callback) { this.listeners[name] = callback; },
      removeAttribute(name) { delete this[name]; }, classList: { add() {}, remove() {} } });
  }
  globalThis.document = { body: { dataset: { fieldproofPage: 'jobs' } }, addEventListener() {}, getElementById: id => {
    assert.ok(elements.has(id), `Missing workbench element ${id}`);
    return elements.get(id);
  } };
  if (windowFixture) globalThis.window = windowFixture;
  Date.now = () => (recorded.purchase.receipt.completed_at + 1) * 1000;
  globalThis.fetch = async (url, options) => {
    if (String(url) === DEVNET_RPC) return query(url, options);
    if (localFetch) {
      const response = await localFetch(String(url), options);
      if (response) return response;
    }
    if (String(url).endsWith('current-job.json')) return new Response('', { status: publishedStatus });
    if (String(url).endsWith('/local-buyer/config') || String(url).endsWith('receipt-keys.json')) {
      return new Response('', { status: 404 });
    }
    assert.fail(`Unexpected request ${url}`);
  };
  t.after(() => {
    if (previous.document === undefined) delete globalThis.document;
    else globalThis.document = previous.document;
    if (previous.window === undefined) delete globalThis.window;
    else globalThis.window = previous.window;
    globalThis.fetch = previous.fetch;
    Date.now = previous.now;
  });
  await import(`../../docs/jobs.mjs?interaction=${++sequence}`);
  await tick();
  const load = async input => {
    const raw = JSON.stringify(input);
    await elements.get('file').listeners.change({ target: { files: [{ name: 'public-fixture.json', size: raw.length,
      text: async () => raw }], value: 'file' } });
  };
  return { elements, load };
}

const rpcResponse = () => Response.json({ jsonrpc: '2.0', id: 'fieldproof-payment-check', result: rpc });

test('verification imports on another page do not initialize the workbench or access a buyer', async t => {
  const previous = { document: globalThis.document, fetch: globalThis.fetch };
  globalThis.document = { body: { dataset: {} }, getElementById() { assert.fail('Workbench DOM accessed from another page'); } };
  globalThis.fetch = () => { assert.fail('Import alone must not request buyer configuration or evidence'); };
  t.after(() => {
    if (previous.document === undefined) delete globalThis.document;
    else globalThis.document = previous.document;
    globalThis.fetch = previous.fetch;
  });
  const { inspectSource } = await import(`../../docs/jobs.mjs?interaction=${++sequence}`);
  const result = await inspectSource(recorded, { now: recorded.purchase.receipt.completed_at });
  assert.equal(result.signature, true);
  assert.equal(result.fresh, true);
});

test('a completed payment query cannot verify a different imported ticket', async t => {
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const { elements, load } = await workbench(t, async () => pending);
  await load(recorded);
  const querying = elements.get('verify-payment').onclick();
  const other = structuredClone(recorded);
  other.purchase.settlement.transaction = '3'.repeat(88);
  await load(other);
  complete(rpcResponse());
  await querying;
  assert.equal(elements.get('transaction').textContent, other.purchase.settlement.transaction);
  assert.equal(elements.get('payment-check').textContent, 'NOT QUERIED');
  assert.equal(elements.get('decision').textContent, 'WAIT');
  assert.equal(elements.get('verify-payment').disabled, false);
});

test('restoring evidence resets the payment button and explanatory decision', async t => {
  const { elements, load } = await workbench(t, async () => rpcResponse());
  await load(recorded);
  await elements.get('verify-payment').onclick();
  assert.equal(elements.get('decision').textContent, 'DISPATCH');
  assert.equal(elements.get('verify-payment').disabled, true);
  assert.match(elements.get('decision-note').textContent, /verified|Verified/);
  await elements.get('tamper').onclick();
  await elements.get('restore').onclick();
  assert.equal(elements.get('payment-check').textContent, 'NOT QUERIED');
  assert.equal(elements.get('verify-payment').disabled, false);
});

test('returning from browser page cache resumes expiry without a second transfer query', async t => {
  const listeners = new Map(), timers = new Map();
  let nextTimer = 0, queries = 0;
  const windowFixture = {
    setInterval(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearInterval(id) { timers.delete(id); },
    addEventListener(name, callback) { listeners.set(name, callback); },
  };
  const { elements, load } = await workbench(t, async () => { queries += 1; return rpcResponse(); }, windowFixture);
  await load(recorded);
  await elements.get('verify-payment').onclick();
  assert.equal(elements.get('decision').textContent, 'DISPATCH');
  listeners.get('pagehide')();
  assert.equal(timers.size, 0);
  assert.equal(typeof listeners.get('pageshow'), 'function', 'A cached page must resume its freshness timer');
  listeners.get('pageshow')();
  assert.equal(timers.size, 1);
  Date.now = () => (recorded.purchase.receipt.completed_at + 11) * 1000;
  [...timers.values()][0]();
  assert.equal(elements.get('decision').textContent, 'WAIT');
  assert.equal(elements.get('age-check').textContent, 'EXPIRED / UNAVAILABLE');
  assert.equal(queries, 1);
  listeners.get('pageshow')();
  assert.equal(timers.size, 1, 'Repeated page visibility must not create overlapping timers');
});

test('an unavailable optional published packet does not disable manual evidence inspection', async t => {
  const { elements, load } = await workbench(t, async () => rpcResponse(), undefined, 503);
  assert.equal(elements.get('file').disabled, false);
  assert.equal(elements.get('historical').disabled, false);
  assert.equal(elements.get('published').hidden, true);
  assert.match(elements.get('status').textContent, /Reviewed exported job is unavailable/);
  await load(recorded);
  assert.equal(elements.get('signature-check').textContent, 'VALID');
  assert.equal(elements.get('decision').textContent, 'WAIT');
});

test('peaq status refresh preserves payment verification and does not refresh the signed answer', async t => {
  const timers = new Map(); let nextTimer = 0, queries = 0;
  const pending = structuredClone(reviewed);
  pending.peaq_event = { state: 'pending' };
  const paymentRpc = structuredClone(rpc);
  paymentRpc.transaction.signatures[0] = reviewed.job.payment.transaction;
  const { elements, load } = await workbench(t, async () => { queries++; return Response.json({
    jsonrpc: '2.0', id: 'fieldproof-payment-check', result: paymentRpc }); }, {
    setInterval(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearInterval(id) { timers.delete(id); }, addEventListener() {},
  }, 404, async url => {
    if (url === '/local-buyer/config') return Response.json({ price_usdc: '0.001',
      payTo: reviewed.job.payment.recipient, token: 'a'.repeat(48), remaining: 1 });
    if (url === `/jobs/${reviewed.job.job_id}`) return Response.json(reviewed);
  });
  Date.now = () => (reviewed.job.receipt.completed_at + 1) * 1000;
  await load(pending);
  await elements.get('verify-payment').onclick();
  const checkedPayment = elements.get('payment-check').textContent;
  assert.match(checkedPayment, /^VERIFIED/);
  await [...timers.values()].find(timer => timer.delay === 2000).callback();
  assert.match(elements.get('event-status').textContent, /confirmed at finalized block/);
  assert.equal(elements.get('payment-check').textContent, checkedPayment);
  assert.equal(elements.get('verify-payment').disabled, true);
  assert.equal(queries, 1);
  Date.now = () => (reviewed.job.receipt.completed_at + 11) * 1000;
  [...timers.values()].find(timer => timer.delay === 1000).callback();
  assert.equal(elements.get('decision').textContent, 'WAIT');
  assert.equal(elements.get('age-check').textContent, 'EXPIRED / UNAVAILABLE');
});

test('peaq refresh rejects a different job and cannot replace a newly selected ticket', async t => {
  const timers = new Map(); let nextTimer = 0, reply;
  const response = new Promise(resolve => { reply = resolve; });
  const pending = structuredClone(reviewed); pending.peaq_event = { state: 'pending' };
  const { elements, load } = await workbench(t, async () => rpcResponse(), {
    setInterval(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearInterval(id) { timers.delete(id); }, addEventListener() {},
  }, 404, async url => {
    if (url === '/local-buyer/config') return Response.json({ price_usdc: '0.001',
      payTo: reviewed.job.payment.recipient, token: 'a'.repeat(48), remaining: 1 });
    if (url === `/jobs/${reviewed.job.job_id}`) return response;
  });
  await load(pending);
  const refresh = [...timers.values()].find(timer => timer.delay === 2000).callback();
  await load(recorded);
  reply(Response.json(reviewed));
  await refresh;
  assert.equal(elements.get('request-id').textContent, recorded.purchase.purchase_id);
  assert.equal(elements.get('event-status').textContent, 'No linked peaq activity shown');
});

test('a recorded Storage confirmation must bind this job hash and both identity checks', async () => {
  const { matchingStorageRecord } = await import('../../docs/jobs.mjs');
  assert.equal(await matchingStorageRecord(reviewed.job, reviewed.peaq_event), true);
  for (const patch of [{ job_sha256: '0'.repeat(64) }, { machine_id: '123' },
    { machine_authority_at_request_verified: false }, { verified: false }]) {
    const event = structuredClone(reviewed.peaq_event);
    Object.assign(event.confirmation, patch);
    assert.equal(await matchingStorageRecord(reviewed.job, event), false);
  }
});
