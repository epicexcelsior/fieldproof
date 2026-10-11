import { querySettlement, recordedPaymentDetails, publicBuyerRun, contactPolicy } from './settlement.mjs';

const el = id => document.getElementById(id);
const controls = ['original', 'tamper', 'challenge', 'identity'];
const packageView = new URL(location.href).searchParams.get('view') === 'package';
const purpose = packageView ? 'package-pickup' : 'gate-access';
const selectedSensor = packageView ? 'gpio20-contact' : 'gpio9-contact';
const policy = contactPolicy(purpose, selectedSensor);
if (packageView) {
  document.body.dataset.view = 'package';
  el('receipt-question').textContent = 'Is the package at the pickup point?';
  el('scene-owner').textContent = "Another operator's pickup point";
  el('scene-caption').textContent = 'Prototype foil contact. Closed contact represents a package. The illustration moves no robot.';
  el('observer-label').textContent = 'ESP32-C6 / GPIO20';
  el('path-note').textContent = 'x402 settlement, then a BLE contact observation. A foil contact represents package presence.';
  el('stage-note').textContent = 'Prototype package-presence contact. Read-only inspection. No robot motion.';
  el('intro-lead').textContent = 'A visiting robot needs a fresh package-presence answer from another operator before pickup.';
  if (el('watch-run')) el('watch-run').href = '?view=package&live=1&present=1';
  el('wire-note').textContent = 'Package pickup is a local buyer policy. The unchanged signed wire fields remain gate.closed and demo-gate. Closed GPIO20 contact represents PACKAGE_PRESENT.';
}
let recorded, pin, differentKey;
let running = false;
let loadedRun = false, paymentVerified = false, lastChecks = null, sourceRevision = 0, watchCycle = 0;
let localBuyer = null;
let liveOperation = null;

function renderBuyerEvents(operation, chainChecked) {
  liveOperation = operation;
  const labels = { request: 'Request created', quote: 'HTTP 402 · quote', paying: 'Buyer signed',
    settled: 'Solana settled', verified: 'ESP32 verified' };
  const rows = operation.events.map(event => ({ text: labels[event.phase], elapsed_ms: event.elapsed_ms })).filter(row => row.text);
  if (typeof chainChecked === 'boolean') rows.push({ text: chainChecked ? 'Transfer verified' : 'Transfer unverified', elapsed_ms: null });
  const signature = JSON.stringify(rows);
  if (el('buyer-events').dataset.rows !== signature) {
    el('buyer-events').dataset.rows = signature;
    el('buyer-events').replaceChildren(...rows.map(row => {
      const li = document.createElement('li'), time = document.createElement('time'), text = document.createElement('span');
      time.textContent = row.elapsed_ms === null ? 'RPC' : `${(row.elapsed_ms / 1000).toFixed(1)}s`;
      text.textContent = row.text;
      li.append(time, text);
      return li;
    }));
  }
  el('buyer-time').textContent = `${(operation.elapsed_ms / 1000).toFixed(1)}s`;
  const phases = new Set(operation.events.map(event => event.phase));
  for (const [id, done, active] of [
    ['quote', phases.has('paying'), !phases.has('paying')],
    ['pay', phases.has('settled') || phases.has('verified'), phases.has('paying')],
    ['read', phases.has('verified'), phases.has('settled')],
    ['check', chainChecked, phases.has('verified')],
  ]) el('flow-' + id).dataset.state = done ? 'done' : active ? 'active' : 'idle';
  if (chainChecked === false) el('flow-check').dataset.state = 'fail';
}

function focusDemo(enabled) {
  document.body.classList.toggle('presentation', enabled);
  el('focus').setAttribute('aria-pressed', String(enabled));
  el('focus').textContent = enabled ? 'Show full page' : 'Focus demo';
  if (localBuyer && enabled) el('focus').textContent = 'Details';
  el('receipt-question').textContent = enabled ? (localBuyer ? 'Input' : 'Signed physical reading')
    : packageView ? 'Is the package at the pickup point?' : 'Is the gate open?';
  if (enabled) el('stage-note').textContent = localBuyer
    ? 'One click pays on Devnet and requests a new ESP32 reading.'
    : 'Saved physical reading. This page creates no payment.';
}
el('focus').onclick = () => focusDemo(!document.body.classList.contains('presentation'));
focusDemo(new URL(location.href).searchParams.get('present') === '1');

function status(id, text, kind) {
  el(id).textContent = text;
  el(id).className = kind;
}

function renderScene(closed, decision) {
  const claim = policy.state(closed);
  el('scene-claim').textContent = `Receipt claim: ${claim}`;
  el('scene-decision').textContent = decision;
  el('gate-scene').dataset.claim = claim.toLowerCase();
  el('gate-scene').dataset.decision = decision.toLowerCase();
}

function renderAge(age, limit = 10, fresh = false) {
  const available = Number.isSafeInteger(age);
  const text = !available ? 'Unavailable' : age < 0 ? `${-age}s ahead`
    : age < 60 ? `${age}s old`
      : age < 3600 ? `${Math.floor(age / 60)}m ${age % 60}s old`
        : age < 86400 ? `${Math.floor(age / 3600)}h ${Math.floor(age % 3600 / 60)}m old`
          : `${Math.floor(age / 86400)}d ${Math.floor(age % 86400 / 3600)}h old`;
  el('evidence-age').textContent = text;
  el('age-limit').textContent = `Maximum age ${limit}s`;
  if (localBuyer && document.body.classList.contains('presentation') && available) {
    el('evidence-age').textContent = text.replace(' old', '');
    el('age-limit').textContent = `/ ${limit}s`;
  }
  el('evidence-age').title = available ? `${age} seconds since the signed measurement` : text;
  const bounded = available ? Math.max(0, Math.min(limit, age)) : 0;
  el('age-fill').style.width = `${bounded / limit * 100}%`;
  el('age-track').dataset.fresh = String(fresh);
  el('age-track').setAttribute('aria-valuemax', String(limit));
  el('age-track').setAttribute('aria-valuenow', String(bounded));
  el('age-track').setAttribute('aria-valuetext', `${text}. Maximum age ${limit} seconds.`);
}

async function showLocalOperation(id) {
  el('local-buy').disabled = true;
  let result;
  const deadline = Date.now() + 70000;
  while (Date.now() < deadline) {
    const response = await fetch(`/local-buyer/purchase/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Buyer status is unavailable. Preserve the operation ID: ' + id);
    result = await response.json();
    renderBuyerEvents(result);
    const phases = new Set(result.events.map(event => event.phase));
    el('buyer-progress').textContent = result.status === 'done' ? 'Payment response and signed reading received.'
      : result.status === 'review' ? result.error
        : phases.has('paying') ? 'Payment submitted. Waiting for settlement and the ESP32 reading.'
          : phases.has('quote') ? 'x402 quote received. Signing the test payment.' : 'Creating one observation request.';
    el('buyer-time').textContent = `${(result.elapsed_ms / 1000).toFixed(1)}s`;
    if (result.status === 'done') {
      ++watchCycle;
      await showPurchase(result.run, true, true);
      await verifyPayment();
      renderBuyerEvents(result, paymentVerified);
      refreshDecision();
      const configuration = await fetch('/local-buyer/config', { cache: 'no-store' });
      if (!configuration.ok) throw new Error('Purchase completed. Reload the page before another purchase.');
      localBuyer = await configuration.json();
      el('local-buy').disabled = localBuyer.blocked || localBuyer.busy || localBuyer.remaining <= 0;
      if (localBuyer.remaining <= 0) {
        el('buyer-progress').dataset.error = 'true';
        el('buyer-progress').textContent = 'Local purchase limit reached. This paid result remains available.';
      }
      return;
    }
    if (result.status === 'review') {
      el('buyer-progress').dataset.error = 'true';
      throw new Error(result.error + (result.purchase_id ? ` Purchase ID: ${result.purchase_id}` : ''));
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('The operation is still unresolved. Preserve operation ID ' + id + '. No automatic paid retry.');
}

async function initLocalBuyer() {
  const response = await fetch('/local-buyer/config', { cache: 'no-store' });
  if (response.status === 404) return; // The read-only inspector has no signer or purchase control.
  if (!response.ok) throw new Error('The local buyer is unavailable.');
  localBuyer = await response.json();
  if (localBuyer.price_usdc !== '0.001') throw new Error('The local buyer has unexpected payment terms.');
  document.body.classList.add('local-buyer-enabled');
  el('local-buyer').hidden = false;
  el('local-buy').textContent = 'Pay 0.001 USDC';
  el('signature').previousElementSibling.textContent = 'Signature';
  el('freshness').previousElementSibling.textContent = 'Freshness';
  el('transaction').textContent = 'Transaction ↗';
  el('tamper').textContent = 'Alter';
  el('original').textContent = 'Original';
  focusDemo(document.body.classList.contains('presentation'));
  el('receipt-question').textContent = 'Input';
  el('stage-note').textContent = 'One click pays on Devnet and requests a new ESP32 reading.';
  for (const [id, value] of [['buyer-address', localBuyer.payer], ['buyer-merchant', localBuyer.payTo]]) {
    el(id).textContent = value.slice(0, 6) + '…' + value.slice(-4);
    el(id).title = value;
    el(id).href = 'https://explorer.solana.com/address/' + encodeURIComponent(value) + '?cluster=devnet';
  }
  el('buyer-progress').textContent = localBuyer.blocked ? 'An earlier purchase requires review. No new payment can start.'
    : 'Ready. Each click pays once and requests a new physical reading.';
  el('local-buy').disabled = localBuyer.blocked || localBuyer.busy || localBuyer.remaining <= 0;
  el('local-buy').onclick = async () => {
    el('local-buy').disabled = true;
    ++watchCycle;
    clearSource('Waiting for this new paid observation.');
    liveOperation = null;
    el('buyer-progress').dataset.error = 'false';
    el('buyer-events').replaceChildren();
    el('buyer-events').dataset.rows = '';
    for (const id of ['quote', 'pay', 'read', 'check']) el('flow-' + id).dataset.state = id === 'quote' ? 'active' : 'idle';
    const operation_id = crypto.randomUUID();
    try {
      const response = await fetch('/local-buyer/purchase', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-FieldProof-Buyer-Token': localBuyer.token },
        body: JSON.stringify({ operation_id }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'The local purchase did not start.');
      await showLocalOperation(operation_id);
    } catch (error) {
      el('buyer-progress').dataset.error = 'true';
      el('buyer-progress').textContent = error.message;
      el('reason').textContent = 'Purchase requires review. No automatic paid retry.';
    }
  };
  const previous = localBuyer.active_operation_id ?? localBuyer.last_operation_id;
  if (previous && !localBuyer.blocked) {
    try { await showLocalOperation(previous); }
    catch (error) { el('buyer-progress').dataset.error = 'true'; el('buyer-progress').textContent = error.message; }
  } else {
    clearSource(localBuyer.blocked ? 'An earlier purchase requires review.' : 'Select Pay to request one fresh signed reading.');
    el('proof-payment-amount').textContent = '0.001 Devnet USDC';
    if (localBuyer.blocked) {
      el('buyer-progress').dataset.error = 'true';
      el('buyer-progress').textContent = `An earlier purchase requires review. Operation ID: ${previous ?? 'unavailable'}. No new payment started.`;
    }
  }
}

function message(r) {
  const s = r.result;
  return ['fieldproof-observation-v1', r.protocol, r.request_id, r.provider, r.capability,
    r.parameters.location, r.nonce, s.metric, s.sensor, Number(s.closed), s.stable_samples,
    s.total_samples, r.started_at, r.completed_at].join('|');
}

async function verifySignature(r, key) {
  const encoded = typeof r.receipt_signature === 'string' && r.receipt_signature.startsWith('v3:')
    ? r.receipt_signature.slice(3) : '';
  const signature = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
  return signature.length === 64 && btoa(String.fromCharCode(...signature)) === encoded &&
    crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, new TextEncoder().encode(message(r)));
}

async function inspectContactStates() {
  try {
    const response = await fetch(new URL('./evidence/device-signed-contact-states.json', import.meta.url));
    if (!response.ok) throw new Error('Recorded input evidence is unavailable.');
    const evidence = await response.json();
    const rows = [];
    for (const [state, closed] of [['held', true], ['released', false]]) {
      const r = evidence[state]?.receipt, challenge = evidence[state]?.challenge;
      if (!r || !challenge || r.protocol !== 'capmesh/0.1' || r.status !== 'success' ||
          r.provider !== 'esp32-c6-96a2' || r.capability !== 'state.observe' ||
          typeof challenge.request_id !== 'string' || !/^[A-Za-z0-9_-]{1,16}$/.test(challenge.request_id) ||
          !Number.isInteger(challenge.nonce) || challenge.nonce < 1 || challenge.nonce > 0x7fffffff ||
          r.request_id !== challenge.request_id || r.nonce !== challenge.nonce ||
          r.parameters?.location !== 'demo-gate' || Object.keys(r.parameters).length !== 1 ||
          r.result?.metric !== 'gate.closed' || r.result.sensor !== 'gpio9-contact' ||
          r.result.closed !== closed || r.result.stable_samples !== 5 || r.result.total_samples !== 5 ||
          !Number.isSafeInteger(challenge.timestamp) || !Number.isSafeInteger(challenge.expiration) ||
          challenge.expiration <= challenge.timestamp ||
          !Number.isSafeInteger(r.started_at) || !Number.isSafeInteger(r.completed_at) ||
          r.started_at < challenge.timestamp - 2 || r.completed_at < r.started_at ||
          r.completed_at > challenge.expiration || Math.floor(Date.now() / 1000) - r.completed_at <= 10 ||
          !await verifySignature(r, pin)) {
        throw new Error('The recorded input pair failed signature, challenge, state, or expiration checks.');
      }
      const row = document.createElement('li');
      row.textContent = `BOOT ${state} → ${closed ? 'CLOSED' : 'OPEN'} · VALID signature · 5/5 samples · EXPIRED → WAIT`;
      rows.push(row);
    }
    el('contact-results').replaceChildren(...rows);
    status('contact-status', 'VERIFIED INPUT PAIR · Recorded, no payment', 'pass');
  } catch (error) {
    el('contact-results').replaceChildren();
    status('contact-status', 'NOT VERIFIED · ' + error.message, 'fail');
  }
}

function refreshDecision() {
  if (!lastChecks) return;
  const { r, challenge, authentic, bound, contract } = lastChecks, s = r.result;
  const now = Math.floor(Date.now() / 1000);
  const fresh = Number.isInteger(r.started_at) && Number.isInteger(r.completed_at) &&
    r.started_at >= challenge.created_at - 2 && r.started_at <= r.completed_at && r.completed_at <= now + 2 &&
    now - r.completed_at <= challenge.max_age_seconds;
  status('freshness', fresh ? 'FRESH' : 'EXPIRED', fresh ? 'pass' : 'expired');
  renderAge(now - r.completed_at, challenge.max_age_seconds, fresh);
  status('live-payment-check', paymentVerified ? 'VERIFIED' : 'NOT VERIFIED', paymentVerified ? 'pass' : 'expired');
  const accepted = authentic && bound && contract && fresh && (!loadedRun || paymentVerified);
  const decision = policy.decision(accepted, s.closed);
  el('decision').textContent = decision;
  el('decision').className = `decision ${decision === 'DISPATCH' ? 'pass' : 'expired'}`;
  renderScene(s.closed, el('decision').textContent);
  if (localBuyer && liveOperation && paymentVerified) {
    el('flow-check').dataset.state = !authentic || !bound || !contract ? 'fail' : fresh ? 'done' : 'expired';
  }
  el('reason').textContent = !authentic ? 'The receipt does not match the pinned signing key.'
    : !bound ? 'This receipt cannot answer a different buyer challenge.'
      : !contract ? 'The contact does not satisfy the buyer contract.'
        : !fresh ? 'The signature is valid. The reading is too old to use.'
          : loadedRun && !paymentVerified ? 'Fresh signed answer. Verify its reported payment before the combined demo decision.'
            : packageView ? (s.closed ? 'Fresh contact evidence says PACKAGE_PRESENT.' : 'Fresh contact evidence says PACKAGE_ABSENT. Wait for a package.')
              : s.closed ? 'Fresh contact evidence says closed.' : 'Fresh contact evidence says open.';
}

async function experiment(mode = 'original') {
  if (running || !recorded) return;
  running = true;
  const revision = sourceRevision;
  lastChecks = null;
  renderAge(null);
  el('decision').textContent = 'WAIT';
  el('decision').className = 'decision expired';
  renderScene(undefined, 'WAIT');
  controls.forEach(id => { el(id).disabled = true; });
  const labels = { original: 'Original reading', tamper: 'Altered reading',
    challenge: 'Another buyer challenge', identity: 'Untrusted verification key' };
  el('experiment-label').textContent = labels[mode];
  controls.forEach(id => { el(id).setAttribute('aria-pressed', String(id === mode)); });
  try {
    const r = structuredClone(recorded.receipt);
    const challenge = structuredClone(recorded.challenge);
    if (mode === 'tamper') r.result.closed = !r.result.closed;
    if (mode === 'challenge') challenge.nonce = challenge.nonce === 0x7fffffff ? 1 : challenge.nonce + 1;
    const key = mode === 'identity' ? differentKey : pin;
    const authentic = await verifySignature(r, key);
    if (revision !== sourceRevision) return;
    const bound = r.protocol === 'capmesh/0.1' && r.status === 'success' && r.provider === 'esp32-c6-96a2' &&
      r.capability === 'state.observe' && r.request_id === challenge.id && r.nonce === challenge.nonce &&
      r.parameters.location === challenge.location && Object.keys(r.parameters).length === 1;
    const s = r.result;
    const contract = s.metric === 'gate.closed' && s.sensor === selectedSensor && typeof s.closed === 'boolean' &&
      s.total_samples === 5 && s.stable_samples === 5;
    status('signature', authentic ? 'VALID' : 'REJECTED', authentic ? 'pass' : 'fail');
    status('binding', bound ? 'MATCHES' : 'REJECTED', bound ? 'pass' : 'fail');
    status('contract', contract ? '5/5 AGREE' : 'REJECTED', contract ? 'pass' : 'fail');
    lastChecks = { r, challenge, authentic, bound, contract };
    refreshDecision();
    el('state').textContent = policy.state(s.closed);
    el('payload').textContent = JSON.stringify({ experiment: mode, challenge, receipt: r }, null, 2);
  } catch {
    if (revision !== sourceRevision) return;
    status('signature', 'REJECTED', 'fail');
    el('decision').textContent = 'WAIT';
    renderScene(undefined, 'WAIT');
    el('reason').textContent = 'Receipt verification failed. Check the evidence and public pin.';
  } finally {
    if (revision === sourceRevision) {
      running = false;
      controls.forEach(id => { el(id).disabled = !recorded; });
    }
  }
}

function clearSource(reason) {
  sourceRevision += 1;
  running = false;
  recorded = null;
  lastChecks = null;
  renderAge(null);
  paymentVerified = false;
  controls.forEach(id => { el(id).disabled = true; });
  el('chain-query').disabled = true;
  status('signature', 'NOT VERIFIED', 'fail');
  status('binding', 'UNAVAILABLE', ''); status('contract', 'UNAVAILABLE', ''); status('freshness', 'UNAVAILABLE', 'expired');
  status('chain-status', 'NOT QUERIED', ''); status('live-payment-check', 'NOT VERIFIED', 'expired');
  status('proof-payment-check', 'NOT QUERIED', '');
  el('proof-payment-amount').textContent = 'Unavailable';
  el('decision').className = 'decision expired';
  el('decision').textContent = 'WAIT'; renderScene(undefined, 'WAIT');
  el('receipt-source').textContent = 'No usable buyer output / demo-gate';
  el('reason').textContent = reason; el('source-status').textContent = reason;
  for (const id of ['state', 'measured', 'payment-payer', 'payment-merchant', 'payment-amount']) el(id).textContent = 'Unavailable';
  for (const id of ['transaction', 'payment-explorer']) el(id).removeAttribute('href');
  el('payload').textContent = 'No usable buyer output.';
  el('chain-summary').textContent = 'No current transfer check.'; el('chain-result').textContent = 'No network query yet.';
}

async function showPurchase(input, buyer = false, localPurchase = false) {
  const next = publicBuyerRun(input, purpose);
  clearSource('Verifying this buyer output.');
  recorded = next; loadedRun = buyer;
  el('live-payment-row').hidden = !buyer;
  el('source-banner').textContent = buyer ? 'Loaded independent buyer output · Solana Devnet' : 'Recorded hardware evidence · Solana Devnet';
  el('source-description').textContent = buyer ? 'This prototype purchases one contact observation. This inspector verifies the selected buyer output.' : 'This prototype purchases one contact observation. This inspector uses recorded evidence.';
  el('receipt-source').textContent = buyer ? `Buyer run ${next.purchase_id} / ${packageView ? 'prototype pickup' : 'demo-gate'}` : 'Recorded purchase / demo-gate';
  el('stage-source').textContent = buyer ? `Buyer run ${next.purchase_id} / browser sends no funds` : 'Recorded device evidence / actual Devnet test payment';
  el('stage-heading').textContent = 'Is this reading still fresh?';
  el('payment-source').textContent = buyer ? 'Loaded buyer settlement / verify it against Solana / no browser payment' : 'Actual recorded test payment · October 1 · No new payment here';
  el('source-status').textContent = buyer ? 'Loaded buyer output. The file supplies its challenge. The installed public pin verifies the device. Chain verification remains separate.' : 'Installed buyer pin remains the trust root.';
  if (localPurchase) {
    el('stage-source').textContent = `Local paid purchase ${next.purchase_id} / laptop signs the payment`;
    el('payment-source').textContent = 'Actual Devnet purchase from the local disposable buyer';
    el('source-status').textContent = 'The local buyer selects the challenge. The installed public pin verifies the device. Chain verification remains separate.';
  }
  el('measured').textContent = new Date(next.receipt.completed_at * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
  el('transaction').href = 'https://explorer.solana.com/tx/' + encodeURIComponent(next.settlement.transaction) + '?cluster=devnet';
  const payment = recordedPaymentDetails(next);
  el('payment-payer').textContent = payment.payer; el('payment-merchant').textContent = payment.merchant;
  el('payment-amount').textContent = payment.amount_usdc.toFixed(3);
  el('proof-payment-amount').textContent = `${payment.amount_usdc.toFixed(3)} Devnet USDC`;
  el('payment-explorer').href = el('transaction').href;
  el('chain-summary').textContent = 'The displayed terms come from the buyer output. Run the read-only query to verify the transfer.';
  el('chain-query').disabled = false;
  el('chain-query').textContent = buyer ? 'Verify buyer payment' : 'Verify recorded payment';
  await experiment();
}

async function verifyPayment() {
  if (!recorded) return;
  const target = recorded, revision = sourceRevision;
  paymentVerified = false; refreshDecision();
  el('chain-query').disabled = true;
  status('chain-status', 'CHECKING', 'expired');
  status('proof-payment-check', 'CHECKING', 'expired');
  el('chain-summary').textContent = 'Checking the actual transfer. No funds move.';
  el('chain-result').textContent = 'Querying Solana Devnet. No payment or hardware request occurs.';
  try {
    const result = await querySettlement(target);
    if (revision !== sourceRevision) return;
    paymentVerified = true;
    status('chain-status', 'VERIFIED TRANSFER', 'pass');
    status('proof-payment-check', 'VERIFIED TRANSFER', 'pass');
    el('chain-summary').textContent = `Verified: buyer −0.001 USDC → merchant +0.001 USDC. Confirmed slot ${result.slot}.`;
    el('chain-result').textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    if (revision !== sourceRevision) return;
    status('chain-status', 'NOT VERIFIED', 'expired');
    status('proof-payment-check', 'NOT VERIFIED', 'expired');
    el('chain-result').textContent = error.name === 'TimeoutError' ? 'The Devnet RPC query timed out after 15 seconds. Try again.' : error.message;
    el('chain-summary').textContent = el('chain-result').textContent;
  } finally {
    if (revision === sourceRevision) {
      el('chain-query').disabled = false;
      if (localBuyer && liveOperation?.purchase_id === target.purchase_id) renderBuyerEvents(liveOperation, paymentVerified);
      refreshDecision();
    }
  }
}

async function watchBuyerRun() {
  const cycle = ++watchCycle, deadline = Date.now() + 120000;
  clearSource('Waiting for one independent buyer output. This browser sends no funds and invokes no hardware.');
  el('stage-source').textContent = 'Waiting for a new independent buyer run / no browser payment';
  el('receipt-source').textContent = 'Waiting for buyer output / demo-gate';
  while (cycle === watchCycle && Date.now() < deadline) {
    try {
      const response = await fetch('/buyer-run', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
      if (cycle !== watchCycle) return;
      if (response.ok) {
        const text = await response.text();
        if (cycle !== watchCycle) return;
        if (text.length > 32768) throw new Error('Buyer output exceeds the inspection limit.');
        await showPurchase(JSON.parse(text), true);
        if (cycle !== watchCycle) return;
        await verifyPayment(); // One automatic read-only query. No payment retry occurs.
        return;
      }
      if (response.status !== 404) el('reason').textContent = 'Buyer output is incomplete or failed. Preserve the independent buyer terminal result.';
    } catch {
      if (cycle === watchCycle) el('reason').textContent = 'Buyer output is unavailable or failed validation. No recorded fallback was substituted.';
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (cycle === watchCycle) clearSource('The two-minute buyer monitor ended. Check the gateway output path, then reload this view.');
}

async function init() {
  const pinsResponse = await fetch(new URL('./receipt-keys.json', import.meta.url));
  if (!pinsResponse.ok) throw new Error('Installed buyer configuration is unavailable.');
  const pins = await pinsResponse.json();
  if (pins.algorithm !== 'ecdsa-p256-sha256') throw new Error('Unsupported buyer identity algorithm.');
  const sec1 = pins.providers['esp32-c6-96a2'];
  if (!/^04[0-9a-f]{128}$/.test(sec1 || '')) throw new Error('The buyer configuration has no valid device pin.');
  const bytes = Uint8Array.from(sec1.match(/../g), pair => parseInt(pair, 16));
  pin = await crypto.subtle.importKey('raw', bytes, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  differentKey = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])).publicKey;
  el('pin').textContent = JSON.stringify({ algorithm: pins.algorithm, provider: 'esp32-c6-96a2', sec1_hex: sec1 }, null, 2);
  controls.forEach(id => { el(id).onclick = () => experiment(id); });
  el('chain-query').onclick = verifyPayment;
  const archived = async () => {
    const cycle = ++watchCycle;
    clearSource('Loading committed evidence.');
    try {
      const response = await fetch(new URL('./evidence/device-signed-purchase.json', import.meta.url));
      if (!response.ok) throw new Error('Committed evidence is unavailable.');
      const input = await response.json();
      if (cycle === watchCycle) await showPurchase(input);
    } catch { if (cycle === watchCycle) clearSource('Committed evidence is unavailable.'); }
  };
  el('use-recorded').disabled = packageView;
  el('use-recorded').onclick = packageView ? null : archived;
  el('run-file').disabled = false;
  el('run-file').onchange = async () => {
    const file = el('run-file').files[0]; if (!file) return;
    const cycle = ++watchCycle;
    clearSource('Loading selected buyer output.');
    try {
      if (file.size > 32768) throw new Error('File too large');
      const input = JSON.parse(await file.text());
      if (cycle === watchCycle) await showPurchase(input, true);
    } catch { if (cycle === watchCycle) clearSource('Rejected buyer output. Use the buyer result JSON, never a wallet keypair.'); }
    el('run-file').value = '';
  };
  setInterval(refreshDecision, 250);
  if (packageView || new URL(location.href).searchParams.get('live') === '1') void watchBuyerRun();
  else if (new URL(location.href).searchParams.get('record') === '20261011') {
    // Fixed public asset only. A URL cannot select a wallet, arbitrary file, or verification key.
    const response = await fetch(new URL('./evidence/device-signed-purchase-20261011.json', import.meta.url));
    if (!response.ok) throw new Error('The October 11 recorded purchase is unavailable.');
    await showPurchase(await response.json(), true);
    el('source-description').textContent = 'Recorded October 11 paid physical check. No new payment or measurement occurs.';
    el('payment-source').textContent = 'Actual recorded test payment · October 11 · No new payment here';
  }
  else await archived();
  if (!packageView) await inspectContactStates();
  else {
    el('contact-results').replaceChildren();
    el('contact-status').textContent = 'GPIO9 button records belong to the gate demo. This view requires a new GPIO20 buyer output.';
  }
  if (!packageView) await initLocalBuyer();
}

init().catch(error => {
  clearSource(error.message);
  if (localBuyer) {
    el('buyer-progress').dataset.error = 'true';
    el('buyer-progress').textContent = error.message;
  }
});
