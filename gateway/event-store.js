// One outbox entry per delivered purchase. Recovery never automatically repeats a chain write.
import { createHash } from 'node:crypto';
import { canonicalJSON, verifyJob } from './job.js';
import { USDC, PAY_TO } from './constants.js';

export class EventStore {
  constructor(purchases) {
    this.purchases = purchases;
    this.db = purchases.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS peaq_events (
      purchase_id TEXT PRIMARY KEY REFERENCES purchases(id),
      job_utf8 TEXT NOT NULL, job_sha256 TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending','submitting','submitted','confirmed','uncertain')),
      transaction_hash TEXT UNIQUE, data_hash TEXT, confirmation TEXT, error TEXT,
      settlement_verified INTEGER NOT NULL DEFAULT 0, payment_verification TEXT, submission_reference TEXT,
      updated_at INTEGER NOT NULL);`);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const columns = this.db.prepare('PRAGMA table_info(peaq_events)').all();
      if (!columns.some(column => column.name === 'settlement_verified')) this.db.exec('ALTER TABLE peaq_events ADD COLUMN settlement_verified INTEGER NOT NULL DEFAULT 0');
      if (!columns.some(column => column.name === 'payment_verification')) this.db.exec('ALTER TABLE peaq_events ADD COLUMN payment_verification TEXT');
      if (!columns.some(column => column.name === 'submission_reference')) this.db.exec('ALTER TABLE peaq_events ADD COLUMN submission_reference TEXT');
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  enqueue({ job, raw, sha256 }, policy) {
    verifyJob(job, policy);
    if (raw !== canonicalJSON(job) || sha256 !== createHash('sha256').update(raw).digest('hex')) {
      throw new Error('Event input does not match the immutable job bytes');
    }
    const purchase = this.purchases.get(job.job_id);
    if (!purchase || purchase.state !== 'delivered' || !purchase.settlement || !purchase.result ||
        canonicalJSON(JSON.parse(purchase.result).receipt) !== canonicalJSON(job.receipt) ||
        JSON.parse(purchase.settlement).transaction !== job.payment.transaction) {
      throw new Error('Only the matching delivered purchase can enter the peaq event outbox');
    }
    this.db.prepare(`INSERT INTO peaq_events (purchase_id,job_utf8,job_sha256,state,updated_at)
      VALUES (?,?,?,'pending',?) ON CONFLICT(purchase_id) DO NOTHING`).run(job.job_id, raw, sha256, Date.now());
    const saved = this.get(job.job_id);
    if (saved.job_utf8 !== raw || saved.job_sha256 !== sha256) throw new Error('This purchase already binds different event evidence');
    return saved;
  }
  get(id) { return this.db.prepare('SELECT * FROM peaq_events WHERE purchase_id=?').get(id) ?? null; }
  list() { return this.db.prepare('SELECT * FROM peaq_events ORDER BY updated_at,purchase_id').all(); }
  recordPayment(id, readback) {
    const row = this.get(id), job = row && JSON.parse(row.job_utf8);
    if (!row || readback?.network !== 'Solana Devnet' || !Number.isSafeInteger(readback.slot) || readback.slot < 1 ||
        readback.transaction !== job.payment.transaction || readback.payer !== job.payment.payer ||
        readback.merchant !== PAY_TO || readback.mint !== USDC || readback.payer_delta_base_units !== '-1000' ||
        readback.merchant_delta_base_units !== '1000' || readback.decimals !== 6) {
      throw new Error('Independent Solana readback does not match this job payment');
    }
    this.db.prepare('UPDATE peaq_events SET settlement_verified=1,payment_verification=?,updated_at=? WHERE purchase_id=?')
      .run(JSON.stringify(readback), Date.now(), id);
  }
  claim(id) {
    // Persist intent before any signer or RPC submission. A crash here remains blocked for reconciliation.
    return this.db.prepare("UPDATE peaq_events SET state='submitting',updated_at=? WHERE purchase_id=? AND state='pending' AND settlement_verified=1")
      .run(Date.now(), id).changes === 1;
  }
  submitted(id, transactionHash, dataHash, reference = null) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash) || !/^0x[0-9a-fA-F]{64}$/.test(dataHash)) {
      throw new Error('Use complete EVM transaction and Keccak hashes');
    }
    const changed = this.db.prepare(`UPDATE peaq_events SET state='submitted',transaction_hash=?,data_hash=?,submission_reference=?,updated_at=?
      WHERE purchase_id=? AND state='submitting'`).run(transactionHash, dataHash, reference && JSON.stringify(reference), Date.now(), id).changes;
    if (changed !== 1) throw new Error('Event is not in the submitting state');
  }
  recordRecoveredSubmission(id, transactionHash, dataHash) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash) || !/^0x[0-9a-fA-F]{64}$/.test(dataHash)) {
      throw new Error('Use complete reconciled transaction and Keccak hashes');
    }
    // Explicit operator reconciliation. This method never sends or retries a transaction.
    const changed = this.db.prepare(`UPDATE peaq_events SET state='submitted',transaction_hash=?,data_hash=?,error=NULL,updated_at=?
      WHERE purchase_id=? AND state='uncertain' AND transaction_hash IS NULL`).run(transactionHash, dataHash, Date.now(), id).changes;
    if (changed !== 1) throw new Error('Only an interrupted submission without a saved hash can record recovered references');
  }
  uncertain(id, message = 'Reconcile the chain write before another submission.') {
    const changed = this.db.prepare(`UPDATE peaq_events SET state='uncertain',error=?,updated_at=?
      WHERE purchase_id=? AND state IN ('submitting','submitted')`).run(message.slice(0, 300), Date.now(), id).changes;
    if (changed !== 1) throw new Error('Only an attempted event requires submission reconciliation');
  }
  confirm(id, readback) {
    const saved = this.get(id);
    if (!saved || !['submitted', 'uncertain'].includes(saved.state) || !saved.transaction_hash ||
        readback?.verified !== true || readback.transaction_hash?.toLowerCase() !== saved.transaction_hash.toLowerCase() ||
        readback.data_hash?.toLowerCase() !== saved.data_hash.toLowerCase() || readback.job_sha256 !== saved.job_sha256 ||
        !Number.isSafeInteger(readback.finalized_block) || readback.finalized_block < 1) {
      throw new Error('Independent finalized event readback does not match this submission');
    }
    const changed = this.db.prepare(`UPDATE peaq_events SET state='confirmed',confirmation=?,error=NULL,updated_at=?
      WHERE purchase_id=? AND state IN ('submitted','uncertain')`).run(JSON.stringify(readback), Date.now(), id).changes;
    if (changed !== 1) throw new Error('Event state changed during confirmation');
  }
  recover() {
    return this.db.prepare(`UPDATE peaq_events SET state='uncertain',error='Interrupted submission. Reconcile before another write.',updated_at=?
      WHERE state='submitting'`).run(Date.now()).changes;
  }
}
