import { querySettlement } from './settlement.mjs';

// This key comes from host/capmesh/protocol/receipt_keys.json, not from a job file.
export const INSTALLED_PROVIDER = 'esp32-c6-96a2';
export const INSTALLED_PIN = '046218c52391433f9a687743192c5558a121320b8fa664931e5aaa1b6e5fbf342f9411913c8b72c91a3e7b9762e34e77955ed6035b81fa27ab7770dd8d4922ed63';
const NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const RECIPIENT = 'CaQAKBcwf7G5vXeu2RNuNGJafnJ8724Uj4wv9ivfxfQA';
const base58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
const encoder = new TextEncoder();

export async function loadTrustedPin(fetcher = fetch) {
  // The embedded provisioned pin supports standalone static exports.
  // A served key file that disagrees with it requires an explicit app update.
  try {
    const response = await fetcher('./receipt-keys.json', { cache: 'no-store' });
    if (response.status === 404) return INSTALLED_PIN;
    if (!response.ok) throw new Error(`Public pin request returned HTTP ${response.status}`);
    const body = await response.text();
    if (body.length > 4096) throw new Error('Public pin file exceeds its limit');
    const keys = JSON.parse(body);
    if (keys?.algorithm !== 'ecdsa-p256-sha256' || keys.providers?.[INSTALLED_PROVIDER] !== INSTALLED_PIN) {
      throw new Error('Served public pin differs from the installed FieldProof pin');
    }
    return INSTALLED_PIN;
  } catch (error) {
    if (error instanceof TypeError) return INSTALLED_PIN; // Standalone exports have no pin route.
    throw error;
  }
}

export function canonicalJSON(value) {
  function encode(input) {
    if (input === null || typeof input === 'boolean') return JSON.stringify(input);
    if (typeof input === 'string' && input.isWellFormed()) return JSON.stringify(input);
    if (typeof input === 'number' && Number.isSafeInteger(input) && !Object.is(input, -0)) return JSON.stringify(input);
    if (Array.isArray(input)) return '[' + input.map(encode).join(',') + ']';
    if (input && typeof input === 'object' && Object.getPrototypeOf(input) === Object.prototype) {
      const keys = Object.keys(input).sort();
      if (keys.some(key => !/^[A-Za-z0-9_]+$/.test(key))) throw new Error('Unsupported job key');
      return '{' + keys.map(key => JSON.stringify(key) + ':' + encode(input[key])).join(',') + '}';
    }
    throw new Error('Unsupported job value');
  }
  return encode(value);
}

function bytes(hex) {
  if (typeof hex !== 'string' || !/^04[0-9a-f]{128}$/.test(hex)) throw new Error('Installed P-256 pin is invalid');
  return Uint8Array.from(hex.match(/../g), part => parseInt(part, 16));
}

export function receiptMessage(r) {
  const s = r.result;
  return ['fieldproof-observation-v1', r.protocol, r.request_id, r.provider, r.capability,
    r.parameters.location, r.nonce, s.metric, s.sensor, Number(s.closed), s.stable_samples,
    s.total_samples, r.started_at, r.completed_at].join('|');
}

export async function verifyReceiptSignature(r, pin = INSTALLED_PIN) {
  const encoded = typeof r?.receipt_signature === 'string' && r.receipt_signature.startsWith('v3:')
    ? r.receipt_signature.slice(3) : '';
  if (!/^[A-Za-z0-9+/]{86}==$/.test(encoded)) return false;
  let signature;
  try { signature = Uint8Array.from(atob(encoded), char => char.charCodeAt(0)); }
  catch { return false; }
  if (signature.length !== 64 || btoa(String.fromCharCode(...signature)) !== encoded) return false;
  const key = await crypto.subtle.importKey('raw', bytes(pin), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, encoder.encode(receiptMessage(r)));
}

function paymentTerms(payment) {
  return payment?.network === NETWORK && payment.asset === USDC && payment.recipient === RECIPIENT &&
    payment.amount_base_units === '1000' && payment.kind === 'test-token' &&
    typeof payment.transaction === 'string' && payment.transaction.length >= 64 && payment.transaction.length <= 88 &&
    base58.test(payment.transaction) && typeof payment.payer === 'string' &&
    payment.payer.length >= 32 && payment.payer.length <= 44 && base58.test(payment.payer) &&
    payment.payer !== RECIPIENT;
}

export function normalizeSource(input) {
  const job = input?.job?.schema === 'fieldproof-job-v1' ? input.job :
    input?.schema === 'fieldproof-job-v1' ? input : null;
  if (job) {
    if (!job.request || typeof job.request !== 'object' || !job.receipt || typeof job.receipt !== 'object' ||
        !job.receipt.result || typeof job.receipt.result !== 'object' || !job.payment || typeof job.payment !== 'object') {
      throw new Error('Job file is missing request, receipt, or payment data');
    }
    return { kind: 'job', job, event: input?.event ?? input?.peaq_event ?? null,
    request: job.request, receipt: job.receipt, provider: job.provider, id: job.job_id,
    transaction: job.payment.transaction };
  }
  const run = input?.purchase ?? input;
  if (run?.purchase_id && run?.challenge && run?.receipt?.result && run?.settlement) return {
    kind: 'historical', run, request: run.challenge, receipt: run.receipt,
    provider: run.receipt.provider, id: run.purchase_id, transaction: run.settlement.transaction,
  };
  throw new Error('Choose a FieldProof job file or independent buyer output');
}

export async function inspectSource(sourceInput, { pin = INSTALLED_PIN, now = Math.floor(Date.now() / 1000) } = {}) {
  const source = normalizeSource(sourceInput), { request: q, receipt: r, job } = source, s = r?.result;
  if (!Number.isSafeInteger(now) || now < 1) throw new Error('Inspection time is invalid');
  const id = typeof source.id === 'string' && /^[0-9a-f]{16}$/.test(source.id);
  const nonce = Number.isSafeInteger(q?.nonce) && q.nonce > 0 && q.nonce <= 0x7fffffff;
  const requestValid = id && q.id === source.id && nonce && Number.isSafeInteger(q.created_at) &&
    q.created_at > 0 && q.location === 'demo-gate' && q.max_age_seconds === 10 &&
    (source.kind === 'historical' ? q.contact === undefined ||
      (q.contact?.provider === INSTALLED_PROVIDER && q.contact?.sensor === 'gpio9-contact') :
      (q.contact?.provider === INSTALLED_PROVIDER && q.contact?.sensor === 'gpio9-contact'));
  const contract = r?.protocol === 'capmesh/0.1' && r.status === 'success' &&
    r.request_id === source.id && r.provider === INSTALLED_PROVIDER && source.provider === INSTALLED_PROVIDER &&
    r.capability === 'state.observe' && r.nonce === q?.nonce && r.parameters?.location === q?.location &&
    r.parameters && Object.keys(r.parameters).length === 1 && s?.metric === 'gate.closed' &&
    s.sensor === 'gpio9-contact' && typeof s.closed === 'boolean' && s.stable_samples === 5 && s.total_samples === 5 &&
    Number.isSafeInteger(r.started_at) && Number.isSafeInteger(r.completed_at) &&
    r.started_at >= q?.created_at - 2 && r.started_at <= r.completed_at;
  let signature = false;
  try { if (contract) signature = await verifyReceiptSignature(r, pin); } catch { signature = false; }
  const historicalPayment = source.kind === 'historical' && source.run.settlement?.success === true &&
    source.run.settlement.network === NETWORK && source.run.settlement.payer !== RECIPIENT &&
    typeof source.run.settlement.payer === 'string' && source.run.settlement.payer.length >= 32 &&
    source.run.settlement.payer.length <= 44 && base58.test(source.run.settlement.payer) &&
    typeof source.run.settlement.transaction === 'string' && source.run.settlement.transaction.length >= 64 &&
    source.run.settlement.transaction.length <= 88 && base58.test(source.run.settlement.transaction);
  const terms = Boolean(requestValid && contract && (job ? paymentTerms(job.payment) : historicalPayment));
  let receiptDigest = false;
  if (job && typeof job.receipt_sha256 === 'string' && /^[0-9a-f]{64}$/.test(job.receipt_sha256)) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', encoder.encode(canonicalJSON(r)));
      receiptDigest = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('') === job.receipt_sha256;
    } catch { receiptDigest = false; }
  }
  const acceptedAt = job?.acceptance?.verified_at;
  const recordedAcceptance = !job || (job.acceptance?.accepted === true && receiptDigest &&
    Number.isSafeInteger(acceptedAt) && acceptedAt >= r.completed_at && acceptedAt <= r.completed_at + q.max_age_seconds &&
    job.acceptance.decision === (s.closed ? 'WAIT' : 'DISPATCH'));
  const identity = job?.identity;
  const identityConsistent = !job || (identity?.schema === 'fieldproof-peaq-identity-v1' &&
    identity.receipt_public_key === pin && identity.machine_id && typeof identity.machine_id === 'string' &&
    identity.service?.endpoint === 'urn:fieldproof:ble-contact:esp32-c6-96a2:gpio9-contact:state.observe' &&
    Number.isSafeInteger(identity.finalized_block));
  const fresh = Boolean(terms && Number.isSafeInteger(r.completed_at) && r.completed_at <= now + 2 &&
    now - r.completed_at <= q.max_age_seconds);
  return { source, signature, terms: Boolean(terms && recordedAcceptance && identityConsistent),
    receiptDigest, recordedAcceptance: Boolean(recordedAcceptance), identityConsistent: Boolean(identityConsistent),
    fresh, ageSeconds: Number.isSafeInteger(r.completed_at) ? now - r.completed_at : null,
    paymentTerms: job ? paymentTerms(job.payment) : Boolean(historicalPayment),
    receiptDecision: signature && terms && recordedAcceptance && identityConsistent && fresh && !s.closed ? 'DISPATCH' : 'WAIT',
    decision: 'WAIT' }; // The page has not independently queried the payment yet.
}

export function paymentQueryInput(source) {
  if (source.kind === 'historical') return source.run;
  return { settlement: { success: true, network: source.job.payment.network,
    transaction: source.job.payment.transaction, payer: source.job.payment.payer } };
}

export function decisionAt(inspection, paymentVerified, now = Math.floor(Date.now() / 1000)) {
  if (!Number.isSafeInteger(now) || now < 1) throw new Error('Inspection time is invalid');
  const r = inspection.source.receipt, q = inspection.source.request;
  const ageSeconds = Number.isSafeInteger(r.completed_at) ? now - r.completed_at : null;
  const fresh = Boolean(inspection.terms && ageSeconds !== null && ageSeconds >= -2 && ageSeconds <= q.max_age_seconds);
  return { fresh, ageSeconds,
    decision: paymentVerified && inspection.signature && inspection.terms && fresh && r.result.closed === false ? 'DISPATCH' : 'WAIT' };
}

// Other pages reuse the verification exports without starting the workbench or its local buyer.
if (typeof document !== 'undefined' && document.body?.dataset.fieldproofPage === 'jobs') {
  const el = id => document.getElementById(id);
  let original = null, inspection = null, pin = INSTALLED_PIN, paymentVerified = false;
  let localConfig = null, lastOperation = null, publishedJob = null;
  let generation = 0;
  const text = (id, value) => { el(id).textContent = value; };
  const mark = (id, value, cls) => { text(id, value); el(id).className = cls; };
  const status = (value, cls = '') => { text('status', value); el('status').className = 'statusline ' + cls; };
  const safeDate = seconds => Number.isSafeInteger(seconds) ? new Date(seconds * 1000).toISOString().replace('T',' ').replace('.000Z',' UTC') : 'Unavailable';

  async function render(input, label = 'Imported local file', replaceOriginal = true) {
    const version = ++generation;
    inspection = null; paymentVerified = false;
    el('verify-payment').disabled = true;
    text('decision', 'WAIT');
    el('decision').className = 'result warn';
    const checked = await inspectSource(input, { pin });
    if (version !== generation) return;
    if (replaceOriginal) original = structuredClone(input);
    inspection = checked;
    el('verify-payment').disabled = false;
    const { source, signature, terms, fresh, ageSeconds } = inspection;
    const { request: q, receipt: r, job } = source;
    el('ticket').hidden = false;
    text('source-tag', label);
    text('request-id', source.id);
    text('provider', source.provider);
    text('question', `${r.result?.metric ?? 'Unavailable'} / ${r.result?.sensor ?? 'Unavailable'}`);
    text('contact', typeof r.result?.closed === 'boolean' ? r.result.closed ? 'CLOSED' : 'OPEN' : 'Unavailable');
    text('payment-state', source.kind === 'job' ? 'Job reports settled' : 'Recorded buyer output');
    text('captured', safeDate(r.completed_at));
    text('age-limit', `${q.max_age_seconds ?? 'Unavailable'} seconds`);
    text('transaction', source.transaction ?? 'Unavailable');
    if (typeof source.transaction === 'string' && base58.test(source.transaction)) {
      el('explorer').href = `https://explorer.solana.com/tx/${encodeURIComponent(source.transaction)}?cluster=devnet`;
    } else el('explorer').removeAttribute('href');
    text('machine-id', job?.identity?.machine_id ?? 'No peaq identity in this historical run');
    const eventState = source.event?.status ?? source.event?.state;
    text('event-status', eventState ? `Recorded ${eventState}; this page does not query peaq now` : 'No linked peaq event shown');
    mark('pin-check', 'INSTALLED', 'ok');
    mark('signature-check', signature ? 'VALID' : 'REJECTED', signature ? 'ok' : 'bad');
    mark('terms-check', terms ? 'MATCH' : 'REJECTED', terms ? 'ok' : 'bad');
    mark('age-check', fresh ? `FRESH · ${Math.max(0,ageSeconds)}s` : 'EXPIRED / UNAVAILABLE', fresh ? 'ok' : 'warn');
    mark('payment-check', 'NOT QUERIED', 'pending');
    mark('peaq-check', 'NOT LIVE VERIFIED', 'pending');
    text('decision', inspection.decision);
    el('decision').className = 'result ' + (inspection.decision === 'DISPATCH' ? 'ok' : 'warn');
    text('decision-note', !signature ? 'The original receipt signature failed against the installed public pin.' :
      !terms ? 'The request, payment terms, receipt digest, or recorded identity does not match.' :
        !fresh ? 'The signed answer is too old for the ten-second buyer policy.' :
          'Signature and terms match. Verify the Devnet transfer separately before relying on this paid run.');
    text('ticket-note', source.kind === 'historical' ? 'Historical paid run. No peaq identity or event is claimed.' :
      'The peaq fields are recorded data. This page has not queried the registry.');
    el('tamper').disabled = false; el('restore').disabled = true;
    status(signature && terms ? (fresh ? 'Receipt checks passed. Payment and current peaq state need separate verification.' :
      'Original receipt checks passed. This saved contact answer is expired.') : 'Evidence check failed. Inspect the original and request terms.',
      signature && terms ? 'warn' : 'error');
  }

  async function importText(raw, label) {
    if (raw.length > 65536) throw new Error('JSON file exceeds 64 KB');
    const value = JSON.parse(raw);
    normalizeSource(value);
    await render(value, label);
  }
  async function file(file) {
    if (!file) return;
    if (file.size > 65536) throw new Error('JSON file exceeds 64 KB');
    await importText(await file.text(), `Local file: ${file.name}`);
  }
  el('file').addEventListener('change', async event => {
    try { await file(event.target.files[0]); } catch (error) { status(error.message, 'error'); }
    event.target.value = '';
  });
  const drop = el('drop');
  for (const name of ['dragenter','dragover']) drop.addEventListener(name, event => { event.preventDefault(); drop.classList.add('drag'); });
  for (const name of ['dragleave','drop']) drop.addEventListener(name, event => { event.preventDefault(); drop.classList.remove('drag'); });
  drop.addEventListener('drop', async event => { try { await file(event.dataTransfer.files[0]); } catch (error) { status(error.message,'error'); } });
  el('historical').onclick = async () => {
    try {
      const response = await fetch(new URL('./evidence/device-signed-purchase.json', import.meta.url), { cache:'no-store' });
      if (!response.ok) throw new Error(`Recorded check unavailable (HTTP ${response.status})`);
      await importText(await response.text(), 'October 1, 2026 · recorded Devnet payment and ESP32 check');
    } catch (error) { status(error.message, 'error'); }
  };
  el('published').onclick = async () => {
    if (!publishedJob) return;
    try { await render(publishedJob, 'Reviewed exported job · recorded chain readbacks'); }
    catch (error) { status(error.message, 'error'); }
  };
  el('tamper').onclick = async () => {
    if (!original) return;
    const changed = structuredClone(original), source = normalizeSource(changed);
    source.receipt.result.closed = !source.receipt.result.closed;
    await render(changed, 'Locally altered contact state · no payment', false);
    el('restore').disabled = false;
    el('tamper').disabled = true;
  };
  el('restore').onclick = async () => { if (original) await render(original, 'Restored original file'); };
  el('verify-payment').onclick = async () => {
    if (!inspection || paymentVerified) return;
    const version = generation, selected = inspection;
    el('verify-payment').disabled = true; mark('payment-check','QUERYING','warn');
    try {
      const result = await querySettlement(paymentQueryInput(selected.source));
      // A slow query belongs to its original ticket. Import, tamper, or restore invalidates it.
      if (version !== generation || inspection !== selected) return;
      paymentVerified = true; mark('payment-check',`VERIFIED · SLOT ${result.slot}`,'ok');
      refreshDecision();
      status('The historical Devnet transfer matches the fixed mint, recipient, amount, and buyer debit.');
    } catch (error) {
      if (version !== generation || inspection !== selected) return;
      mark('payment-check','NOT VERIFIED','bad'); status(error.message,'error');
    }
    finally { if (version === generation) el('verify-payment').disabled = paymentVerified; }
  };

  function refreshDecision() {
    if (!inspection) return;
    const current = decisionAt(inspection, paymentVerified);
    mark('age-check', current.fresh ? `FRESH · ${Math.max(0, current.ageSeconds)}s` : 'EXPIRED / UNAVAILABLE', current.fresh ? 'ok' : 'warn');
    text('decision', current.decision);
    el('decision').className = 'result ' + (current.decision === 'DISPATCH' ? 'ok' : 'warn');
    text('decision-note', !inspection.signature ? 'The original receipt signature failed against the installed public pin.' :
      !inspection.terms ? 'The request, payment terms, receipt digest, or recorded identity does not match.' :
        !current.fresh ? 'The signed answer is too old for the ten-second buyer policy.' :
          !paymentVerified ? 'Signature and terms match. Verify the Devnet transfer separately before relying on this paid run.' :
            current.decision === 'DISPATCH' ? 'The transfer and fresh signed OPEN contact are verified. This demonstration decision does not prove safe equipment use.' :
              'The transfer and signed CLOSED contact are verified. The gate-access demonstration policy remains WAIT.');
  }
  if (typeof window !== 'undefined') {
    let refresh = null;
    const resumeExpiry = () => {
      if (refresh === null) refresh = window.setInterval(refreshDecision, 1000);
      refreshDecision();
    };
    resumeExpiry();
    window.addEventListener('pagehide', () => { window.clearInterval(refresh); refresh = null; });
    window.addEventListener('pageshow', resumeExpiry);
    document.addEventListener('visibilitychange', refreshDecision);
  }

  async function showOperation(id) {
    lastOperation = id;
    text('operation', `Operation ID: ${id}`);
    const deadline = Date.now() + 70000;
    while (Date.now() < deadline) {
      const response = await fetch(`/local-buyer/purchase/${encodeURIComponent(id)}`, { cache:'no-store' });
      if (!response.ok) throw new Error(`Operation status unavailable. Preserve ID ${id}.`);
      const state = await response.json();
      if (state.status === 'review') throw new Error(`Purchase requires review. Preserve ID ${id} and purchase ${state.purchase_id ?? 'pending'}. No automatic retry.`);
      if (state.status === 'done') {
        status(`Paid reading delivered. Looking for job ${state.purchase_id}.`, 'warn');
        let jobResponse;
        for (let i=0;i<10;i++) {
          jobResponse = await fetch(`/jobs/${encodeURIComponent(state.purchase_id)}`, { cache:'no-store' });
          if (jobResponse.ok) break;
          if (jobResponse.status !== 404) break;
          await new Promise(resolve => setTimeout(resolve,500));
        }
        if (jobResponse?.ok) await render(await jobResponse.json(), `Local paid job ${state.purchase_id}`);
        else { await render(state.run, `Local paid reading ${state.purchase_id} · job pending`);
          status(`Paid reading delivered. Job record is unavailable. Preserve purchase ID ${state.purchase_id}.`, 'warn'); }
        return;
      }
      status(`Purchase ${state.purchase_id ?? 'pending'}: ${state.events?.at(-1)?.phase ?? 'starting'}. No automatic retry.`, 'warn');
      await new Promise(resolve => setTimeout(resolve,350));
    }
    throw new Error(`Operation unresolved. Preserve ID ${id}. No automatic paid retry.`);
  }
  async function configureBuyer() {
    const response = await fetch('/local-buyer/config', { cache:'no-store' });
    if (response.status === 404) return;
    if (!response.ok) throw new Error('Local buyer configuration is unavailable');
    const config = await response.json();
    if (config.price_usdc !== '0.001' || config.payTo !== RECIPIENT || !/^[0-9a-f]{48}$/.test(config.token ?? '')) {
      throw new Error('Local buyer terms or session token differ from this workbench');
    }
    localConfig = config;
    el('buy').hidden = false;
    el('buy').disabled = config.blocked || config.busy || config.remaining <= 0;
    text('local-description', config.blocked ? 'An earlier purchase requires review. No new payment can start.' :
      `Configured loopback buyer: ${config.remaining} test purchase${config.remaining === 1 ? '' : 's'} remain. Each click can spend 0.001 Devnet USDC.`);
    const previous = config.active_operation_id ?? config.last_operation_id;
    if (previous) { lastOperation = previous; el('resume').hidden = false; text('operation',`Last operation ID: ${previous}`); }
  }
  async function configurePublishedJob() {
    const response = await fetch(new URL('./evidence/current-job.json', import.meta.url), { cache: 'no-store' });
    if (response.status === 404) return;
    if (!response.ok) throw new Error('Reviewed exported job is unavailable');
    const raw = await response.text();
    if (raw.length > 65536) throw new Error('Reviewed exported job exceeds 64 KB');
    const candidate = JSON.parse(raw);
    if (candidate.schema !== 'fieldproof-evidence-manifest-v1' || candidate.commercial_revenue !== false) {
      throw new Error('Reviewed exported job has an unsupported evidence profile');
    }
    normalizeSource(candidate);
    publishedJob = candidate;
    el('published').hidden = false;
  }
  el('buy').onclick = async () => {
    if (!localConfig || el('buy').disabled) return;
    el('buy').disabled = true;
    const operation_id = crypto.randomUUID(); lastOperation = operation_id;
    text('operation',`Operation ID: ${operation_id}`);
    try {
      const response = await fetch('/local-buyer/purchase', { method:'POST',
        headers:{'Content-Type':'application/json','X-FieldProof-Buyer-Token':localConfig.token},
        body:JSON.stringify({ operation_id }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Purchase start failed (HTTP ${response.status})`);
      await showOperation(operation_id);
    } catch (error) { status(error.message,'error'); }
    finally { try { await configureBuyer(); } catch {} }
  };
  el('resume').onclick = async () => { if (!lastOperation) return; try { await showOperation(lastOperation); } catch (error) { status(error.message,'error'); } };
  void (async () => {
    try { pin = await loadTrustedPin(); await configureBuyer(); }
    catch (error) { status(`Workbench configuration failed: ${error.message}`,'error'); el('historical').disabled=true; el('file').disabled=true; return; }
    // An optional published packet cannot take down independent file inspection.
    try { await configurePublishedJob(); }
    catch (error) { status(`${error.message}. Recorded and manual file inspection remain available.`, 'error'); }
  })();
}
