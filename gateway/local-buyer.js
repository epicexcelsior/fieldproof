// Optional loopback demo control. It never accepts a key, recipient, amount, or gateway from HTTP.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, readdirSync, readFileSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { publicBuyerRun } from '../docs/settlement.mjs';

const operationId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function writePrivate(path, value, exclusive = false) {
  const file = openSync(path, exclusive ? 'wx' : 'w', 0o600);
  try { writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); fsyncSync(file); }
  finally { closeSync(file); }
}

function replacePrivate(path, value) {
  const temporary = path + '.tmp';
  writePrivate(temporary, value, true);
  renameSync(temporary, path);
}

function processState(pid) {
  try { process.kill(pid, 0); return 'alive'; }
  catch (error) { return error.code === 'ESRCH' ? 'absent' : 'unknown'; }
}

// Readiness is advisory. The controller still acquires its exclusive lock before a signer can act.
export function inspectLocalBuyer({ directory, maximum = 10, ownerState = processState }) {
  if (!existsSync(directory)) return { operations: 0, remaining: maximum, blocked: false, locked: false };
  const files = readdirSync(directory).filter(name => operationId.test(name.slice(0, -5)) && name.endsWith('.json'));
  let blocked = false;
  for (const name of files) {
    try {
      const record = JSON.parse(readFileSync(join(directory, name), 'utf8'));
      if (record.operation_id !== name.slice(0, -5) || record.status !== 'done') blocked = true;
      else publicBuyerRun(record.result);
    } catch { blocked = true; }
  }
  const result = { operations: files.length, remaining: Math.max(0, maximum - files.length), blocked,
    locked: existsSync(join(directory, '.lock')), recovery_active: existsSync(join(directory, '.lock-recovery')) };
  if (result.locked) {
    try {
      const owner = JSON.parse(readFileSync(join(directory, '.lock'), 'utf8'));
      result.owner_state = Number.isSafeInteger(owner.pid) && owner.pid > 0 ? ownerState(owner.pid) : 'unknown';
    } catch { result.owner_state = 'unknown'; }
  }
  return result;
}

// Explicit host-terminal recovery only. Never clear pending records or reset the operation count.
export function recoverCompletedBuyerLock({ directory, maximum = 10, ownerState = processState }) {
  const mutex = join(directory, '.lock-recovery');
  writePrivate(mutex, { pid: process.pid, started_at: new Date().toISOString() }, true);
  try {
    const state = inspectLocalBuyer({ directory, maximum, ownerState });
    if (state.blocked) throw new Error('An earlier purchase needs review. The buyer lock remains unchanged.');
    if (!state.locked) return { recovered: false, remaining: state.remaining, spending: false };
    if (state.owner_state !== 'absent') throw new Error('The buyer owner is active or unknown. Stop its original process. The lock remains unchanged.');
    const archive = `.lock.recovered-${randomUUID()}.json`;
    renameSync(join(directory, '.lock'), join(directory, archive));
    return { recovered: true, archive, operations: state.operations, remaining: state.remaining, spending: false };
  } finally { unlinkSync(mutex); }
}

export function createLocalBuyer({ directory, payer, payTo, buy, maximum = 10, readPurchaseState }) {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 20) throw new Error('Use a maximum from 1 to 20 test purchases');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (existsSync(join(directory, '.lock-recovery'))) throw new Error('Buyer lock recovery is active. No new payment started.');
  const lock = join(directory, '.lock');
  writePrivate(lock, { pid: process.pid, started_at: new Date().toISOString() }, true);
  let active = null;
  const files = () => readdirSync(directory).filter(name => name.endsWith('.json') && operationId.test(name.slice(0, -5)));
  const read = id => {
    if (!operationId.test(id)) return null;
    const path = join(directory, id + '.json');
    if (!existsSync(path)) return null;
    try { return JSON.parse(readFileSync(path, 'utf8')); }
    catch { return { operation_id: id, status: 'review', error: 'Incomplete buyer record. Review before another purchase.' }; }
  };
  const needsReview = () => files().some(name => read(name.slice(0, -5))?.status !== 'done');
  const lastId = () => files().map(name => read(name.slice(0, -5))).filter(Boolean)
    .sort((a, b) => (b.started_ms ?? 0) - (a.started_ms ?? 0))[0]?.operation_id ?? null;
  const publicStatus = record => ({ operation_id: record.operation_id, status: record.status,
    elapsed_ms: record.elapsed_ms ?? 0, events: record.events ?? [], purchase_id: record.purchase_id ?? null,
    ...(record.status === 'done' ? { run: publicBuyerRun(record.result) } : {}),
    ...(record.status === 'review' ? { error: 'Purchase requires review. Preserve the purchase ID. No automatic paid retry.' } : {}) });
  return {
    config: () => ({ payer, payTo, price_usdc: '0.001', maximum, remaining: Math.max(0, maximum - files().length),
      busy: !!active, blocked: !active && needsReview(), active_operation_id: active?.operation_id ?? null,
      last_operation_id: lastId() }),
    status(id) {
      if (active?.operation_id === id) {
        if (active.purchase_id && ['measuring', 'delivered'].includes(readPurchaseState?.(active.purchase_id)) &&
            !active.events.some(event => event.phase === 'settled')) {
          active.events.push({ phase: 'settled', elapsed_ms: Date.now() - active.started_ms });
          replacePrivate(join(directory, id + '.json'), active);
        }
        return publicStatus({ ...active, elapsed_ms: Date.now() - active.started_ms });
      }
      const record = read(id);
      // A pending record without a live operation means its outcome needs manual review.
      return record ? publicStatus(record.status === 'done' ? record : { ...record, status: 'review' }) : null;
    },
    start(id) {
      if (!operationId.test(id)) return { code: 400, error: 'Use a new UUID operation ID.' };
      const previous = read(id);
      if (previous) return { code: 200, value: this.status(id) };
      if (active) return { code: 409, error: 'Another purchase is running. Wait for its result.' };
      if (needsReview()) return { code: 409, error: 'An earlier purchase requires review. No new payment started.' };
      if (files().length >= maximum) return { code: 429, error: 'The local test-purchase limit is reached.' };
      const path = join(directory, id + '.json');
      active = { operation_id: id, status: 'pending', started_ms: Date.now(), events: [], purchase_id: null };
      try { writePrivate(path, active, true); }
      catch (error) { active = null; throw error; }
      const operation = active;
      const progress = event => {
        operation.purchase_id = event.purchase_id ?? operation.purchase_id;
        operation.events.push({ phase: event.phase, elapsed_ms: Date.now() - operation.started_ms });
        replacePrivate(path, operation); // Preserve the purchase ID before the payment request leaves this process.
      };
      // The pending record and directory lock exist before the signer can act.
      void (async () => {
        let final;
        try {
          const result = await buy(progress);
          publicBuyerRun(result); // Validate the public contract before exposing or saving a successful run.
          final = { ...operation, status: 'done', result, elapsed_ms: Date.now() - operation.started_ms };
        } catch (error) {
          final = { ...operation, status: 'review', error: error.message, elapsed_ms: Date.now() - operation.started_ms };
        }
        try {
          replacePrivate(path, final);
        } catch {
          // Keep the original pending marker. It blocks another payment after restart.
          operation.status = 'review';
          console.error('Buyer record save failed. Preserve the local run directory and purchase ID.');
          return;
        }
        active = null;
      })();
      return { code: 202, value: this.status(id) };
    },
    completeReviewed(id, result) {
      // Local recovery only. The caller verifies immutable job evidence and the existing payment first.
      if (active) throw new Error('Stop the active purchase before completing review.');
      const record = read(id), run = publicBuyerRun(result);
      if (!record || record.operation_id !== id || record.purchase_id !== run.purchase_id ||
          run.settlement.payer !== payer || readPurchaseState?.(run.purchase_id) !== 'delivered') {
        throw new Error('Reviewed result does not match the preserved operation and delivered purchase.');
      }
      if (record.status === 'done') {
        if (JSON.stringify(publicBuyerRun(record.result)) !== JSON.stringify(run)) throw new Error('Completed operation binds another result.');
        return this.status(id);
      }
      if (!['pending', 'review'].includes(record.status)) throw new Error('Only an unresolved operation can complete review.');
      const final = { ...record, status: 'done', result: run, recovered_at: new Date().toISOString(),
        events: [...(record.events ?? []), { phase: 'review-completed', elapsed_ms: record.elapsed_ms ?? 0 }] };
      delete final.error;
      replacePrivate(join(directory, id + '.json'), final);
      return this.status(id);
    },
    close() {
      if (active) return false;
      unlinkSync(lock);
      return true;
    },
  };
}

export function mountLocalBuyer(app, controller, origin) {
  const url = new URL(origin), token = randomBytes(24).toString('hex');
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Local buyer requires a loopback origin');
  app.use('/local-buyer', (req, res, next) => {
    if (req.get('host') !== url.host || (req.get('origin') && req.get('origin') !== origin) ||
        (req.get('sec-fetch-site') && !['same-origin', 'none'].includes(req.get('sec-fetch-site')))) {
      return res.status(403).json({ error: 'Use the local demo page.' });
    }
    if (req.method === 'POST' && (req.get('origin') !== origin || req.get('x-fieldproof-buyer-token') !== token)) {
      return res.status(403).json({ error: 'Reload the local page before a purchase.' });
    }
    next();
  });
  app.get('/local-buyer/config', (_req, res) => res.json({ ...controller.config(), token }));
  app.post('/local-buyer/purchase', (req, res) => {
    if (!req.body || Object.keys(req.body).length !== 1 || typeof req.body.operation_id !== 'string') {
      return res.status(400).json({ error: 'Send only an operation ID. Payment terms come from local configuration.' });
    }
    try {
      const result = controller.start(req.body.operation_id);
      res.status(result.code).json(result.value ?? { error: result.error });
    } catch { res.status(503).json({ error: 'Local buyer storage is unavailable. No automatic retry. Inspect the local log.' }); }
  });
  app.get('/local-buyer/purchase/:id', (req, res) => {
    try {
      const value = controller.status(req.params.id);
      res.status(value ? 200 : 404).json(value ?? { error: 'Unknown local buyer operation.' });
    } catch { res.status(503).json({ error: 'Local buyer record requires review.' }); }
  });
}
