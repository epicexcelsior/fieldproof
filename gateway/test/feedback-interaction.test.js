import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const markup = readFileSync(new URL('../../docs/feedback.html', import.meta.url), 'utf8');
const recorded = JSON.parse(readFileSync(new URL('../../docs/evidence/device-signed-purchase-20261011.json', import.meta.url)));
const pins = JSON.parse(readFileSync(new URL('../../host/capmesh/protocol/receipt_keys.json', import.meta.url)));
let sequence = 0;

async function guide(t, fault, { delayedVerification = false } = {}) {
  const previous = { document: globalThis.document, fetch: globalThis.fetch, now: Date.now };
  const elements = new Map(), stages = [], buttons = [], requests = [];
  for (const match of markup.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const attributes = new Map();
    const element = { textContent: '', dataset: {}, disabled: /\bdisabled\b/.test(match[0]),
      hidden: /\bhidden\b/.test(match[0]), listeners: {},
      addEventListener(name, callback) { this.listeners[name] = callback; },
      setAttribute(name, value) { attributes.set(name, value); },
      removeAttribute(name) { attributes.delete(name); },
      getAttribute(name) { return attributes.get(name) ?? null; } };
    elements.set(match[1], element);
    if (match[0].startsWith('<button')) buttons.push(element);
  }
  for (const match of markup.matchAll(/<button data-stage="(\d)"[^>]*>/g)) {
    const attributes = new Map();
    const element = { dataset: { stage: match[1] }, disabled: true, listeners: {},
      addEventListener(name, callback) { this.listeners[name] = callback; },
      setAttribute(name, value) { attributes.set(name, value); },
      removeAttribute(name) { attributes.delete(name); },
      getAttribute(name) { return attributes.get(name) ?? null; } };
    stages.push(element);
    buttons.push(element);
  }
  globalThis.document = { body: { dataset: { fieldproofPage: 'feedback' } },
    getElementById(id) { assert.ok(elements.has(id), `Missing guide element ${id}`); return elements.get(id); },
    querySelectorAll(selector) { return selector === '[data-stage]' ? stages : buttons; } };
  Date.now = () => (recorded.receipt.completed_at + 60) * 1000;
  if (delayedVerification) {
    const subtle = globalThis.crypto.subtle, verify = subtle.verify;
    const own = Object.hasOwn(subtle, 'verify');
    subtle.verify = async (...args) => { await delay(25); return verify.apply(subtle, args); };
    t.after(() => { if (own) subtle.verify = verify; else delete subtle.verify; });
  }
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('receipt-keys.json')) {
      return Response.json(fault === 'pin' ? { algorithm: pins.algorithm, providers: {} } : pins);
    }
    assert.ok(String(url).endsWith('device-signed-purchase-20261011.json'), 'The guide must not access a buyer or payment endpoint');
    if (fault === 'missing') return new Response('', { status: 404 });
    const source = structuredClone(recorded);
    if (fault === 'forged') source.receipt.result.closed = true;
    if (fault === 'oversized') return new Response(' '.repeat(65537));
    return Response.json(source);
  };
  t.after(() => {
    if (previous.document === undefined) delete globalThis.document;
    else globalThis.document = previous.document;
    globalThis.fetch = previous.fetch;
    Date.now = previous.now;
  });
  await import(`../../docs/feedback.mjs?interaction=${++sequence}`);
  const click = async id => {
    elements.get(id).listeners.click();
    const deadline = performance.now() + 2000;
    while (elements.get('next').disabled && performance.now() < deadline) await delay(1);
    assert.equal(elements.get('next').disabled, false);
  };
  return { elements, stages, requests, click };
}

test('visual guide replays one unchanged real receipt without buying or measuring', async t => {
  // Verify readiness after actual cryptography completes, including a slow worker-pool response.
  const { elements: el, stages, requests, click } = await guide(t, undefined, { delayedVerification: true });
  assert.equal(el.get('next').disabled, false);
  assert.equal(el.get('replay').dataset.step, '0');
  await click('next');
  assert.equal(stages[0].getAttribute('aria-current'), 'step');
  await click('next');
  assert.equal(el.get('operator-payment').textContent, '0.001 test USDC');
  await click('next');
  assert.equal(el.get('device-state').textContent, 'Recorded answer: OPEN');
  await click('next');
  assert.equal(el.get('result').dataset.tone, 'ok');
  assert.match(el.get('result-title').textContent, /Usable then. Expired now/);
  await click('expire');
  assert.equal(el.get('result').dataset.tone, 'warn');
  await click('alter');
  assert.equal(el.get('result').dataset.tone, 'bad');
  assert.equal(el.get('exchange-note').textContent, 'Signature mismatch');
  assert.equal(el.get('device-state').textContent, 'Recorded answer: OPEN');
  await click('restore');
  assert.equal(el.get('result').dataset.tone, 'ok');
  await click('back');
  assert.equal(el.get('replay').dataset.step, '3');
  assert.equal(el.get('result').hidden, true);
  assert.equal(recorded.receipt.result.closed, false);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(({ options }) => !options?.method || options.method === 'GET'));
});

for (const fault of ['missing', 'forged', 'pin', 'oversized']) {
  test(`visual guide disables every control when the original evidence is ${fault}`, async t => {
    const { elements: el, stages } = await guide(t, fault);
    assert.equal(el.get('next').disabled, true);
    assert.ok(stages.every(button => button.disabled));
    assert.equal(el.get('load-error').hidden, false);
    assert.equal(el.get('step-title').textContent, 'Evidence unavailable.');
    assert.equal(el.get('result').hidden, true);
  });
}
