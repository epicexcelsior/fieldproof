import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as tick } from 'node:timers/promises';
import express from 'express';
import { createLocalBuyer, mountLocalBuyer } from '../local-buyer.js';
import { memoryFetch } from './fixtures/memory-http.js';
import { jobFixture } from './fixtures/job.js';

const origin = 'http://127.0.0.1:4026';

async function buyer(t, buy) {
  const directory = mkdtempSync(join(tmpdir(), 'fieldproof-http-boundary-'));
  const fixture = jobFixture();
  let calls = 0;
  const controller = createLocalBuyer({ directory, maximum: 1, payer: fixture.run.settlement.payer,
    payTo: fixture.policy.pay_to, buy: async () => { calls++; return buy ? buy() : fixture.run; } });
  t.after(() => { assert.equal(controller.close(), true); rmSync(directory, { recursive: true, force: true }); });
  const app = express(); app.use(express.json({ limit: '8kb' }));
  mountLocalBuyer(app, controller, origin);
  const fetch = memoryFetch(app, origin);
  const config = await (await fetch(origin + '/local-buyer/config')).json();
  return { fetch, config, fixture, controller, calls: () => calls,
    post: (body, headers = {}) => fetch(origin + '/local-buyer/purchase', { method: 'POST',
      headers: { 'content-type': 'application/json', origin, 'x-fieldproof-buyer-token': config.token, ...headers },
      body: JSON.stringify(body) }) };
}

test('the local signer configuration rejects foreign hosts, origins, and cross-site browser requests', async t => {
  const local = await buyer(t);
  for (const headers of [{ host: 'attacker.example' }, { origin: 'https://attacker.example' },
    { 'sec-fetch-site': 'cross-site' }]) {
    const response = await local.fetch(origin + '/local-buyer/config', { headers });
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(Object.hasOwn(body, 'token'), false);
  }
  assert.equal(local.calls(), 0);
});

test('purchase POST requires both the local origin and its session token before invoking the buyer', async t => {
  const local = await buyer(t), operation_id = randomUUID();
  for (const headers of [{ origin: '' }, { 'x-fieldproof-buyer-token': '' },
    { 'x-fieldproof-buyer-token': 'incorrect' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await local.post({ operation_id }, headers)).status, 403);
  }
  assert.equal(local.calls(), 0);
  assert.equal(local.controller.config().remaining, 1);
});

test('HTTP cannot select a key, amount, recipient, origin, or invalid operation ID', async t => {
  const local = await buyer(t), operation_id = randomUUID();
  for (const field of ['keypair', 'amount', 'recipient', 'origin']) {
    const response = await local.post({ operation_id, [field]: 'PRIVATE_INPUT_MARKER' });
    assert.equal(response.status, 400);
    assert.equal((await response.text()).includes('PRIVATE_INPUT_MARKER'), false);
  }
  assert.equal((await local.post({ operation_id: '../../PRIVATE_INPUT_MARKER' })).status, 400);
  assert.equal(local.calls(), 0);
  assert.equal(local.controller.config().remaining, 1);
});

test('one operation remains idempotent through HTTP and the test budget cannot be exceeded', async t => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const local = await buyer(t, () => pending), operation_id = randomUUID();
  try {
    assert.equal((await local.post({ operation_id })).status, 202);
    assert.equal((await local.post({ operation_id })).status, 200);
    assert.equal((await local.post({ operation_id: randomUUID() })).status, 409);
    assert.equal(local.calls(), 1);
  } finally {
    finish(local.fixture.run);
    for (let attempt = 0; attempt < 20 && local.controller.config().busy; attempt++) await tick();
  }
  const status = await (await local.fetch(origin + '/local-buyer/purchase/' + operation_id)).json();
  assert.equal(status.status, 'done');
  assert.equal((await local.post({ operation_id })).status, 200);
  assert.equal((await local.post({ operation_id: randomUUID() })).status, 429);
  assert.equal(local.calls(), 1);
  assert.equal(local.controller.config().remaining, 0);
});
