import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkPhysicalContact, runPaidChecks } from '../paid-checks.js';
import { contactToolPreview } from '../agent-contact.js';

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
