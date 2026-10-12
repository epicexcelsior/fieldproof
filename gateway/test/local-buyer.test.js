import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';
import express from 'express';
import { createLocalBuyer, inspectLocalBuyer, mountLocalBuyer, DEFAULT_BUYER_MAXIMUM } from '../local-buyer.js';
import { PAY_TO } from '../server.js';

const run = JSON.parse(readFileSync(new URL('../../docs/evidence/device-signed-purchase.json', import.meta.url), 'utf8')).purchase;
const payer = run.settlement.payer;
function fixture(t, buy, maximum = 10, readPurchaseState) {
  const directory = mkdtempSync(join(tmpdir(), 'fieldproof-buyer-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const options = { directory, payer, payTo: PAY_TO, buy, maximum, readPurchaseState };
  return { directory, options, controller: createLocalBuyer(options) };
}
async function finish(controller, id) {
  for (let i = 0; i < 100; i++) {
    const value = controller.status(id);
    if (value.status !== 'pending') return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('The operation did not finish');
}

test('the event log marks settlement only after the purchase ledger records it', async t => {
  let state = 'quoted', release;
  const gate = new Promise(resolve => { release = resolve; });
  const { controller } = fixture(t, async progress => {
    progress({ phase: 'request', purchase_id: run.purchase_id });
    await gate;
    return run;
  }, 10, id => { assert.equal(id, run.purchase_id); return state; });
  const id = randomUUID();
  controller.start(id);
  assert.equal(controller.status(id).events.some(e => e.phase === 'settled'), false);
  state = 'measuring';
  assert.equal(controller.status(id).events.filter(e => e.phase === 'settled').length, 1);
  assert.equal(controller.status(id).events.filter(e => e.phase === 'settled').length, 1);
  release();
  assert.equal((await finish(controller, id)).status, 'done');
  controller.close();
});

test('one explicit operation spends once, rejects overlap, and stays idempotent after restart', async t => {
  let calls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const { directory, options, controller } = fixture(t, async progress => {
    calls++;
    progress({ phase: 'request', purchase_id: run.purchase_id });
    await gate;
    return { ...run, private_key: 'never-expose-this', internal_path: '/private/test' };
  });
  assert.equal(calls, 0);
  const id = randomUUID();
  assert.equal(controller.start(id).code, 202);
  assert.equal(controller.start(id).code, 200);
  assert.equal(controller.start(randomUUID()).code, 409);
  assert.equal(calls, 1);
  const pending = JSON.parse(readFileSync(join(directory, id + '.json')));
  assert.equal(pending.purchase_id, run.purchase_id);
  assert.equal(statSync(join(directory, id + '.json')).mode & 0o777, 0o600);
  assert.throws(() => createLocalBuyer(options), /EEXIST/);
  release();
  const status = await finish(controller, id);
  assert.equal(status.status, 'done');
  assert.equal(status.run.receipt.receipt_signature, run.receipt.receipt_signature);
  assert.equal(JSON.stringify(status).includes('never-expose-this'), false);
  assert.equal(JSON.stringify(status).includes('/private/test'), false);
  assert.equal(controller.config().remaining, 9);
  assert.equal(controller.close(), true);
  const restarted = createLocalBuyer(options);
  assert.equal(restarted.start(id).code, 200);
  assert.equal(restarted.config().remaining, 9);
  assert.equal(calls, 1);
  restarted.close();
});

test('a payment failure preserves the purchase ID and blocks another payment, including after restart', async t => {
  let calls = 0;
  const { options, controller } = fixture(t, async progress => {
    calls++;
    progress({ phase: 'paying', purchase_id: run.purchase_id });
    throw new Error('private failure /home/private-key.json');
  });
  const id = randomUUID();
  controller.start(id);
  const result = await finish(controller, id);
  assert.equal(result.status, 'review');
  assert.equal(result.purchase_id, run.purchase_id);
  assert.equal(JSON.stringify(result).includes('/home/private-key'), false);
  assert.equal(controller.start(randomUUID()).code, 409);
  assert.equal(controller.config().blocked, true);
  controller.close();
  const restarted = createLocalBuyer(options);
  assert.equal(restarted.start(randomUUID()).code, 409);
  assert.equal(restarted.status(id).status, 'review');
  assert.equal(calls, 1);
  restarted.close();
});

test('delivery failure explains the gateway state while retaining the payment-review block', async t => {
  const { controller, directory } = fixture(t, async progress => {
    progress({ phase: 'request', purchase_id: run.purchase_id });
    throw new Error('private bridge failure /home/private-key.json');
  }, 10, () => 'delivery_failed');
  const id = randomUUID();
  controller.start(id);
  const result = await finish(controller, id);
  assert.equal(result.status, 'review');
  assert.match(result.error, /settled payment.*device answer was not delivered/);
  assert.doesNotMatch(result.error, /private-key|private bridge/);
  assert.equal(controller.start(randomUUID()).code, 409);
  assert.equal(controller.config().remaining, 9);
  assert.equal(JSON.parse(readFileSync(join(directory, id + '.json'))).status, 'review');
  controller.close();
});

test('incomplete and corrupt records fail closed without calling the buyer', t => {
  const { directory, controller } = fixture(t, () => assert.fail('No purchase is allowed'));
  const id = randomUUID();
  writeFileSync(join(directory, id + '.json'), JSON.stringify({ operation_id: id, status: 'pending', purchase_id: run.purchase_id }));
  assert.equal(controller.status(id).status, 'review');
  assert.equal(controller.start(randomUUID()).code, 409);
  writeFileSync(join(directory, id + '.json'), '{');
  assert.equal(controller.status(id).status, 'review');
  assert.equal(controller.start(randomUUID()).code, 409);
  assert.equal(controller.start('../key.json').code, 400);
  controller.close();
});

test('the configured purchase limit survives completed operations', async t => {
  let calls = 0;
  const { controller } = fixture(t, async () => { calls++; return run; }, 1);
  const id = randomUUID();
  controller.start(id);
  assert.equal((await finish(controller, id)).status, 'done');
  assert.equal(controller.config().remaining, 0);
  assert.equal(controller.start(randomUUID()).code, 429);
  assert.equal(controller.start(id).code, 200);
  assert.equal(calls, 1);
  controller.close();
});

test('the expanded shared budget preserves eight existing journals and permits useful checks beyond ten', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'fieldproof-expanded-buyer-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const original = new Map();
  for (let i = 0; i < 8; i++) {
    const id = randomUUID(), contents = JSON.stringify({ operation_id: id, status: 'done', result: run });
    writeFileSync(join(directory, id + '.json'), contents, { mode: 0o600 });
    original.set(id, contents);
  }
  let purchases = 0;
  const options = { directory, payer, payTo: PAY_TO, buy: async () => { purchases++; return run; } };
  const controller = createLocalBuyer(options);
  assert.equal(DEFAULT_BUYER_MAXIMUM, 100);
  assert.equal(inspectLocalBuyer({ directory }).remaining, 92);
  assert.equal(controller.config().maximum, 100);
  assert.equal(controller.config().maximum_payment_base_units, '100000');
  assert.equal(controller.config().maximum_test_usdc, '0.100');
  assert.equal(controller.config().remaining, 92);
  for (let i = 0; i < 3; i++) {
    const id = randomUUID();
    assert.equal(controller.start(id).code, 202);
    assert.equal((await finish(controller, id)).status, 'done');
  }
  assert.equal(purchases, 3);
  assert.equal(controller.config().remaining, 89);
  controller.close();
  const restarted = createLocalBuyer(options);
  try {
    assert.equal(restarted.config().remaining, 89);
    assert.equal(inspectLocalBuyer({ directory }).operations, 11);
    for (const [id, contents] of original) assert.equal(readFileSync(join(directory, id + '.json'), 'utf8'), contents);
  } finally { restarted.close(); }
});

test('the shared default blocks operation 101 and retains completed operation reuse after restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'fieldproof-exhausted-buyer-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (let i = 0; i < 99; i++) {
    const id = randomUUID();
    writeFileSync(join(directory, id + '.json'), JSON.stringify({ operation_id: id, status: 'done', result: run }));
  }
  let purchases = 0;
  const options = { directory, payer, payTo: PAY_TO, buy: async () => { purchases++; return run; } };
  const controller = createLocalBuyer(options), finalOperation = randomUUID();
  assert.equal(controller.config().remaining, 1);
  assert.equal(controller.start(finalOperation).code, 202);
  assert.equal((await finish(controller, finalOperation)).status, 'done');
  assert.equal(controller.start(randomUUID()).code, 429);
  controller.close();
  const restarted = createLocalBuyer(options);
  try {
    assert.equal(restarted.config().remaining, 0);
    assert.equal(restarted.start(randomUUID()).code, 429);
    assert.equal(restarted.start(finalOperation).code, 200);
    assert.equal(purchases, 1);
  } finally { restarted.close(); }
});

test('a trusted caller cannot configure a cap above the authorized shared maximum', t => {
  const directory = mkdtempSync(join(tmpdir(), 'fieldproof-budget-bound-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const maximum of [0, 101, 1.5, NaN]) {
    assert.throws(() => createLocalBuyer({ directory, payer, payTo: PAY_TO, maximum,
      buy: () => assert.fail('No payment is allowed') }), /1 to 100/);
  }
});

test('local HTTP control requires the exact origin and token and accepts no payment overrides', async t => {
  let calls = 0;
  const { controller } = fixture(t, async () => { calls++; return run; });
  const app = express();
  app.use(express.json({ limit: '2kb' }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  mountLocalBuyer(app, controller, origin);
  const configResponse = await fetch(origin + '/local-buyer/config');
  const config = await configResponse.json();
  assert.equal(configResponse.status, 200);
  assert.equal(calls, 0);
  const send = (headers, body = { operation_id: randomUUID() }) => fetch(origin + '/local-buyer/purchase', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const validHeaders = { Origin: origin, 'X-FieldProof-Buyer-Token': config.token };
  assert.equal((await send({})).status, 403);
  assert.equal((await send({ ...validHeaders, Origin: 'https://example.com' })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const req = request(origin + '/local-buyer/config', { headers: { Host: 'attacker.example' } }, res => {
      res.resume(); resolve(res.statusCode);
    });
    req.on('error', reject); req.end();
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await send({ ...validHeaders, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  for (const field of ['amount', 'recipient', 'key', 'gateway', 'output', 'maximum', 'maximum_operations']) {
    assert.equal((await send(validHeaders, { operation_id: randomUUID(), [field]: 'override' })).status, 400);
  }
  assert.equal((await send(validHeaders, { operation_id: '../private.json' })).status, 400);
  assert.equal(calls, 0);
  const id = randomUUID();
  assert.equal((await send(validHeaders, { operation_id: id })).status, 202);
  assert.equal((await finish(controller, id)).status, 'done');
  assert.equal((await send(validHeaders, { operation_id: id })).status, 200);
  const output = await (await fetch(origin + '/local-buyer/purchase/' + id)).json();
  assert.equal(output.run.settlement.transaction, run.settlement.transaction);
  assert.equal(calls, 1);
  controller.close();
});
