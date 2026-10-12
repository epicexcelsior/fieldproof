import { buyObservation } from './buyer.js';
import { createJob } from './job.js';
import { loadProviderPolicy, resolveIdentity } from './peaq.js';
import { queryDevnetSettlement } from './devnet-rpc.js';

export async function performPaidJob({ signer, origin, policyPath, events, onProgress,
    resolve = () => resolveIdentity(policyPath), buy = buyObservation, verifyPayment = queryDevnetSettlement }) {
  const policy = await loadProviderPolicy(policyPath);
  const run = await buy(signer, origin, { contact: { provider: policy.provider, sensor: policy.sensor },
    receiptPublicKey: policy.receipt_public_key, peaq: { policy, resolve }, onProgress });
  const envelope = createJob(run, policy, run.peaq_identity);
  // Preserve the accepted identity/receipt before the independent RPC query can fail.
  events.enqueue(envelope, policy);
  let paymentVerification;
  try { paymentVerification = await verifyPayment(run); }
  catch (error) {
    throw new Error(`Payment settled but independent chain verification failed. Keep purchase ID ${run.purchase_id}. Job evidence is saved. No new payment or event submitted.`, { cause: error });
  }
  events.recordPayment(run.purchase_id, paymentVerification);
  const event = events.get(run.purchase_id);
  onProgress?.({ phase: 'activity-pending', purchase_id: run.purchase_id });
  return { ...run, job: envelope.job, job_sha256: envelope.sha256,
    payment_verification: paymentVerification, peaq_event: { state: event.state } };
}
