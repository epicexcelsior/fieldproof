// Read-only QA of the public replay. Requires an existing Puppeteer installation and Chrome.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = (process.argv[2] ?? 'http://127.0.0.1:8788').replace(/\/$/, '');
const output = resolve(root, process.argv[3] ?? '.local/competition/browser-checks/story-20261011');
const original = JSON.parse(readFileSync(resolve(root, 'docs/evidence/device-signed-purchase-20261011.json')));
mkdirSync(output, { recursive: true });
const browser = await puppeteer.launch({ headless: true,
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) });
const errors = [], requests = [];
const ready = page => page.waitForFunction(() => !document.querySelector('#next').disabled);
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push({ method: request.method(), url: request.url() }));
  for (const width of [1280, 390]) {
    await page.setViewport({ width, height: 900 });
    await page.goto(base + '/review.html', { waitUntil: 'networkidle0' });
    await ready(page);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.$eval('#outcome', element => element.dataset.tone), 'neutral');
    await page.screenshot({ path: `${output}/initial-${width}.png`, fullPage: true });
    // The primary control works with a keyboard. The four steps use real, unmodified archive bytes.
    await page.focus('#next');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-stage="1"]').getAttribute('aria-current') === 'step');
    await ready(page);
    for (let stage = 2; stage <= 4; stage++) {
      await page.click('#next');
      await page.waitForFunction(expected => document.querySelector(`[data-stage="${expected}"]`).getAttribute('aria-current') === 'step', {}, stage);
      await ready(page);
    }
    assert.equal(await page.$eval('#outcome', element => element.dataset.tone), 'ok');
    assert.equal(await page.$eval('#door-open', element => element.hasAttribute('hidden')), false);
    assert.match(await page.$eval('#outcome-label', element => element.textContent), /Historical replay/);
    assert.match(await page.$eval('#outcome-copy', element => element.textContent), /expired for a new decision/);
    await page.screenshot({ path: `${output}/accepted-at-capture-${width}.png`, fullPage: true });
    await page.click('#expire');
    await ready(page);
    assert.equal(await page.$eval('#outcome', element => element.dataset.tone), 'warn');
    assert.match(await page.$eval('#buyer-screen-detail', element => element.textContent), /Authentic · expired/);
    await page.click('#alter');
    await ready(page);
    assert.equal(await page.$eval('#outcome', element => element.dataset.tone), 'bad');
    assert.match(await page.$eval('#device-state', element => element.textContent), /Recorded device answer: OPEN/);
    await page.click('#restore');
    await ready(page);
    assert.equal(await page.$eval('#outcome', element => element.dataset.tone), 'ok');
    const archive = await page.evaluate(async () => (await fetch('./evidence/device-signed-purchase-20261011.json')).json());
    assert.deepEqual(archive, original, 'The replay must not rewrite the signed archive or its time');
    await page.click('#next');
    await ready(page);
    assert.equal(await page.$eval('#outcome', element => element.dataset.tone), 'neutral');
    assert.equal(await page.$eval('#door-open', element => element.hasAttribute('hidden')), true);
  }
  assert.ok(requests.every(request => request.method === 'GET'), 'The replay must never submit a payment or RPC write');
  assert.ok(requests.every(request => !request.url.includes('/local-buyer/')), 'The shared verifier must not configure the buyer');

  // A missing or forged archive must disable replay, rather than invent a successful transaction.
  for (const fault of ['missing', 'forged', 'pin-mismatch']) {
    const broken = await browser.newPage();
    broken.on('pageerror', error => errors.push(error.message));
    await broken.setRequestInterception(true);
    broken.on('request', request => {
      if (fault === 'pin-mismatch' && request.url().endsWith('/receipt-keys.json')) {
        void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ algorithm: 'ecdsa-p256-sha256', providers: {} }) });
      } else if (request.url().endsWith('/device-signed-purchase-20261011.json') && fault !== 'pin-mismatch') {
        const altered = structuredClone(original);
        altered.receipt.result.closed = true;
        void request.respond(fault === 'missing' ? { status: 404, body: 'Unavailable' }
          : { status: 200, contentType: 'application/json', body: JSON.stringify(altered) });
      } else { void request.continue(); }
    });
    await broken.goto(base + '/review.html', { waitUntil: 'networkidle0' });
    assert.equal(await broken.$eval('#next', element => element.disabled), true);
    assert.equal(await broken.$eval('#outcome-title', element => element.textContent), 'Evidence unavailable.');
    assert.ok(await broken.$('a[href*="record=20261011"]'));
    await broken.close();
  }

  // The shared-module guard must preserve the original workbench's initialization.
  await page.goto(base + '/jobs.html', { waitUntil: 'networkidle0' });
  await page.click('#historical');
  await page.waitForFunction(() => !document.querySelector('#ticket').hidden);
  assert.equal(await page.$eval('#signature-check', element => element.textContent), 'VALID');
  assert.equal(await page.$eval('#decision', element => element.textContent), 'WAIT');
  assert.deepEqual(errors, []);
  const result = { passed: true, base, checks: ['desktop and mobile layout', 'keyboard replay', 'authentic historical answer',
    'current-time expiry', 'altered-answer rejection', 'restore', 'unchanged original bytes',
    'GET-only replay without buyer configuration', 'missing and forged archive rejection', 'pin mismatch rejection',
    'existing workbench initialization', 'no page errors'], new_payment: false, new_measurement: false };
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
