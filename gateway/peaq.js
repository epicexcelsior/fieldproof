// Trusted local provider policy and a read-only resolver. No signer enters this process.
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { address } from '@solana/kit';
import { contactContract, receiptKey } from './contact.js';
import { PAY_TO } from './constants.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const evm = /^0x[0-9a-fA-F]{40}$/;
const hash = /^0x[0-9a-fA-F]{64}$/;
const policyFields = ['schema', 'chain_id', 'deployment_id', 'machine_id', 'provider', 'sensor', 'owner',
  'controller', 'receipt_public_key', 'verification_method_id', 'service_id', 'service_type',
  'service_endpoint', 'pay_to', 'max_identity_age_seconds'];
const snapshotFields = ['schema', 'chain_id', 'deployment_id', 'machine_id', 'owner', 'controller',
  'receipt_public_key', 'key_id', 'authentication', 'service', 'subscription', 'available', 'paused',
  'homed_locally', 'relocating', 'finalized_block', 'block_hash', 'block_timestamp', 'resolved_at', 'contracts', 'peers_match'];
const contractRoles = ['machine_registry', 'info_desk', 'machine_state_and_sync', 'machine_subscription',
  'cross_chain_mirror', 'machine_bridge_adapter', 'subscription_token_provision_pool'];
const exactFields = (input, fields) => input && !Array.isArray(input) && typeof input === 'object' &&
  Object.keys(input).length === fields.length && fields.every(field => Object.hasOwn(input, field));

export function validateProviderPolicy(input) {
  if (!input || Array.isArray(input) || Object.keys(input).length !== policyFields.length ||
      policyFields.some(field => !Object.hasOwn(input, field)) || input.schema !== 'fieldproof-provider-policy-v1' ||
      input.chain_id !== 9990 || input.deployment_id !== 'agung-2026-08-28' ||
      typeof input.machine_id !== 'string' || !/^(0|[1-9][0-9]*)$/.test(input.machine_id) ||
      input.machine_id.length > 78 || BigInt(input.machine_id) >= 2n ** 256n) {
    throw new Error('Use an explicit Agung provider policy with a canonical uint256 machine ID');
  }
  contactContract({ provider: input.provider, sensor: input.sensor });
  if (input.sensor !== 'gpio9-contact') throw new Error('The competition job uses the installed GPIO9 contact profile');
  receiptKey(input.receipt_public_key);
  for (const role of ['owner', 'controller']) {
    if (!evm.test(input[role]) || BigInt(input[role]) === 0n) throw new Error(`Configure a nonzero public ${role} address`);
  }
  address(input.pay_to);
  // The current gateway and independent payment inspector have one fixed Devnet recipient.
  if (input.pay_to !== PAY_TO || input.verification_method_id !== '#receipt-key' ||
      input.service_id !== '#contact-observation' || input.service_type !== 'FieldProofBLEContactV1' ||
      input.service_endpoint !== `urn:fieldproof:ble-contact:${input.provider}:${input.sensor}:state.observe` ||
      input.max_identity_age_seconds !== 120) {
    throw new Error('Provider policy changes the approved key, service, recipient, or identity age limit');
  }
  return Object.freeze({ ...input });
}

export async function loadProviderPolicy(path) {
  const contents = await readFile(path, 'utf8');
  if (contents.length > 8192) throw new Error('Provider policy exceeds its inspection limit');
  return validateProviderPolicy(JSON.parse(contents));
}

export function checkIdentity(snapshot, policyInput, now = Math.floor(Date.now() / 1000)) {
  const policy = validateProviderPolicy(policyInput);
  const service = snapshot?.service;
  if (!exactFields(snapshot, snapshotFields) || !exactFields(service, ['id', 'type', 'endpoint']) ||
      !exactFields(snapshot.contracts, contractRoles) || contractRoles.some(role => !evm.test(snapshot.contracts[role]) || BigInt(snapshot.contracts[role]) === 0n) ||
      snapshot.schema !== 'fieldproof-peaq-identity-v1' ||
      snapshot.chain_id !== policy.chain_id || snapshot.deployment_id !== policy.deployment_id ||
      snapshot.machine_id !== policy.machine_id || snapshot.owner?.toLowerCase() !== policy.owner.toLowerCase() ||
      snapshot.controller?.toLowerCase() !== policy.controller.toLowerCase() ||
      snapshot.receipt_public_key !== policy.receipt_public_key || snapshot.key_id !== policy.verification_method_id ||
      snapshot.authentication !== true || service?.id !== policy.service_id ||
      service.type !== policy.service_type || service.endpoint !== policy.service_endpoint ||
      snapshot.subscription !== 'active' || snapshot.available !== true || snapshot.paused !== false ||
      snapshot.homed_locally !== true || snapshot.relocating !== false || snapshot.peers_match !== true ||
      !Number.isSafeInteger(snapshot.finalized_block) || snapshot.finalized_block < 1 || !hash.test(snapshot.block_hash) ||
      !Number.isSafeInteger(snapshot.block_timestamp) || !Number.isSafeInteger(snapshot.resolved_at) ||
      !Number.isSafeInteger(now) || snapshot.block_timestamp < 1 || snapshot.resolved_at < snapshot.block_timestamp ||
      snapshot.resolved_at > now + 2 || snapshot.block_timestamp > now + 2 ||
      now - snapshot.resolved_at > policy.max_identity_age_seconds ||
      now - snapshot.block_timestamp > policy.max_identity_age_seconds ||
      !snapshot.contracts || !evm.test(snapshot.contracts.machine_registry) ||
      !evm.test(snapshot.contracts.info_desk)) {
    throw new Error('peaq identity does not satisfy the approved owner, key, service, activity, or finalized-block policy');
  }
  return structuredClone(snapshot);
}

export function resolveIdentity(policyPath, { python = process.env.FIELDPROOF_PEAQ_PYTHON || 'python3' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-m', 'scripts.resolve_peaq_identity', '--policy', policyPath],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', failed = false;
    const fail = message => { if (!failed) { failed = true; child.kill('SIGKILL'); reject(new Error(message)); } };
    const timer = setTimeout(() => fail('peaq identity resolution timed out. No payment started.'), 45000);
    child.stdout.on('data', data => { output += data; if (output.length > 32768) fail('peaq identity output exceeds its inspection limit'); });
    // Resolver errors can contain local paths or RPC internals. Keep HTTP/agent errors public and bounded.
    child.stderr.resume();
    child.on('error', () => { clearTimeout(timer); fail('The isolated peaq Python environment is unavailable. No payment started.'); });
    child.on('close', code => {
      clearTimeout(timer);
      if (failed) return;
      if (code !== 0) return reject(new Error('peaq identity resolution failed. Run the read-only resolver for details. No payment started.'));
      try { resolve(JSON.parse(output)); } catch { reject(new Error('peaq resolver returned invalid JSON. No payment started.')); }
    });
  });
}
