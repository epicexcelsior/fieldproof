// The buyer selects this application policy. A receipt cannot select its own meaning.
export function contactPolicy(purpose = 'gate-access', sensor = 'gpio9-contact') {
  if (purpose !== 'gate-access' && purpose !== 'package-pickup') throw new Error('Unsupported buyer purpose');
  if (purpose === 'package-pickup' && sensor !== 'gpio20-contact') {
    throw new Error('Package pickup requires the selected GPIO20 contact');
  }
  return {
    state: closed => typeof closed !== 'boolean' ? 'UNAVAILABLE'
      : purpose === 'package-pickup' ? (closed ? 'PACKAGE_PRESENT' : 'PACKAGE_ABSENT') : (closed ? 'CLOSED' : 'OPEN'),
    decision: (accepted, closed) => accepted && typeof closed === 'boolean' &&
      (purpose === 'package-pickup' ? closed : !closed) ? 'DISPATCH' : 'WAIT',
  };
}

// Independent read-only check of the recorded demonstration payment.
export const DEVNET_RPC = 'https://api.devnet.solana.com';
const NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const MERCHANT = 'CaQAKBcwf7G5vXeu2RNuNGJafnJ8724Uj4wv9ivfxfQA';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const AMOUNT = 1000n;

function validatePurchase(purchase) {
  const settlement = purchase?.settlement;
  if (settlement?.success !== true || settlement.network !== NETWORK ||
      !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(settlement.transaction || '') ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(settlement.payer || '') || settlement.payer === MERCHANT) {
    throw new Error('The recorded purchase does not describe a supported Devnet settlement.');
  }
  return settlement;
}

// Describe expected recorded terms. Only querySettlement verifies them against chain data.
export function recordedPaymentDetails(purchase) {
  const settlement = validatePurchase(purchase);
  return { payer: settlement.payer, merchant: MERCHANT, transaction: settlement.transaction,
    amount_usdc: Number(AMOUNT) / 1e6, network: 'Solana Devnet' };
}

function verifyTransfer(result, transaction, sender, recipient) {
  if (!result) throw new Error('The RPC cannot find this transaction at confirmed commitment.');
  if (result.meta?.err !== null || !Number.isSafeInteger(result.slot) || result.slot < 1 ||
      result.transaction?.signatures?.[0] !== transaction) {
    throw new Error('The RPC result does not confirm the expected successful transaction.');
  }
  const keys = result.transaction.message?.accountKeys;
  if (!Array.isArray(keys)) throw new Error('The RPC result has no parsed account keys.');
  const balances = phase => {
    if (!Array.isArray(phase)) throw new Error('The RPC result has no token balance records.');
    const found = new Map();
    for (const item of phase) {
      if (item.mint !== MINT) continue;
      if (!Number.isInteger(item.accountIndex) || !keys[item.accountIndex]?.pubkey ||
          item.programId !== TOKEN_PROGRAM || item.uiTokenAmount?.decimals !== 6 ||
          typeof item.uiTokenAmount?.amount !== 'string' ||
          !/^(0|[1-9][0-9]*)$/.test(item.uiTokenAmount.amount) || found.has(item.accountIndex)) {
        throw new Error('The RPC returned inconsistent USDC token balances.');
      }
      found.set(item.accountIndex, { owner: item.owner, amount: BigInt(item.uiTokenAmount.amount) });
    }
    return found;
  };
  const before = balances(result.meta.preTokenBalances);
  const after = balances(result.meta.postTokenBalances);
  const deltas = new Map();
  const accounts = new Map();
  for (const index of new Set([...before.keys(), ...after.keys()])) {
    const pre = before.get(index), post = after.get(index);
    if (pre && post && pre.owner !== post.owner) throw new Error('A USDC token account changed owner.');
    const owner = post?.owner || pre?.owner;
    if (!owner) throw new Error('A USDC token balance has no owner.');
    deltas.set(owner, (deltas.get(owner) || 0n) + (post?.amount || 0n) - (pre?.amount || 0n));
    accounts.set(keys[index].pubkey, owner);
  }
  if (deltas.get(sender) !== -AMOUNT || deltas.get(recipient) !== AMOUNT) {
    throw new Error('The payer and merchant did not exchange exactly 0.001 Devnet USDC.');
  }
  const outer = result.transaction.message.instructions;
  const inner = result.meta.innerInstructions || [];
  if (!Array.isArray(outer) || !Array.isArray(inner)) throw new Error('The RPC returned malformed instructions.');
  if (inner.some(group => !Array.isArray(group?.instructions))) throw new Error('The RPC returned malformed inner instructions.');
  const instructions = [...outer, ...inner.flatMap(group => group.instructions)];
  if (instructions.some(instruction => !instruction || typeof instruction !== 'object' || Array.isArray(instruction))) {
    throw new Error('The RPC returned malformed instructions.');
  }
  const transfer = instructions.some(instruction => {
    const info = instruction.parsed?.info;
    return instruction.programId === TOKEN_PROGRAM && instruction.parsed?.type === 'transferChecked' &&
      info?.mint === MINT && info.tokenAmount?.amount === String(AMOUNT) && info.tokenAmount.decimals === 6 &&
      info.authority === sender && accounts.get(info.source) === sender &&
      accounts.get(info.destination) === recipient;
  });
  if (!transfer) throw new Error('The RPC result has no matching SPL Token transfer instruction.');
}

export function verifySettlement(result, purchase) {
  const settlement = validatePurchase(purchase);
  verifyTransfer(result, settlement.transaction, settlement.payer, MERCHANT);
  return { network: 'Solana Devnet', slot: result.slot, transaction: settlement.transaction,
    mint: MINT, payer: settlement.payer, merchant: MERCHANT,
    payer_delta_base_units: String(-AMOUNT), merchant_delta_base_units: String(AMOUNT), decimals: 6 };
}

export function refundMemo(purchase) {
  const original = validatePurchase(purchase);
  if (!/^[0-9a-f]{16}$/.test(purchase.purchase_id ?? '')) throw new Error('Refund requires the original purchase ID.');
  return `fieldproof:refund:${purchase.purchase_id}:${original.transaction}`;
}

export function verifyRefund(result, purchase, transaction) {
  const original = validatePurchase(purchase);
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(transaction ?? '') || transaction === original.transaction) {
    throw new Error('Refund requires a separate transaction signature.');
  }
  verifyTransfer(result, transaction, MERCHANT, original.payer);
  const instructions = [...result.transaction.message.instructions, ...(result.meta.innerInstructions || []).flatMap(group => group.instructions)];
  if (!instructions.some(ix => ix.programId === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' && ix.parsed === refundMemo(purchase))) {
    throw new Error('Refund memo does not bind this original purchase and payment.');
  }
  return { network: 'Solana Devnet', slot: result.slot, transaction, original_transaction: original.transaction,
    mint: MINT, payer: original.payer, merchant: MERCHANT,
    payer_delta_base_units: '1000', merchant_delta_base_units: '-1000', decimals: 6 };
}

async function queryTransaction(transaction, fetcher) {
  let response;
  try {
    response = await fetcher(DEVNET_RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000), body: JSON.stringify({ jsonrpc: '2.0', id: 'fieldproof-payment-check',
        method: 'getTransaction', params: [transaction,
          { commitment: 'confirmed', encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }] }) });
  } catch (error) {
    if (error instanceof TypeError) throw new Error('The browser cannot reach Solana Devnet. Check internet access, then try again.', { cause: error });
    throw error;
  }
  if (!response.ok) throw new Error(`The Devnet RPC refused the query (HTTP ${response.status}).`);
  const text = await response.text();
  if (text.length > 262144) throw new Error('The Devnet RPC response exceeds the inspection limit.');
  let body;
  try { body = JSON.parse(text); }
  catch { throw new Error('The Devnet RPC returned invalid JSON.'); }
  if (!body || body.jsonrpc !== '2.0' || body.id !== 'fieldproof-payment-check' || Object.hasOwn(body, 'error')) {
    throw new Error('The Devnet RPC did not return a correlated transaction result.');
  }
  return body.result;
}

export async function querySettlement(purchase, fetcher = fetch) {
  const settlement = validatePurchase(purchase);
  return verifySettlement(await queryTransaction(settlement.transaction, fetcher), purchase);
}

export async function queryRefund(purchase, transaction, fetcher = fetch) {
  refundMemo(purchase);
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(transaction ?? '') || transaction === purchase.settlement.transaction) {
    throw new Error('Use a separate refund transaction signature.');
  }
  return verifyRefund(await queryTransaction(transaction, fetcher), purchase, transaction);
}

// Validate persisted results of independent chain queries. This function makes no RPC request.
export function publicRefundResolution(input) {
  const original = input?.original_payment, refund = input?.refund;
  const valid = proof => proof?.network === 'Solana Devnet' && proof.mint === MINT && proof.decimals === 6 &&
    Number.isSafeInteger(proof.slot) && proof.slot > 0 && proof.merchant === MERCHANT &&
    /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(proof.transaction ?? '') &&
    /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(proof.payer ?? '') && proof.payer !== MERCHANT;
  if (input?.schema !== 'fieldproof-refund-resolution-v1' || !/^[0-9a-f]{16}$/.test(input.purchase_id ?? '') ||
      !valid(original) || !valid(refund) || original.payer !== refund.payer || refund.slot <= original.slot ||
      original.transaction === refund.transaction || refund.original_transaction !== original.transaction ||
      original.payer_delta_base_units !== '-1000' || original.merchant_delta_base_units !== '1000' ||
      refund.payer_delta_base_units !== '1000' || refund.merchant_delta_base_units !== '-1000') {
    throw new Error('Refund resolution requires matching original-payment and exact-return chain results.');
  }
  const select = proof => ({ network: proof.network, slot: proof.slot, transaction: proof.transaction,
    mint: proof.mint, payer: proof.payer, merchant: proof.merchant,
    payer_delta_base_units: proof.payer_delta_base_units, merchant_delta_base_units: proof.merchant_delta_base_units, decimals: 6 });
  return { schema: input.schema, purchase_id: input.purchase_id, original_payment: select(original),
    refund: { ...select(refund), original_transaction: original.transaction } };
}

// Public fields from the independent buyer. This never selects a verification key from input.

export function publicBuyerRun(input, purpose = 'gate-access') {
  if (purpose !== 'gate-access' && purpose !== 'package-pickup') throw new Error('Unsupported buyer purpose');
  const sensor = purpose === 'package-pickup' ? 'gpio20-contact' : 'gpio9-contact';
  const p = input?.purchase || input, c = p?.challenge, r = p?.receipt, s = r?.result;
  if (!p || Array.isArray(p) || typeof p.purchase_id !== 'string' || !/^[0-9a-f]{16}$/.test(p.purchase_id) ||
      (purpose === 'package-pickup' && (p.purpose !== purpose || c?.contact === undefined)) ||
      c?.id !== p.purchase_id || !Number.isInteger(c.nonce) || c.nonce < 1 || c.nonce > 0x7fffffff ||
      !Number.isSafeInteger(c.created_at) || c.created_at < 1 || c.location !== 'demo-gate' || c.max_age_seconds !== 10 ||
      (c.contact !== undefined && (c.contact?.provider !== 'esp32-c6-96a2' || c.contact.sensor !== sensor || Object.keys(c.contact).length !== 2)) ||
      r?.protocol !== 'capmesh/0.1' || r.status !== 'success' || r.request_id !== c.id || r.nonce !== c.nonce ||
      r.provider !== 'esp32-c6-96a2' || r.capability !== 'state.observe' ||
      r.parameters?.location !== 'demo-gate' || Object.keys(r.parameters).length !== 1 || s?.metric !== 'gate.closed' || s.sensor !== sensor ||
      typeof s.closed !== 'boolean' || s.total_samples !== 5 || s.stable_samples !== 5 ||
      !Number.isSafeInteger(r.started_at) || r.started_at < 1 || !Number.isSafeInteger(r.completed_at) ||
      r.started_at < c.created_at - 2 || r.completed_at < r.started_at ||
      !/^v3:[A-Za-z0-9+/]{86}==$/.test(r.receipt_signature || '')) {
    throw new Error(`Use the independent buyer output for the installed ${sensor} observer, selected purpose, ten-second contract, and Devnet payment.`);
  }
  recordedPaymentDetails(p); // Fixed chain, merchant, and amount. Chain verification remains separate.
  return { purchase_id: p.purchase_id, ...(purpose === 'package-pickup' ? { purpose } : {}),
    challenge: { id: c.id, nonce: c.nonce, created_at: c.created_at, location: 'demo-gate', max_age_seconds: 10,
      ...(purpose === 'package-pickup' ? { contact: { provider: 'esp32-c6-96a2', sensor } } : {}) },
    settlement: { success: true, payer: p.settlement.payer, transaction: p.settlement.transaction, network: p.settlement.network },
    receipt: { protocol: r.protocol, request_id: r.request_id, status: r.status, provider: r.provider,
      capability: r.capability, parameters: { location: 'demo-gate' }, nonce: r.nonce,
      result: { metric: s.metric, sensor: s.sensor, closed: s.closed, stable_samples: 5, total_samples: 5 },
      started_at: r.started_at, completed_at: r.completed_at, receipt_signature: r.receipt_signature } };
}
