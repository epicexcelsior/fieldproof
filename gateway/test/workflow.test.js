import test from 'node:test';
import assert from 'node:assert/strict';
import { sign, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as tick } from 'node:timers/promises';
import { generateKeyPairSigner, getTransactionDecoder, getBase64Encoder, getAddressEncoder, getBase58Decoder } from '@solana/kit';
import { createPaymentServer, createGateway } from '../server.js';
import { PurchaseStore } from '../store.js';
import { EventStore } from '../event-store.js';
import { performPaidJob } from '../paid-job.js';
import { createLocalBuyer } from '../local-buyer.js';
import { submitSavedEvent, inspectSavedEvent, savedEvidenceManifest } from '../peaq-event.js';
import { jobFixture } from './fixtures/job.js';
import { memoryFetch } from './fixtures/memory-http.js';
import { receiptMessage, inspectSource, decisionAt } from '../../docs/jobs.mjs';
import { PAY_TO, NETWORK } from '../constants.js';
import { DEVNET_RPC } from '../../docs/settlement.mjs';

test('connected rehearsal: identity, actual x402 signing, contact evidence, payment query, restart, and activity readback', async t => {
  // All network and physical observations below are controlled fixtures. No funds or chain writes occur.
  const now = Math.floor(Date.now() / 1000), f = jobFixture(now);
  const directory = mkdtempSync(join(tmpdir(), 'fieldproof-workflow-'));
  const database = join(directory, 'purchases.sqlite'), policyPath = join(directory, 'public-policy.json');
  writeFileSync(policyPath, JSON.stringify(f.policy));
  let purchases = new PurchaseStore(database), events = new EventStore(purchases), controller;
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; controller?.close(); purchases.close(); rmSync(directory, { recursive: true, force: true }); });
  const signer = await generateKeyPairSigner();
  const transaction = getBase58Decoder().decode(new Uint8Array(64).fill(7));
  const origin = 'http://127.0.0.1:4026';
  let settlements = 0, observations = 0, paymentPayload;
  const facilitator = {
    getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: 'exact', network: NETWORK,
      extra: { feePayer: PAY_TO, recentBlockhash: '11111111111111111111111111111111', lastValidBlockHeight: '100' } }], extensions: [], signers: {} }),
    verify: async payload => { paymentPayload = payload; return { isValid: true, payer: signer.address }; },
    settle: async () => { settlements++; return { success: true, network: NETWORK, transaction, payer: signer.address }; },
  };
  const paymentServer = await createPaymentServer(facilitator);
  const app = await createGateway({ paymentServer, store: purchases, events, origin,
    receiptPins: { [f.policy.provider]: f.policy.receipt_public_key },
    observe: async purchase => {
      observations++;
      const receipt = { ...f.run.receipt, request_id: purchase.id, nonce: purchase.nonce,
        started_at: Math.floor(Date.now() / 1000), completed_at: Math.floor(Date.now() / 1000) };
      receipt.receipt_signature = 'v3:' + sign('sha256', Buffer.from(receiptMessage(receipt)),
        { key: f.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
      return { receipt };
    } });
  const transport = memoryFetch(app, origin);
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === origin) return transport(input, init);
    assert.equal(url.href, DEVNET_RPC + '/');
    const message = JSON.parse(init.body);
    if (message.method === 'getAccountInfo') {
      const mint = Buffer.alloc(82); mint[44] = 6; mint[45] = 1;
      return Response.json({ jsonrpc: '2.0', id: message.id, result: { context: { slot: 1 }, value: {
        data: [mint.toString('base64'), 'base64'], executable: false, lamports: 1,
        owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', rentEpoch: 0, space: 82 } } });
    }
    if (message.method === 'getLatestBlockhash') return Response.json({ jsonrpc: '2.0', id: message.id,
      result: { context: { slot: 1 }, value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 } } });
    assert.equal(message.method, 'getTransaction');
    assert.equal(message.params[0], transaction);
    const result = JSON.parse(readFileSync(new URL('./fixtures/settlement-rpc.json', import.meta.url)));
    const previousPayer = result.meta.preTokenBalances.find(row => row.owner !== PAY_TO).owner;
    result.transaction.signatures[0] = transaction;
    for (const row of [...result.meta.preTokenBalances, ...result.meta.postTokenBalances]) if (row.owner === previousPayer) row.owner = signer.address;
    for (const instruction of result.transaction.message.instructions) if (instruction.parsed?.info?.authority === previousPayer) instruction.parsed.info.authority = signer.address;
    return Response.json({ jsonrpc: '2.0', id: message.id, result });
  };
  controller = createLocalBuyer({ directory: join(directory, 'buyer'), payer: signer.address, payTo: PAY_TO, maximum: 1,
    readPurchaseState: id => purchases.get(id)?.state,
    buy: onProgress => performPaidJob({ signer, origin, policyPath, events, resolve: async () => f.identity, onProgress }) });
  const operation = randomUUID();
  assert.equal(controller.start(operation).code, 202);
  for (let attempt = 0; attempt < 100 && controller.status(operation).status === 'pending'; attempt++) await tick();
  const state = controller.status(operation);
  assert.equal(state.status, 'done', JSON.stringify(state));
  assert.equal(settlements, 1); assert.equal(observations, 1);
  assert.deepEqual(state.events.filter(event => event.phase !== 'settled').map(event => event.phase),
    ['identity', 'request', 'quote', 'paying', 'verified', 'activity-pending']);
  const decoded = getTransactionDecoder().decode(getBase64Encoder().encode(paymentPayload.payload.transaction));
  const key = await crypto.subtle.importKey('raw', getAddressEncoder().encode(signer.address), 'Ed25519', false, ['verify']);
  assert.equal(await crypto.subtle.verify('Ed25519', key, decoded.signatures[signer.address], decoded.messageBytes), true);
  assert.equal(controller.start(operation).code, 200);
  assert.equal(controller.start(randomUUID()).code, 429);
  assert.equal(settlements, 1);
  controller.close(); controller = null;
  const savedRaw = events.get(state.purchase_id).job_utf8;
  purchases.close(); purchases = new PurchaseStore(database); events = new EventStore(purchases);
  assert.equal(events.get(state.purchase_id).job_utf8, savedRaw);
  const job = JSON.parse(savedRaw), eventHash = '0x' + 'cd'.repeat(32), eventTransaction = '0x' + 'ab'.repeat(32);
  let eventWrites = 0;
  const run = async (module, args) => {
    if (module === 'scripts.prepare_peaq_event') return { schema: 'fieldproof-peaq-event-preparation-v1',
      machine_id: f.policy.machine_id, raw_data_utf8: savedRaw, raw_data_sha256: events.get(state.purchase_id).job_sha256, data_hash: eventHash };
    if (module === 'scripts.peaq_operator') {
      eventWrites++;
      assert.equal(events.get(state.purchase_id).state, 'submitting');
      return { schema: 'fieldproof-agung-event-result-v1', status: 'finalized_and_inspected', transaction_hash: eventTransaction,
        data_hash: eventHash, job_sha256: events.get(state.purchase_id).job_sha256, index: 0,
        journal: args[args.indexOf('--journal') + 1].split('/').at(-1) };
    }
    assert.equal(module, 'scripts.inspect_peaq_event');
    return { verified: true, transaction_hash: eventTransaction, data_hash: eventHash,
      job_sha256: events.get(state.purchase_id).job_sha256, finalized_block: 102 };
  };
  const options = { events, id: state.purchase_id, policy: f.policy, policyPath,
    registry: '0x' + '67'.repeat(20), execute: true, gasCap: '1000', keyFile: '/tmp/fixture-never-read.secret', run };
  await submitSavedEvent(options);
  await inspectSavedEvent(options);
  assert.equal(eventWrites, 1);
  await assert.rejects(submitSavedEvent(options), /pending job/);
  const manifest = savedEvidenceManifest(events, state.purchase_id, f.policy);
  const checked = await inspectSource(manifest, { pin: f.policy.receipt_public_key, now: job.acceptance.verified_at });
  assert.equal(checked.signature, true); assert.equal(checked.terms, true);
  assert.equal(decisionAt(checked, true, job.receipt.completed_at + 11).decision, 'WAIT');
  const altered = structuredClone(manifest); altered.job.receipt.result.closed = true;
  assert.equal((await inspectSource(altered, { pin: f.policy.receipt_public_key })).signature, false);
  assert.equal(manifest.commercial_revenue, false);
});
