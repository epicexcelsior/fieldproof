// Read-only browser checks. Use the existing Puppeteer installation and Chrome.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const base = (process.argv[2] ?? 'http://127.0.0.1:8791').replace(/\/$/, '');
const output = process.argv[3] ?? '.local/competition/visual-story-20261011/browser';
mkdirSync(output, { recursive: true });
const original = JSON.parse(readFileSync(new URL('../docs/evidence/device-signed-purchase-20261011.json', import.meta.url)));
const browser = await puppeteer.launch({ headless: true,
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) });
const errors = [], requests = [], guidedRequests = [];
const ready = page => page.waitForFunction(() => !document.querySelector('#next').disabled);
try {
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push({ method: request.method(), url: request.url() }));
  for (const width of [1280, 390, 320]) {
    const start = requests.length;
    await page.setViewport({ width, height: 900 });
    await page.goto(base + '/', { waitUntil: 'networkidle0' });
    await ready(page);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.$eval('#replay', element => element.dataset.step), '0');
    assert.equal(await page.$eval('.device img', element => element.complete && element.naturalWidth === 960), true);
    const words = await page.$eval('main', element => element.innerText.trim().split(/\s+/).length);
    assert.ok(words < 240, `The first view has too much reading: ${words} words`);
    await page.screenshot({ path: `${output}/start-${width}.png`, fullPage: true });
    await page.focus('#next');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#replay').dataset.step === '1');
    await ready(page);
    for (let stage = 2; stage <= 4; stage++) {
      await page.click('#next');
      await page.waitForFunction(expected => document.querySelector('#replay').dataset.step === String(expected), {}, stage);
      await ready(page);
    }
    assert.equal(await page.$eval('#result', element => element.dataset.tone), 'ok');
    assert.match(await page.$eval('#result-title', element => element.textContent), /Usable then. Expired now/);
    assert.match(await page.$eval('#operator-payment', element => element.textContent), /0.001 test USDC/);
    await page.screenshot({ path: `${output}/verified-${width}.png`, fullPage: true });
    await page.click('#expire');
    await ready(page);
    assert.equal(await page.$eval('#result', element => element.dataset.tone), 'warn');
    await page.click('#alter');
    await ready(page);
    assert.equal(await page.$eval('#result', element => element.dataset.tone), 'bad');
    assert.match(await page.$eval('#device-state', element => element.textContent), /Recorded answer: OPEN/);
    await page.click('#restore');
    await ready(page);
    assert.equal(await page.$eval('#result', element => element.dataset.tone), 'ok');
    await page.click('#back');
    await ready(page);
    assert.equal(await page.$eval('#replay', element => element.dataset.step), '3');
    await page.click('[data-stage="1"]');
    await ready(page);
    assert.equal(await page.$eval('#replay', element => element.dataset.step), '1');
    await page.focus('details summary');
    await page.keyboard.press('Enter');
    assert.equal(await page.$eval('details', element => element.open), true);
    guidedRequests.push(...requests.slice(start));
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('a[href^="proof.html"]')]);
    await page.waitForFunction(() => document.querySelector('#source-description')?.textContent.includes('Recorded October 11'));
    await page.click('#original');
    await page.waitForFunction(() => document.querySelector('#signature')?.textContent.includes('VALID'));
    assert.equal(await page.$eval('#decision', element => element.textContent), 'WAIT');
  }
  // Old receipt bookmarks must keep their query and open the inspector, not lose the selected record.
  await page.goto(base + '/index.html?record=20261011&present=1#payment', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('#signature')?.textContent.includes('VALID'));
  assert.equal(new URL(page.url()).pathname, new URL(base + '/proof.html').pathname);
  assert.equal(new URL(page.url()).searchParams.get('record'), '20261011');
  assert.equal(new URL(page.url()).hash, '#payment');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const reducedStart = requests.length;
  await page.goto(base + '/feedback.html', { waitUntil: 'networkidle0' });
  await ready(page);
  await page.click('#next');
  await ready(page);
  assert.equal(await page.$eval('.exchange-packet', element => getComputedStyle(element).animationName), 'none');
  const archive = await page.evaluate(async () => (await fetch('./evidence/device-signed-purchase-20261011.json')).json());
  assert.deepEqual(archive, original);
  guidedRequests.push(...requests.slice(reducedStart));
  for (const fault of ['missing', 'forged', 'pin-mismatch']) {
    const broken = await browser.newPage();
    await broken.setRequestInterception(true);
    broken.on('request', request => {
      if (fault === 'pin-mismatch' && request.url().endsWith('/receipt-keys.json')) {
        void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ algorithm: 'ecdsa-p256-sha256', providers: {} }) });
      } else if (fault !== 'pin-mismatch' && request.url().endsWith('/device-signed-purchase-20261011.json')) {
        const altered = structuredClone(original);
        altered.receipt.result.closed = true;
        void request.respond(fault === 'missing' ? { status: 404, body: 'Unavailable' }
          : { status: 200, contentType: 'application/json', body: JSON.stringify(altered) });
      } else { void request.continue(); }
    });
    await broken.goto(base + '/feedback.html', { waitUntil: 'networkidle0' });
    assert.equal(await broken.$eval('#next', element => element.disabled), true);
    assert.equal(await broken.$eval('#step-title', element => element.textContent), 'Evidence unavailable.');
    await broken.close();
  }
  assert.deepEqual(errors, []);
  assert.ok(requests.every(request => request.method === 'GET'));
  assert.ok(guidedRequests.every(request => !request.url.includes('/local-buyer/')));
  const result = { passed: true, base, checks: ['1280/390/320 layouts', 'real device photo', 'short first view', 'keyboard steps',
    'historical signature', 'expiry', 'changed-copy rejection', 'restore and back', 'evidence link',
    'legacy bookmarks', 'reduced motion', 'unchanged original archive', 'missing/forged/pin failure',
    'no page errors', 'GET-only without buyer configuration'], new_payment: false, new_measurement: false };
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
