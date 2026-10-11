import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BuyerSetupError, checkBuyerReadiness, checkDevnetFunds, checkPhysicalContact, runPaidChecks } from '../paid-checks.js';
import { contactToolPreview } from '../agent-contact.js';
import { loadBuyerSigner } from '../buyer.js';
import { inspectLocalBuyer, describeBuyerProcess, recoverCompletedBuyerLock, createLocalBuyer } from '../local-buyer.js';
import { USDC, PAY_TO } from '../constants.js';
import { TOKEN_PROGRAM_ADDRESS } from '@x402/svm';
import { randomUUID } from 'node:crypto';

test('buyer diagnosis identifies an active browser buyer without exposing its command arguments', async t => {
  const options = await config(t), directory = options.directory;
  await mkdir(directory);
  await writeFile(join(directory, '.lock'), JSON.stringify({ pid: process.pid, started_at: '2026-10-05T21:05:52.880Z' }));
  const state = inspectLocalBuyer({ directory, ownerDetails: () => ({ role: 'browser_buyer', command: 'MainThread' }) });
  assert.equal(state.owner.pid, process.pid);
  assert.equal(state.owner.started_at, '2026-10-05T21:05:52.880Z');
  assert.equal(state.owner.role, 'browser_buyer');
  assert.equal(state.owner_state, 'alive');
  assert.equal(state.remaining, 10);
});

test('buyer diagnosis gives the active-owner next step without a device request, payment, or lock change', async () => {
  const result = await checkBuyerReadiness({ keyPath: 'private-local-wallet',
    loadSigner: async path => { assert.equal(path, 'private-local-wallet'); return { address: 'fixture-public-payer' }; },
    inspect: ({ directory }) => {
      assert.ok(directory.endsWith('/.local/live-buyer/fixture-public-payer'));
      return { operations: 7, remaining: 3, blocked: false, locked: true, owner_state: 'alive',
        owner: { pid: 1824662, role: 'browser_buyer' } };
    } });
  assert.equal(result.spending, false);
  assert.equal(result.device_request, false);
  assert.equal(result.network_request, false);
  assert.equal(result.schema, 'fieldproof-buyer-readiness-v1');
  assert.equal(typeof result.payer, 'string');
  assert.equal(Array.isArray(result.next_steps), true);
  assert.match(result.next_steps.join(' '), /original terminal/);
  assert.equal(JSON.stringify(result).includes('private-local-wallet'), false);
});

test('buyer process diagnosis returns an allowlisted role and never prints private command arguments', () => {
  const sentinel = 'PRIVATE-KEY-PATH-SENTINEL';
  const files = { '/proc/123/comm': 'MainThread\n',
    '/proc/123/cmdline': `node\0/home/example/gateway/live-demo.js\0${sentinel}\0` };
  const details = describeBuyerProcess(123, path => files[path]);
  assert.deepEqual(details, { role: 'browser_buyer', command: 'MainThread' });
  assert.equal(JSON.stringify(details).includes(sentinel), false);
  assert.deepEqual(describeBuyerProcess(123, () => { throw new Error(sentinel); }), { role: 'unverified' });
});

// Controlled collaborators test sequencing and recovery. These are not new device captures or chain transactions.
const physical = () => ({ schema: 'fieldproof-physical-preflight-v1', payment: 'none',
  transport: 'real-ble', receipt_identity: 'pinned-device-p256', closed: false });
function paidResult(operation, index = 1) {
  return { schema: 'fieldproof-agent-contact-v1', operation_id: operation, status: 'done',
    peaq: 'not_used', commercial_revenue: false, purchase_duration_ms: 500,
    current_evidence: 'fresh_and_authenticated', current_decision: 'DISPATCH',
    payment_verification: { state: 'verified', transaction: `fixture-transfer-${index}`, merchant_delta_base_units: '1000' },
    purchase: { purchase_id: `fixture-purchase-${index}`, settlement: { transaction: `fixture-transfer-${index}` },
      receipt: { request_id: `fixture-purchase-${index}`, completed_at: 12345 + index, result: { closed: false } } } };
}
async function config(t, extra = {}) {
  const parent = await mkdtemp(join(tmpdir(), 'fieldproof-paid-checks-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  return { directory: join(parent, 'run'), preflight: async () => physical(), ...extra };
}
const json = async (directory, file) => JSON.parse(await readFile(join(directory, file), 'utf8'));

test('unreadable wallet is a setup failure with zero purchase attempts and an actionable error', async t => {
  let attempts = 0;
  const options = await config(t, { prepare: () => loadBuyerSigner(join(tmpdir(), 'fieldproof-key-file-does-not-exist')),
    purchase: async operation => paidResult(operation, ++attempts) });
  await assert.rejects(runPaidChecks(options), /Buyer keypair file cannot be read/);
  const result = await json(options.directory, 'result.json');
  assert.equal(attempts, 0); assert.equal(result.attempted, 0); assert.equal(result.completed, 0);
  assert.equal(result.reason, 'buyer_setup_failed');
  assert.equal(Object.hasOwn(result, 'review_operation_id'), false);
  await assert.rejects(readFile(join(options.directory, 'check-1.json')), { code: 'ENOENT' });
});

test('funding setup failure reports its cause before purchase and keeps private unknown errors out', async t => {
  for (const error of [new BuyerSetupError('devnet_funds', 'Insufficient Devnet test USDC.'),
    new Error('PRIVATE-WALLET-SENTINEL')]) {
    let attempts = 0;
    const options = await config(t, { prepare: async () => { throw error; },
      purchase: async operation => paidResult(operation, ++attempts) });
    await assert.rejects(runPaidChecks(options), /No payment started/);
    const result = await json(options.directory, 'result.json');
    assert.equal(attempts, 0); assert.equal(result.attempted, 0);
    assert.equal(result.reason, 'buyer_setup_failed');
    assert.equal(JSON.stringify(result).includes('PRIVATE-WALLET-SENTINEL'), false);
    assert.equal(Object.hasOwn(result, 'review_operation_id'), false);
  }
});

test('Devnet funding check matches the x402 associated token account and excludes other owned balances', async () => {
  const payer = '2U7Bz5u4bVMsUtNcF4b4xdWG7K3N7WmbsGCqMQmjevMf';
  // Expected source ATA from the installed x402 2.27.0 client's findAssociatedTokenPda helper.
  const ata = 'B55G2a3NKe9s2R9avLfW9EKqhLELjyQvFY5DQggBPejm';
  const item = (pubkey, amount = '3000') => ({ pubkey, account: { owner: TOKEN_PROGRAM_ADDRESS,
    data: { program: 'spl-token', parsed: { type: 'account', info: { owner: payer, mint: USDC, state: 'initialized',
      tokenAmount: { decimals: 6, amount } } } } } });
  let accounts = [item(ata), item('another-owned-account', '999999')];
  const rpc = { getTokenAccountsByOwner: (owner, filter, config) => {
    assert.equal(owner, payer); assert.deepEqual(filter, { mint: USDC });
    assert.deepEqual(config, { encoding: 'jsonParsed', commitment: 'confirmed' });
    return { send: async options => { assert.ok(options.abortSignal); return { value: accounts }; } };
  } };
  const ready = await checkDevnetFunds(payer, 3, rpc);
  assert.equal(ready.spending, false); assert.equal(ready.available_base_units, '3000');
  assert.equal(ready.token_account, ata); assert.equal(ready.network, 'Solana Devnet');
  for (const defect of ['absent', 'insufficient', 'frozen', 'duplicate', 'merchant']) {
    accounts = [item(ata)];
    if (defect === 'absent') accounts = [item('another-owned-account', '999999')];
    if (defect === 'insufficient') accounts[0].account.data.parsed.info.tokenAmount.amount = '2999';
    if (defect === 'frozen') accounts[0].account.data.parsed.info.state = 'frozen';
    if (defect === 'duplicate') accounts.push(item(ata));
    if (defect === 'merchant') accounts[0].account.data.parsed.info.owner = PAY_TO;
    await assert.rejects(checkDevnetFunds(payer, 3, rpc), BuyerSetupError);
  }
  await assert.rejects(checkDevnetFunds(payer, 3, { getTokenAccountsByOwner: () => ({
    send: async () => { throw new Error('PRIVATE-RPC-SENTINEL'); } }) }), error => {
    assert.equal(error.stage, 'devnet_funds'); assert.equal(error.message.includes('PRIVATE-RPC'), false); return true;
  });
});

test('explicit stale-lock recovery archives the old lock and preserves every completed operation and its budget', async t => {
  const options = await config(t), directory = options.directory;
  await mkdir(directory);
  const { purchase } = JSON.parse(await readFile(new URL('../../docs/evidence/device-signed-purchase.json', import.meta.url), 'utf8'));
  const operation = randomUUID(), contents = JSON.stringify({ operation_id: operation, status: 'done', result: purchase });
  await writeFile(join(directory, operation + '.json'), contents, { mode: 0o600 });
  const lock = JSON.stringify({ pid: 12345, started_at: '2026-10-05T00:00:00Z' });
  await writeFile(join(directory, '.lock'), lock, { mode: 0o600 });
  const result = recoverCompletedBuyerLock({ directory, ownerState: () => 'absent' });
  assert.equal(result.spending, false); assert.equal(result.remaining, 9); assert.equal(result.operations, 1);
  assert.equal(await readFile(join(directory, result.archive), 'utf8'), lock);
  assert.equal(await readFile(join(directory, operation + '.json'), 'utf8'), contents);
  await assert.rejects(readFile(join(directory, '.lock')), { code: 'ENOENT' });
  assert.equal(inspectLocalBuyer({ directory }).remaining, 9);
  const controller = createLocalBuyer({ directory, payer: purchase.settlement.payer, payTo: PAY_TO, maximum: 1,
    buy: () => assert.fail('No purchase after exhausted limit') });
  try { assert.equal(controller.start(randomUUID()).code, 429); }
  finally { controller.close(); }
});

test('active or unknown lock owner and unresolved records block recovery without changing the lock', async t => {
  const options = await config(t), directory = options.directory;
  await mkdir(directory);
  const lock = JSON.stringify({ pid: 12345, started_at: '2026-10-05T00:00:00Z' });
  await writeFile(join(directory, '.lock'), lock, { mode: 0o600 });
  for (const owner_state of ['alive', 'unknown']) {
    assert.throws(() => recoverCompletedBuyerLock({ directory, ownerState: () => owner_state }), /active or unknown/);
    assert.equal(await readFile(join(directory, '.lock'), 'utf8'), lock);
  }
  const operation = randomUUID();
  await writeFile(join(directory, operation + '.json'), JSON.stringify({ operation_id: operation, status: 'pending' }));
  assert.throws(() => recoverCompletedBuyerLock({ directory, ownerState: () => 'absent' }), /needs review/);
  assert.equal(await readFile(join(directory, '.lock'), 'utf8'), lock);
  await rm(join(directory, operation + '.json'));
  await writeFile(join(directory, operation + '.json'), 'incomplete JSON');
  assert.throws(() => recoverCompletedBuyerLock({ directory, ownerState: () => 'absent' }), /needs review/);
  assert.equal(await readFile(join(directory, '.lock'), 'utf8'), lock);
  await rm(join(directory, operation + '.json'));
  await writeFile(join(directory, '.lock-recovery'), '{}');
  assert.throws(() => recoverCompletedBuyerLock({ directory, ownerState: () => 'absent' }), { code: 'EEXIST' });
  assert.throws(() => createLocalBuyer({ directory, payer: 'unused', payTo: PAY_TO, buy: () => {} }), /recovery is active/);
  assert.equal(await readFile(join(directory, '.lock'), 'utf8'), lock);
});

test('three unchanged OPEN readings use distinct operations and preserve the explicit test-token cap', async t => {
  let attempts = 0;
  const events = [], options = await config(t, { purchase: async operation => paidResult(operation, ++attempts), report: event => events.push(event) });
  const result = await runPaidChecks(options), plan = await json(options.directory, 'plan.json');
  assert.equal(result.status, 'completed'); assert.equal(attempts, 3); assert.equal(result.completed, 3);
  assert.equal(result.total_verified_base_units, '3000'); assert.equal(result.observed_input_change, false);
  assert.deepEqual(result.contact_states, ['OPEN', 'OPEN', 'OPEN']);
  assert.equal(result.commercial_revenue, false); assert.equal(result.peaq, 'not_used');
  assert.equal(plan.automatic_paid_retry, false); assert.equal(plan.physical_input_change_required, false);
  assert.equal(new Set(plan.operations.map(item => item.operation_id)).size, 3);
  for (const { operation_id, output } of plan.operations) {
    assert.match(operation_id, /^[0-9a-f-]{36}$/);
    assert.equal((await json(options.directory, output)).operation_id, operation_id);
    assert.equal((await stat(join(options.directory, output))).mode & 0o777, 0o600);
  }
  assert.equal((await stat(options.directory)).mode & 0o777, 0o700);
  assert.deepEqual(await json(options.directory, 'result.json'), result);
  assert.deepEqual(events.map(item => item.phase), ['plan_saved', 'physical_preflight_verified',
    'paid_check_verified', 'paid_check_verified', 'paid_check_verified']);
});

test('failed or simulated preflight saves recovery information and starts no purchase', async t => {
  for (const preflight of [async () => { throw new Error('private Bluetooth detail'); },
    async () => ({ ...physical(), transport: 'simulated' })]) {
    let attempts = 0;
    const options = await config(t, { preflight, purchase: async () => { attempts++; } });
    await assert.rejects(runPaidChecks(options), /No payment started/);
    const result = await json(options.directory, 'result.json');
    assert.equal(result.attempted, 0); assert.equal(result.completed, 0); assert.equal(attempts, 0);
    assert.equal(JSON.stringify(result).includes('private Bluetooth detail'), false);
    assert.equal((await json(options.directory, 'plan.json')).operations.length, 3);
  }
});

test('unknown second payment stops the third and preserves both operation IDs and the first result', async t => {
  let attempts = 0;
  const options = await config(t, { purchase: async operation => {
    if (++attempts === 2) throw new Error('Keep the original purchase for review');
    return paidResult(operation, attempts);
  } });
  await assert.rejects(runPaidChecks(options), /No next payment starts/);
  const result = await json(options.directory, 'result.json'), plan = await json(options.directory, 'plan.json');
  assert.equal(attempts, 2); assert.equal(result.completed, 1); assert.equal(result.attempted, 2);
  assert.equal(result.total_verified_base_units, '1000');
  assert.equal(result.review_operation_id, plan.operations[1].operation_id);
  assert.equal((await json(options.directory, 'check-1.json')).status, 'done');
  assert.equal((await json(options.directory, 'check-2.json')).status, 'failed');
  await assert.rejects(readFile(join(options.directory, 'check-3.json')), { code: 'ENOENT' });
});

test('unavailable RPC, mismatched transfer, and duplicate payment stop the next check without inflating the count', async t => {
  for (const defect of ['rpc', 'binding', 'duplicate', 'price']) {
    let attempts = 0;
    const options = await config(t, { purchase: async operation => {
      const result = paidResult(operation, ++attempts);
      if (attempts === 2) {
        if (defect === 'rpc') result.payment_verification.state = 'unavailable';
        if (defect === 'binding') result.payment_verification.transaction = 'different-transfer';
        if (defect === 'duplicate') {
          result.purchase.settlement.transaction = result.payment_verification.transaction = 'fixture-transfer-1';
        }
        if (defect === 'price') result.payment_verification.merchant_delta_base_units = '2000';
      }
      return result;
    } });
    await assert.rejects(runPaidChecks(options), /No next payment starts/);
    const result = await json(options.directory, 'result.json');
    assert.equal(attempts, 2); assert.equal(result.completed, 1);
    assert.equal(result.transactions.length, 1);
    assert.equal((await json(options.directory, 'check-2.json')).status, 'done');
  }
});

test('existing run directory and invalid batch sizes block before device or wallet work', async t => {
  let calls = 0;
  const options = await config(t, { count: 1, preflight: async () => { calls++; return physical(); }, purchase: async id => paidResult(id) });
  await runPaidChecks(options);
  const original = await readFile(join(options.directory, 'result.json'));
  await assert.rejects(runPaidChecks(options), { code: 'EEXIST' });
  assert.equal(calls, 1); assert.deepEqual(await readFile(join(options.directory, 'result.json')), original);
  for (const count of [0, 4, 1.5, NaN]) await assert.rejects(runPaidChecks({ ...options, count }), /one to three/);
  assert.equal(calls, 1);
});

test('real preflight issues a fresh challenge and rejects an old recorded signed answer', async () => {
  const { purchase } = JSON.parse(await readFile(new URL('../../docs/evidence/device-signed-purchase.json', import.meta.url), 'utf8'));
  let request;
  await assert.rejects(checkPhysicalContact({ now: () => purchase.receipt.completed_at,
    observe: async input => { request = input; return { receipt: purchase.receipt }; } }), /challenge/);
  assert.equal(request.simulated, false); assert.equal(request.max_age_seconds, 10);
  assert.deepEqual(request.contact, contactToolPreview().contact);
  assert.equal(request.receipt_public_key, contactToolPreview().receipt_public_key);
  assert.notEqual(request.id, purchase.purchase_id);
});
