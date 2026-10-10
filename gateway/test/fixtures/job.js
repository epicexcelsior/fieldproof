import { generateKeyPairSync, sign } from 'node:crypto';
import { PAY_TO, NETWORK, USDC } from '../../constants.js';
import { getBase58Decoder } from '@solana/kit';

export function jobFixture(now = 1_800_000_000) {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pin = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-65).toString('hex');
  const policy = { schema: 'fieldproof-provider-policy-v1', chain_id: 9990, deployment_id: 'agung-2026-08-28',
    machine_id: (2n ** 255n).toString(), provider: 'esp32-c6-96a2', sensor: 'gpio9-contact',
    owner: '0x' + '12'.repeat(20), controller: '0x' + '12'.repeat(20), receipt_public_key: pin,
    verification_method_id: '#receipt-key', service_id: '#contact-observation', service_type: 'FieldProofBLEContactV1',
    service_endpoint: 'urn:fieldproof:ble-contact:esp32-c6-96a2:gpio9-contact:state.observe', pay_to: PAY_TO,
    max_identity_age_seconds: 120 };
  const identity = { schema: 'fieldproof-peaq-identity-v1', chain_id: 9990, deployment_id: policy.deployment_id,
    machine_id: policy.machine_id, owner: policy.owner, controller: policy.controller, receipt_public_key: pin,
    key_id: '#receipt-key', authentication: true, service: { id: policy.service_id, type: policy.service_type, endpoint: policy.service_endpoint },
    subscription: 'active', available: true, paused: false, homed_locally: true, relocating: false,
    finalized_block: 100, block_hash: '0x' + '34'.repeat(32), block_timestamp: now - 5, resolved_at: now - 1,
    contracts: Object.fromEntries(['machine_registry', 'info_desk', 'machine_state_and_sync', 'machine_subscription',
      'cross_chain_mirror', 'machine_bridge_adapter', 'subscription_token_provision_pool'].map(role => [role, '0x' + '45'.repeat(20)])), peers_match: true };
  const id = '0123456789abcdef';
  const receipt = { protocol: 'capmesh/0.1', status: 'success', request_id: id, provider: policy.provider,
    capability: 'state.observe', parameters: { location: 'demo-gate' }, nonce: 123,
    result: { metric: 'gate.closed', sensor: policy.sensor, closed: false, total_samples: 5, stable_samples: 5 },
    started_at: now, completed_at: now };
  const message = `fieldproof-observation-v1|capmesh/0.1|${id}|${policy.provider}|state.observe|demo-gate|123|gate.closed|gpio9-contact|0|5|5|${now}|${now}`;
  receipt.receipt_signature = 'v3:' + sign('sha256', Buffer.from(message), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
  const run = { purchase_id: id, challenge: { id, nonce: 123, created_at: now, location: 'demo-gate', max_age_seconds: 10,
    contact: { provider: policy.provider, sensor: policy.sensor } }, receipt,
    settlement: { success: true, network: NETWORK, transaction: getBase58Decoder().decode(new Uint8Array(64).fill(1)),
      payer: getBase58Decoder().decode(new Uint8Array(32).fill(1)) } };
  const paymentVerification = { network: 'Solana Devnet', slot: 100, transaction: run.settlement.transaction,
    mint: USDC, payer: run.settlement.payer, merchant: PAY_TO, payer_delta_base_units: '-1000',
    merchant_delta_base_units: '1000', decimals: 6 };
  return { now, policy, identity, run, paymentVerification, privateKey: keys.privateKey };
}
