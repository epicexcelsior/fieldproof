// Read-only chain reconciliation followed by one local journal update. This tool never signs or pays.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createLocalBuyer } from './local-buyer.js';
import { PurchaseStore } from './store.js';
import { PAY_TO } from './constants.js';
import { querySettlement, queryRefund, publicRefundResolution } from '../docs/settlement.mjs';

export async function reconcileRefund({ store, directory, operation, purchaseId, transaction,
  queryPayment = querySettlement, queryReturn = queryRefund }) {
  const row = store.get(purchaseId);
  if (!row || row.state !== 'delivery_failed' || row.result !== null || !row.settlement) {
    throw new Error('Refund review requires an undelivered purchase with its original settlement.');
  }
  const purchase = { purchase_id: purchaseId, settlement: JSON.parse(row.settlement) };
  // Acquire the same exclusive wallet lock before querying or updating shared state.
  const controller = createLocalBuyer({ directory, payer: purchase.settlement.payer, payTo: PAY_TO,
    buy: () => { throw new Error('Refund reconciliation cannot start a purchase.'); },
    readPurchaseState: id => store.get(id)?.state,
    readPurchaseSettlement: id => { const saved = store.get(id)?.settlement; return saved ? JSON.parse(saved) : null; } });
  try {
    const preserved = controller.status(operation);
    if (!preserved || preserved.purchase_id !== purchaseId || !['review', 'refunded'].includes(preserved.status)) {
      throw new Error('Use the preserved review operation and its original purchase ID.');
    }
    const original_payment = await queryPayment(purchase);
    const refund = await queryReturn(purchase, transaction);
    if (original_payment.transaction !== purchase.settlement.transaction || refund.transaction !== transaction) {
      throw new Error('Chain results do not match the exact original payment and selected refund.');
    }
    const resolution = publicRefundResolution({ schema: 'fieldproof-refund-resolution-v1', purchase_id: purchaseId,
      original_payment, refund });
    const result = controller.completeRefunded(operation, resolution);
    const config = controller.config();
    return { status: result.status, operation_id: operation, purchase_id: purchaseId,
      refund_transaction: resolution.refund.transaction, original_payment_preserved: true,
      fulfilled: false, remaining: config.remaining, blocked: config.blocked, signing: false, spending: false };
  } finally { controller.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ options: { operation: { type: 'string' }, purchase: { type: 'string' },
    transaction: { type: 'string' }, record: { type: 'boolean' } } });
  if (positionals.length || values.record !== true ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(values.operation ?? '') ||
      !/^[0-9a-f]{16}$/.test(values.purchase ?? '') || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(values.transaction ?? '')) {
    throw new Error('Usage: node gateway/reconcile-refund.js --operation UUID --purchase ID --transaction REFUND_SIGNATURE --record');
  }
  const root = fileURLToPath(new URL('../', import.meta.url));
  const store = new PurchaseStore(resolve(root, '.local/purchases.sqlite'));
  try {
    const payer = JSON.parse(store.get(values.purchase)?.settlement ?? 'null')?.payer;
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(payer ?? '')) throw new Error('The saved purchase has no valid payer.');
    console.log(JSON.stringify(await reconcileRefund({ store, directory: resolve(root, '.local/live-buyer', payer),
      operation: values.operation, purchaseId: values.purchase, transaction: values.transaction })));
  } finally { store.close(); }
}
