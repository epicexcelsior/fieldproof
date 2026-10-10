// Public workbench QA. Static files and the RPC fixture stay local. No payment or live chain query.
const { chromium } = require(process.argv[2] || 'playwright');
const assert = require('node:assert/strict');
const { readFileSync, existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { randomUUID } = require('node:crypto');
const root = resolve(__dirname, '..');
const site = resolve(process.argv[3] || join(root, 'docs'));
const output = join(root, '.local/competition/browser-checks', randomUUID());
const origin = 'https://fieldproof.test';
const original = JSON.parse(readFileSync(join(root, 'docs/evidence/device-signed-purchase.json')));
const rpc = JSON.parse(readFileSync(join(root, 'gateway/test/fixtures/settlement-rpc.json')));
const allowed = new Set(['jobs.html', 'jobs.mjs', 'settlement.mjs', 'receipt-keys.json',
  'evidence/current-job.json', 'evidence/device-signed-purchase.json']);
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.json': 'application/json' };

(async () => {
  let browser;
  const errors = [];
  try {
    browser = await chromium.launch({ headless: true,
      ...(process.env.FIELDPROOF_BROWSER_EXECUTABLE ? { executablePath: process.env.FIELDPROOF_BROWSER_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    let completeQuery, delayed = true;
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.href === 'https://api.devnet.solana.com/') {
        const message = request.postDataJSON();
        assert.equal(message.method, 'getTransaction');
        assert.equal(message.params[0], original.purchase.settlement.transaction);
        if (delayed) { delayed = false; await new Promise(done => { completeQuery = done; }); }
        return route.fulfill({ json: { jsonrpc: '2.0', id: message.id, result: rpc } });
      }
      assert.equal(request.method(), 'GET', 'No payment POST can occur in this public QA');
      assert.equal(url.origin, origin, 'No external request can leave this QA');
      const path = decodeURIComponent(url.pathname.slice(1));
      if (path === 'local-buyer/config') return route.fulfill({ status: 404, body: '' });
      assert.ok(allowed.has(path), `Unapproved static QA file ${path}`);
      const file = join(site, path);
      if (!existsSync(file)) return route.fulfill({ status: 404, body: '' });
      const suffix = file.slice(file.lastIndexOf('.'));
      return route.fulfill({ contentType: types[suffix], body: readFileSync(file) });
    });
    await page.goto(origin + '/jobs.html');
    await page.getByRole('button', { name: 'Load recorded October 1 check' }).click();
    await page.locator('#signature-check').getByText('VALID', { exact: true }).waitFor();
    assert.equal(await page.locator('#decision').textContent(), 'WAIT');
    assert.equal(await page.locator('#buy').isVisible(), false);
    await page.getByRole('button', { name: 'Verify transfer on Devnet' }).click();
    await page.locator('#payment-check').getByText('QUERYING', { exact: true }).waitFor();
    const changed = structuredClone(original);
    changed.purchase.settlement.transaction = '3'.repeat(88);
    await page.locator('#file').setInputFiles({ name: 'different-payment.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(changed)) });
    await page.locator('#transaction').getByText(changed.purchase.settlement.transaction, { exact: true }).waitFor();
    assert.equal(typeof completeQuery, 'function', 'The controlled RPC request must reach its fixture before release');
    const completedQuery = page.waitForResponse(response => response.url() === 'https://api.devnet.solana.com/');
    completeQuery();
    await completedQuery;
    assert.equal(await page.locator('#payment-check').textContent(), 'NOT QUERIED');
    assert.equal(await page.locator('#verify-payment').isEnabled(), true);
    await page.getByRole('button', { name: 'Load recorded October 1 check' }).click();
    await page.locator('#signature-check').getByText('VALID', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Verify transfer on Devnet' }).click();
    await page.locator('#payment-check').getByText(`VERIFIED · SLOT ${rpc.slot}`, { exact: true }).waitFor();
    assert.equal(await page.locator('#decision').textContent(), 'WAIT', 'Payment cannot refresh an expired receipt');
    await page.getByRole('button', { name: 'Alter contact state locally' }).click();
    await page.locator('#signature-check').getByText('REJECTED', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Restore original' }).click();
    await page.locator('#signature-check').getByText('VALID', { exact: true }).waitFor();
    assert.equal(await page.locator('#verify-payment').isEnabled(), true);
    await page.evaluate(() => {
      const banner = document.createElement('p');
      banner.textContent = 'QA ONLY — local static files and controlled RPC fixture. No live chain read or payment.';
      banner.style.cssText = 'margin:0;padding:10px;background:#fff0bd;color:#122b39;font:14px Arial;';
      document.body.prepend(banner);
    });
    mkdirSync(output, { recursive: true, mode: 0o700 });
    await page.screenshot({ path: join(output, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(output, 'mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    writeFileSync(join(output, 'result.json'), JSON.stringify({ passed: true, payment: false, live_chain_query: false,
      checks: ['original signature', 'payment query race', 'expired receipt', 'tamper and restore', 'mobile overflow', 'no page errors'] }, null, 2));
    console.log('PASS: public workbench interactions and desktop/mobile layout. Controlled fixtures. Artifacts: ' + output);
  } finally { await browser?.close(); }
})().catch(error => { console.error('Workbench browser QA did not pass: ' + error.message); process.exitCode = 1; });
