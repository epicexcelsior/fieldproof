// Capture recorded public evidence. This script cannot pay or request hardware.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const site = path.resolve(process.argv[2] ?? '.local/competition/materials-20261011-r2');
const output = path.resolve(process.argv[3] ?? '.local/competition/feedback-cut-20261011');
await mkdir(output, { recursive: false });
const manifest = JSON.parse(await readFile(path.join(site, 'manifest.json'), 'utf8'));
for (const [file, expected] of Object.entries(manifest)) {
  assert.equal(createHash('sha256').update(await readFile(path.join(site, file))).digest('hex'), expected, `Export changed: ${file}`);
}
const originalBytes = await readFile(path.join(site, 'evidence/device-signed-purchase-20261011.json'));
assert.deepEqual(originalBytes, await readFile('docs/evidence/device-signed-purchase-20261011.json'));
const original = JSON.parse(originalBytes);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  const file = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).slice(1);
  if (request.method !== 'GET' || !Object.hasOwn(manifest, file)) {
    response.writeHead(404); response.end(); return;
  }
  try { response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' }); response.end(await readFile(path.join(site, file))); }
  catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_BIN ?? '/usr/bin/google-chrome' });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errors = [], requests = [], rpc = [];
page.on('pageerror', error => errors.push(error.message));
await page.setRequestInterception(true);
page.on('request', request => {
  const url = new URL(request.url()), method = request.method();
  requests.push({ method, pathname: url.origin === origin ? url.pathname : url.origin });
  if (url.origin === origin && method === 'GET' &&
      (Object.hasOwn(manifest, url.pathname.slice(1)) || ['/local-buyer/config', '/favicon.ico'].includes(url.pathname))) {
    void request.continue(); return;
  }
  if (url.href === 'https://api.devnet.solana.com/' && method === 'OPTIONS') { void request.continue(); return; }
  if (url.href === 'https://api.devnet.solana.com/' && method === 'POST') {
    const body = JSON.parse(request.postData() ?? '{}');
    if (body.method === 'getTransaction' && body.params?.[0] === original.settlement.transaction && rpc.length === 0) {
      rpc.push(body); void request.continue(); return;
    }
  }
  errors.push(`Blocked unexpected request: ${method} ${url.origin}${url.pathname}`);
  void request.abort();
});
const wait = seconds => new Promise(resolve => setTimeout(resolve, seconds * 1000));
const scenes = [];
let recorder, settlement;
async function caption(title, detail) {
  await page.evaluate(({ title, detail }) => {
    let overlay = document.getElementById('feedback-caption');
    if (!overlay) {
      overlay = document.createElement('section'); overlay.id = 'feedback-caption';
      overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;height:106px;background:#edf2f8;color:#182c43;z-index:200;padding:14px 36px;border-bottom:1px solid #c6d2e2;font:20px/1.35 Arial,sans-serif';
      overlay.innerHTML = '<div id="feedback-title" style="font-size:31px;font-weight:700"></div><div id="feedback-detail" style="font-size:18px;margin-top:6px"></div>';
      document.body.append(overlay);
      const badge = document.createElement('div');
      badge.id = 'feedback-badge';
      badge.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:201;padding:12px 36px;background:#182c43;color:white;font:16px/1.3 Arial,sans-serif';
      badge.textContent = 'RECORDED OCT 11, 2026  /  DEVNET TEST TOKENS  /  REPLAY: NO NEW PAYMENT OR MEASUREMENT';
      document.body.append(badge);
    }
    document.getElementById('feedback-title').textContent = title;
    document.getElementById('feedback-detail').textContent = detail;
  }, { title, detail });
}
async function shot(name, title, detail, seconds) {
  await caption(title, detail);
  await page.screenshot({ path: path.join(output, `${name}.png`) });
  scenes.push({ name, title, seconds });
  await wait(seconds);
}
async function stage(number) {
  await page.click(`[data-stage="${number}"]`);
  await page.waitForFunction(number => document.querySelector(`[data-stage="${number}"]`).getAttribute('aria-current') === 'step' && !document.querySelector('#next').disabled, {}, number);
}
try {
  await page.goto(`${origin}/index.html?record=20261011`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !document.getElementById('chain-query').disabled);
  await page.click('#chain-query');
  await page.waitForFunction(() => ['VERIFIED TRANSFER', 'NOT VERIFIED'].includes(document.getElementById('chain-status').textContent), { timeout: 20000 });
  assert.equal(await page.$eval('#chain-status', element => element.textContent), 'VERIFIED TRANSFER');
  settlement = JSON.parse(await page.$eval('#chain-result', element => element.textContent));
  await page.addStyleTag({ content: 'body{background:#edf2f8!important;padding-top:120px!important}header,main>div:not(#payment),main>.reference,footer,main>p{display:none!important}main{padding:0 36px!important;max-width:1240px!important}#payment{margin:0!important;padding:24px!important;border:1px solid #c6d2e2!important;background:white!important}#payment h2{font-size:32px!important}.money-flow{margin:26px 0!important}.money-flow code{font-size:14px!important}.transfer-amount{font-size:34px!important}#payment .note,#payment details,#payment>p:has(#payment-explorer),#chain-query{display:none!important}#chain-status{display:block!important;font:bold 32px Arial!important;color:#147758!important;margin-top:18px!important}#chain-summary{font-size:19px!important}#payment>p{font-size:18px!important}' });
  await caption('A machine sold one physical check.', 'The operator received 0.001 test USDC. This reads the original transfer from Solana Devnet.');
  // output was created with recursive:false, so this run owns a new directory.
  // Puppeteer needs recursive directory creation even when the output file is new.
  recorder = await page.screencast({ path: path.join(output, 'capture.webm'), fps: 25, quality: 24, overwrite: true });
  await shot('01-payment', 'A machine sold one physical check.', 'The operator received 0.001 test USDC. This reads the original transfer from Solana Devnet.', 7);
  await page.goto(`${origin}/review.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !document.getElementById('next').disabled);
  await page.addStyleTag({ content: 'body{padding-top:114px!important}header,.intro,.argument,.details,.feedback,.footer,.evidence-link,#load-status{display:none!important}main.shell{padding:0 36px!important;max-width:1240px!important}.replay{margin:0!important}.replay-head{display:none!important}.scene{min-height:210px!important;padding:14px 26px 4px!important}.actor svg{height:116px!important}.actor h3{font-size:17px!important}.actor .actor-role{margin-bottom:2px!important}.scene-caption{padding-bottom:8px!important;font-size:11px!important}.story{padding:14px 24px!important;gap:28px!important}.story-title{font-size:23px!important}.story-copy{font-size:14px!important;min-height:44px!important}.outcome-title{font-size:29px!important}.outcome p{font-size:13px!important}.sequence button{padding:9px!important}.probes{padding:10px 18px!important}.probes .button{padding:7px 11px!important;min-height:35px!important}.probe-note{font-size:11px!important}' });
  await stage(1);
  await shot('02-request', 'Software commissions a new physical check.', 'The buyer fixes the question, approved device, spending limit, and useful age.', 7);
  await stage(2);
  await shot('03-commissioned', 'Payment buys the check, including an unfavorable answer.', 'The original purchase settles before measurement. OPEN and CLOSED both fulfill the observation.', 7);
  await stage(3);
  await shot('04-measure', 'The real ESP32 answered: OPEN.', 'Recorded GPIO9 / BOOT contact stand-in. The board signed a new answer for the request.', 7);
  await stage(4);
  assert.equal(await page.$eval('#outcome', element => element.dataset.tone), 'ok');
  await shot('05-usable', 'The buyer can use the answer while it is fresh.', 'Historical replay at capture time. The browser verifies the original device signature and request.', 7);
  await page.click('#expire');
  await page.waitForFunction(() => document.getElementById('outcome').dataset.tone === 'warn');
  await shot('06-expired', 'An authentic answer can be too old.', 'The timestamp stays unchanged. The buyer requests a new check before acting now.', 7);
  await page.click('#alter');
  await page.waitForFunction(() => document.getElementById('outcome').dataset.tone === 'bad');
  await shot('07-altered', 'An edited answer fails verification.', 'Only this local copy changes. The original receipt and hardware result remain unchanged.', 7);
  await page.click('#restore');
  await page.waitForFunction(() => document.getElementById('outcome').dataset.tone === 'ok');
  await shot('08-next', 'peaq identity and activity: live integration pending.', 'No commercial demand is validated. What physical check do you already pay someone to make?', 7);
  await recorder.stop(); recorder = undefined;
  // Chrome's recording stream lacks duration/cue metadata. Remux without changing frames.
  const finalPath = path.join(output, 'fieldproof-paid-check-feedback.webm');
  const seekablePath = path.join(output, 'captured-seekable.webm');
  const remux = spawnSync('ffmpeg', ['-v', 'error', '-i', path.join(output, 'capture.webm'), '-c', 'copy', seekablePath], { encoding: 'utf8' });
  assert.equal(remux.status, 0, 'The recording could not be finalized as a seekable WebM.');
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,codec_type,width,height,avg_frame_rate', '-of', 'json', seekablePath], { encoding: 'utf8' });
  assert.equal(probe.status, 0, 'The recording metadata could not be read.');
  const capture = JSON.parse(probe.stdout);
  const duration = Number(capture.format.duration);
  assert.ok(duration >= 45 && duration <= 60, 'The feedback cut must last 45 to 60 seconds.');
  // Chrome can omit the last static repaint. Hold the actual final browser screenshot.
  const cut = spawnSync('ffmpeg', ['-v', 'error', '-i', seekablePath, '-loop', '1', '-framerate', '25',
    '-i', path.join(output, '08-next.png'), '-filter_complex',
    `[0:v]trim=end=${duration - 7},setpts=PTS-STARTPTS[first];[1:v]trim=duration=7,setpts=PTS-STARTPTS[last];[first][last]concat=n=2:v=1:a=0[out]`,
    '-map', '[out]', '-an', '-c:v', 'libvpx-vp9', '-crf', '24', '-b:v', '0', '-row-mt', '1', '-threads', '4', finalPath], { encoding: 'utf8' });
  assert.equal(cut.status, 0, 'The final browser frame could not be included in the feedback cut.');
  const finalProbe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,codec_type,width,height,avg_frame_rate', '-of', 'json', finalPath], { encoding: 'utf8' });
  assert.equal(finalProbe.status, 0, 'The final feedback cut metadata could not be read.');
  const media = JSON.parse(finalProbe.stdout);
  assert.ok(Number(media.format.duration) >= 45 && Number(media.format.duration) <= 60);
  assert.equal(media.streams.length, 1);
  assert.equal(media.streams[0].codec_type, 'video');
  assert.deepEqual(errors, []);
  assert.equal(rpc.length, 1);
  assert.deepEqual(await readFile(path.join(site, 'evidence/device-signed-purchase-20261011.json')), originalBytes);
  await writeFile(path.join(output, 'recording.json'), JSON.stringify({ captured_at_utc: new Date().toISOString(), mode: 'RECORDED OCTOBER 11 EVIDENCE', original_receipt_sha256: createHash('sha256').update(originalBytes).digest('hex'), settlement, rpc, scenes, requests, page_errors: errors, hardware_used: false, funds_sent: false, audio: false, last_frame_source: 'Actual browser screenshot 08-next.png', media }, null, 2) + '\n');
  assert.ok((await stat(path.join(output, 'fieldproof-paid-check-feedback.webm'))).size > 10000);
  console.log('Saved actual browser feedback cut. One read-only chain query. No new payment, measurement, or voice.');
} finally {
  if (recorder) await recorder.stop();
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
