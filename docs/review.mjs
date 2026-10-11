// A reviewer can still have the pre-replay workbench module in the browser's HTTP cache.
import { inspectSource, loadTrustedPin } from './jobs.mjs?replay=20261011';

const el = id => document.getElementById(id);
const text = (id, value) => { el(id).textContent = value; };
const stages = [...document.querySelectorAll('[data-stage]')];
let original, pin, step = 0, mode = 'replay', busy = false;

const story = [
  ['Start with the uncertainty', 'A past status can’t answer a present question.',
    'The buyer needs a reading for this request, with a ten-second age limit. Replay the actual request, payment, and measurement.'],
  ['01 · Request', 'Ask a physical question with an age limit.',
    '“Is the contact closed?” The request carries a unique challenge. An answer to another request does not satisfy this one.'],
  ['02 · Pay', 'The operator receives 0.001 test USDC.',
    'This recorded Solana Devnet payment precedes the measurement. The buyer purchases a check, including an honest unfavorable answer.'],
  ['03 · Measure', 'The ESP32 takes a new reading: OPEN.',
    'The board samples GPIO9 five times. It signs the result, the request challenge, and the original capture time.'],
  ['04 · Use the answer', 'A new answer can change the decision.',
    'At the original capture time, the answer matches the request, passes the signature check, and meets the ten-second age limit.'],
];

function lockControls(locked) {
  for (const button of document.querySelectorAll('.replay button')) button.disabled = locked;
}

async function render() {
  if (busy) return;
  busy = true;
  lockControls(true);
  try {
    // Keep the signed archive unchanged. Historical time is explicit in every accepted replay result.
    const source = structuredClone(original);
    if (mode === 'altered') source.receipt.result.closed = !source.receipt.result.closed;
    const inspectionTime = mode === 'now' ? Math.floor(Date.now() / 1000) : original.receipt.completed_at;
    const result = await inspectSource(source, { pin, now: inspectionTime });
    const [label, title, copy] = story[step];
    text('story-label', label);
    text('story-title', title);
    text('story-copy', copy);
    text('next', step < 4 ? ['Replay the real check →', 'Show the payment →', 'Show the measurement →', 'Check the answer →'][step] : 'Replay from the start');
    for (const button of stages) {
      if (Number(button.dataset.stage) === step) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    }
    text('device-state', step >= 3 ? 'Recorded device answer: OPEN' : 'No answer shown yet');
    el('door-open').toggleAttribute('hidden', step < 3);
    text('wire-label', ['On demand', 'Request', 'Test payment', 'Signed reading', 'Verified answer'][step]);
    text('wire-detail', ['', '10 s age limit', '0.001 USDC', 'OPEN', 'For this request'][step]);
    el('wire').classList.toggle('active', step > 0);
    text('buyer-screen', step < 3 ? ['Answer unknown', 'Check requested', 'Check purchased'][step] : 'Checking answer');
    text('buyer-screen-detail', step < 3 ? ['Need a new check', 'Unique challenge', 'Measurement follows'][step] : 'Request · key · age');
    text('buyer-caption', 'The example trip waits for an answer.');
    text('outcome-label', 'The example decision');
    text('outcome-title', 'Check before acting.');
    text('outcome-copy', 'In the example, a current OPEN answer permits the trip. An old or altered answer keeps it on hold.');
    el('outcome').dataset.tone = 'neutral';
    el('probes').hidden = step !== 4;
    el('restore').hidden = mode === 'replay';
    if (step === 4) {
      if (!result.signature || !result.terms) {
        el('outcome').dataset.tone = 'bad';
        text('story-title', 'Changing OPEN to CLOSED breaks the signature.');
        text('story-copy', 'Only the local copy changed. The board still reported OPEN. The configured device key does not authenticate the altered claim.');
        text('outcome-label', 'Altered copy · actual signature check');
        text('outcome-title', 'Reject the answer.');
        text('outcome-copy', 'The example trip stays on hold. A different claim needs a new signed measurement.');
        text('buyer-screen', 'Answer rejected');
        text('buyer-screen-detail', 'Signature does not match');
        text('wire-label', 'Altered copy');
      } else if (!result.fresh) {
        el('outcome').dataset.tone = 'warn';
        text('story-title', 'Authentic does not mean current.');
        text('story-copy', 'The signature still passes. The original timestamp remains unchanged. This October 11 reading now exceeds the ten-second age limit.');
        text('outcome-label', 'Present time · original timestamp');
        text('outcome-title', 'Request a new check.');
        text('outcome-copy', 'The example trip stays on hold. An old OPEN answer does not establish the contact state now.');
        text('buyer-screen', 'Answer too old');
        text('buyer-screen-detail', 'Authentic · expired');
        text('wire-label', 'Expired reading');
      } else {
        el('outcome').dataset.tone = 'ok';
        text('outcome-label', 'Historical replay · at original capture time');
        text('outcome-title', 'The example trip can proceed.');
        text('outcome-copy', 'OPEN meets the example policy at capture time. The recorded receipt is expired for a new decision today.');
        text('buyer-screen', 'OPEN · usable then');
        text('buyer-screen-detail', 'Authentic · fresh at capture');
        text('buyer-caption', 'Example: proceed with the trip at capture time.');
      }
    }
    text('load-status', 'The browser verifies the original signed receipt. This replay uses recorded evidence.');
    lockControls(false);
  } catch {
    // Fail closed. Never replace missing or invalid original evidence with a fabricated replay.
    text('load-status', 'The evidence check failed. Use the receipt inspector to inspect the original file. Replay controls remain disabled.');
    text('outcome-title', 'Evidence unavailable.');
    text('outcome-copy', 'No usable answer is established.');
    el('outcome').dataset.tone = 'bad';
  } finally { busy = false; }
}

el('next').addEventListener('click', () => { step = step < 4 ? step + 1 : 0; mode = 'replay'; void render(); });
for (const button of stages) button.addEventListener('click', () => { step = Number(button.dataset.stage); mode = 'replay'; void render(); });
for (const [id, selected] of [['expire', 'now'], ['alter', 'altered'], ['restore', 'replay']]) {
  el(id).addEventListener('click', () => { mode = selected; void render(); });
}

try {
  pin = await loadTrustedPin();
  const response = await fetch(new URL('./evidence/device-signed-purchase-20261011.json', import.meta.url), { cache: 'no-store' });
  if (!response.ok) throw new Error('Recorded evidence request failed');
  const body = await response.text();
  if (body.length > 65536) throw new Error('Recorded evidence exceeds its limit');
  original = JSON.parse(body);
  const check = await inspectSource(original, { pin, now: original.receipt.completed_at });
  if (!check.signature || !check.terms || !check.fresh || original.receipt.result.closed !== false) {
    throw new Error('Original evidence does not match this recorded replay');
  }
  await render();
} catch {
  text('load-status', 'The original evidence could not be verified. Reload or use the receipt inspector. Replay controls remain disabled.');
  text('outcome-title', 'Evidence unavailable.');
  text('outcome-copy', 'No usable answer is established.');
  el('outcome').dataset.tone = 'bad';
}
