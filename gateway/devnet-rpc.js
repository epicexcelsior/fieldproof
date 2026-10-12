// Server-only RPC configuration. The endpoint and key never enter a browser response.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { getTransactionDecoder, getSignatureFromTransaction } from '@solana/kit';
import { DEVNET_RPC, querySettlement, queryRefund } from '../docs/settlement.mjs';
import { NETWORK } from './constants.js';

export function devnetRpcUrl(env = process.env, read = path => readFileSync(path, 'utf8')) {
  let key = env.HELIUS_API_KEY;
  if (!key) {
    if (!env.FIELDPROOF_HELIUS_KEY_FILE) return DEVNET_RPC;
    try { key = read(env.FIELDPROOF_HELIUS_KEY_FILE).trim(); }
    catch { throw new Error('The configured Helius Devnet key file is unavailable.'); }
  }
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new Error('The configured Helius API key is invalid.');
  const url = new URL('https://devnet.helius-rpc.com/');
  url.searchParams.set('api-key', key);
  return url.href;
}

export function configureLocalDevnetRpc(env = process.env, exists = existsSync) {
  const path = fileURLToPath(new URL('../.local/competition/helius-devnet.secret', import.meta.url));
  if (!env.HELIUS_API_KEY && !env.FIELDPROOF_HELIUS_KEY_FILE && exists(path)) env.FIELDPROOF_HELIUS_KEY_FILE = path;
  return { network: 'Solana Devnet', provider: new URL(devnetRpcUrl(env)).hostname };
}

export async function devnetFetch(url, options) {
  if (url !== DEVNET_RPC) throw new Error('Only the fixed Solana Devnet query is supported.');
  try { return await fetch(devnetRpcUrl(), options); }
  catch { throw new Error('The configured Solana Devnet RPC is unavailable. No automatic payment retry.'); }
}

export const queryDevnetSettlement = purchase => querySettlement(purchase, devnetFetch);
export const queryDevnetRefund = (purchase, transaction) => queryRefund(purchase, transaction, devnetFetch);

export async function confirmPendingSettlement(settlement, proofHash, fetcher = devnetFetch) {
  if (settlement?.success !== false || settlement.errorReason !== 'settlement_pending' || settlement.network !== NETWORK ||
      !/^[0-9a-f]{64}$/.test(proofHash ?? '')) throw new Error('Only the exact pending Devnet settlement can be reconciled.');
  const expected = { settlement: { success: true, network: NETWORK, payer: settlement.payer, transaction: settlement.transaction } };
  const proof = await querySettlement(expected, fetcher); // Exact mint, amount, sender, recipient, and successful confirmed transaction.
  const response = await fetcher(DEVNET_RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000), body: JSON.stringify({ jsonrpc: '2.0', id: 'fieldproof-message-check',
      method: 'getTransaction', params: [settlement.transaction, { commitment: 'confirmed', encoding: 'base64', maxSupportedTransactionVersion: 0 }] }) });
  if (!response.ok) throw new Error('Pending payment message verification is unavailable.');
  const raw = await response.text();
  if (raw.length > 262144) throw new Error('Pending payment message exceeds its inspection limit.');
  const body = JSON.parse(raw), result = body?.result;
  if (body.jsonrpc !== '2.0' || body.id !== 'fieldproof-message-check' || Object.hasOwn(body, 'error') ||
      result?.meta?.err !== null || result.slot !== proof.slot ||
      !Array.isArray(result.transaction) || result.transaction[1] !== 'base64') throw new Error('Pending transaction is not confirmed.');
  const decoded = getTransactionDecoder().decode(Buffer.from(result.transaction[0], 'base64'));
  if (getSignatureFromTransaction(decoded) !== settlement.transaction || createHash('sha256').update(decoded.messageBytes).digest('hex') !== proofHash) {
    throw new Error('Confirmed payment does not match this purchase signed message.');
  }
  return expected.settlement;
}
