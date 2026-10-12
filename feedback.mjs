import { inspectSource, loadTrustedPin } from './jobs.mjs?replay=20261011';

const el = id => document.getElementById(id);
const text = (id, value) => { el(id).textContent = value; };
const steps = [
  ['Follow one check', 'The buyer needs an answer from the physical world.',
    'Follow the request, payment, new reading, and verification.', 'Show the request →', 'Is it open now?', 'Need a new check', 'On demand', 'One paid check'],
  ['1 · Ask', 'Ask for a new check, useful for ten seconds.',
    'This buyer requests an OPEN or CLOSED contact reading.', 'Show the payment →', 'Check requested', 'Maximum age: 10 seconds', 'Request →', 'New reading'],
  ['2 · Pay', 'The device operator receives 0.001 test USDC.',
    'The recorded Solana Devnet transfer settles before the device measures.', 'Show the device check →', 'Check purchased', 'Operator receives test tokens', 'Payment →', 'Solana Devnet'],
  ['3 · Check', 'The real ESP32 reads its input: OPEN.',
    'BOOT released means OPEN. The device signs the reading for this request.', 'Verify the answer →', 'Answer received', 'OPEN · signed by device', '← Answer', 'Signed reading'],
  ['4 · Verify', 'The buyer checks the source, request, and age.',
    'The original answer passes at capture time. Try an old or changed answer below.', 'Replay from the start', 'Answer matched', 'Fresh at capture time only', '← Evidence', 'Verified signature'],
];
let original, pin, step = 0, mode = 'recorded', busy = false, failed = false;

function lock(locked) {
  for (const button of document.querySelectorAll('#replay button, .probes button')) button.disabled = locked;
}

function fail() {
  failed = true;
  lock(true);
  el('load-error').hidden = false;
  text('load-error', 'The original evidence could not be verified. Reload or open the receipt inspector.');
  text('step-title', 'Evidence unavailable.');
  text('step-copy', 'No usable answer is established.');
  el('result').hidden = true;
}

async function render() {
  if (busy || failed) return;
  busy = true;
  lock(true);
  try {
    const source = structuredClone(original);
    if (mode === 'changed') source.receipt.result.closed = !source.receipt.result.closed;
    const now = mode === 'now' ? Math.floor(Date.now() / 1000) : original.receipt.completed_at;
    const result = await inspectSource(source, { pin, now });
    const [label, title, copy, next, buyer, note, exchange, exchangeNote] = steps[step];
    for (const [id, value] of [['step-label', label], ['step-title', title], ['step-copy', copy],
      ['next', next], ['buyer-title', buyer], ['buyer-note', note], ['exchange-label', exchange],
      ['exchange-note', exchangeNote]]) text(id, value);
    // The phase controls the drawing. It never invokes hardware or payment.
    el('replay').dataset.step = String(step);
    el('exchange').dataset.direction = step >= 3 ? 'back' : 'out';
    text('operator-payment', step >= 2 ? '0.001 test USDC' : '—');
    text('device-state', step >= 3 ? 'Recorded answer: OPEN' : 'Answer not shown yet');
    el('back').hidden = step === 0;
    for (const button of document.querySelectorAll('[data-stage]')) {
      if (Number(button.dataset.stage) === step) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    }
    el('result').hidden = step !== 4;
    el('restore').hidden = mode === 'recorded';
    el('result').dataset.tone = 'ok';
    text('result-title', 'Usable then. Expired now.');
    text('result-copy', 'Original signature and request match. Freshness applies at the original capture time.');
    if (step === 4 && (!result.signature || !result.terms)) {
      el('result').dataset.tone = 'bad';
      text('result-title', 'Changed answer. Signature fails.');
      text('result-copy', 'Only a local copy changed. The device still reported OPEN. The buyer rejects this copy.');
      text('buyer-title', 'Answer rejected');
      text('buyer-note', 'Changed copy · original preserved');
      text('exchange-label', '← Rejected copy');
      text('exchange-note', 'Signature mismatch');
    } else if (step === 4 && !result.fresh) {
      el('result').dataset.tone = 'warn';
      text('result-title', 'Too old. Ask for a new check.');
      text('result-copy', 'The signature still passes. The unchanged timestamp fails the ten-second age limit now.');
      text('buyer-title', 'Answer too old');
      text('buyer-note', 'Authentic · expired');
    }
    lock(false);
  } catch {
    fail();
  } finally {
    busy = false;
  }
}

function select(nextStep, selectedMode = 'recorded') {
  if (busy || failed) return;
  step = nextStep;
  mode = selectedMode;
  void render();
}
el('next').addEventListener('click', () => select(step < 4 ? step + 1 : 0));
el('back').addEventListener('click', () => select(Math.max(0, step - 1)));
for (const button of document.querySelectorAll('[data-stage]')) {
  button.addEventListener('click', () => select(Number(button.dataset.stage)));
}
for (const [id, selectedMode] of [['expire', 'now'], ['alter', 'changed'], ['restore', 'recorded']]) {
  el(id).addEventListener('click', () => select(4, selectedMode));
}

try {
  pin = await loadTrustedPin();
  const response = await fetch(new URL('./evidence/device-signed-purchase-20261011.json', import.meta.url), { cache: 'no-store' });
  if (!response.ok) throw new Error('Recorded evidence unavailable');
  const body = await response.text();
  if (body.length > 65536) throw new Error('Recorded evidence exceeds its size limit');
  original = JSON.parse(body);
  const check = await inspectSource(original, { pin, now: original.receipt.completed_at });
  if (!check.signature || !check.terms || !check.fresh || original.receipt.result.closed !== false) {
    throw new Error('Original evidence differs from this replay');
  }
  await render();
} catch {
  fail();
}
