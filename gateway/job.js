// ASCII-key canonical JSON v1. Integers must fit JavaScript's safe integer range.
import { createHash } from 'node:crypto';
import { checkEvidence } from './buyer.js';
import { checkIdentity, validateProviderPolicy } from './peaq.js';
import { NETWORK, USDC } from './constants.js';

export function canonicalJSON(value) {
  function encode(input) {
    if (input === null || typeof input === 'boolean') return JSON.stringify(input);
    if (typeof input === 'string' && input.isWellFormed()) return JSON.stringify(input);
    if (typeof input === 'number' && Number.isSafeInteger(input) && !Object.is(input, -0)) return JSON.stringify(input);
    if (Array.isArray(input)) return '[' + input.map(encode).join(',') + ']';
    if (input && typeof input === 'object' && Object.getPrototypeOf(input) === Object.prototype) {
      const keys = Object.keys(input).sort();
      if (keys.some(key => !/^[A-Za-z0-9_]+$/.test(key))) throw new Error('Canonical job keys must use ASCII letters, digits, and underscores');
      // Serialize directly. JSON.stringify reorders integer-like object keys numerically.
      return '{' + keys.map(key => JSON.stringify(key) + ':' + encode(input[key])).join(',') + '}';
    }
    throw new Error('Canonical jobs contain only JSON values and safe integers');
  }
  return encode(value);
}

export function sha256(text) { return createHash('sha256').update(text, 'utf8').digest('hex'); }

export function createJob(run, policyInput, snapshot, verifiedAt = Math.floor(Date.now() / 1000)) {
  const policy = validateProviderPolicy(policyInput);
  const contact = { provider: policy.provider, sensor: policy.sensor };
  const identity = checkIdentity(snapshot, policy, run?.challenge?.created_at);
  if (!Number.isSafeInteger(verifiedAt) || verifiedAt < 1 || !Number.isSafeInteger(run.challenge.created_at) ||
      snapshot.resolved_at > run.challenge.created_at + 2 || run.purchase_id !== run.challenge.id ||
      !/^[0-9a-f]{16}$/.test(run.purchase_id) || run.challenge.contact?.provider !== contact.provider ||
      run.challenge.contact?.sensor !== contact.sensor || run.challenge.max_age_seconds !== 10 ||
      run.settlement?.success !== true || run.settlement.network !== NETWORK ||
      !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(run.settlement.transaction || '') ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(run.settlement.payer || '') || run.settlement.payer === policy.pay_to) {
    throw new Error('Job does not bind the approved provider, request, or real Devnet settlement reference');
  }
  const accepted = checkEvidence(run, run.challenge, verifiedAt, policy.receipt_public_key, contact, run.purpose ?? 'gate-access');
  const job = { schema: 'fieldproof-job-v1', job_id: run.purchase_id, provider: policy.provider,
    identity, request: structuredClone(run.challenge), receipt: structuredClone(run.receipt),
    receipt_sha256: sha256(canonicalJSON(run.receipt)),
    payment: { network: NETWORK, asset: USDC, recipient: policy.pay_to, amount_base_units: '1000',
      kind: 'test-token', transaction: run.settlement.transaction, payer: run.settlement.payer },
    acceptance: { accepted: true, verified_at: verifiedAt, decision: accepted.decision } };
  const raw = canonicalJSON(job);
  if (Buffer.byteLength(raw) > 16384) throw new Error('Job evidence exceeds its inspection limit');
  return { job, raw, sha256: sha256(raw) };
}

export function verifyJob(job, policy) {
  if (job?.schema !== 'fieldproof-job-v1' || job.acceptance?.accepted !== true ||
      job.payment?.kind !== 'test-token' || job.payment.asset !== USDC || job.payment.amount_base_units !== '1000' ||
      job.payment.recipient !== policy.pay_to || job.provider !== policy.provider) throw new Error('Unsupported paid physical-check job');
  const run = { purchase_id: job.job_id, challenge: job.request, receipt: job.receipt,
    settlement: { success: true, network: job.payment.network, transaction: job.payment.transaction, payer: job.payment.payer } };
  const rebuilt = createJob(run, policy, job.identity, job.acceptance.verified_at);
  if (rebuilt.raw !== canonicalJSON(job)) throw new Error('Job receipt digest, acceptance, or evidence changed');
  return rebuilt;
}
