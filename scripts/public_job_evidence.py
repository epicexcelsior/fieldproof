"""Validate and select public job evidence. This module never queries or writes a chain."""

import hashlib
import re

from scripts.prepare_peaq_event import canonical, prepare, validate_job

HASH = re.compile(r"0x[0-9a-fA-F]{64}\Z")
ADDRESS = re.compile(r"0x[0-9a-fA-F]{40}\Z")
PAYMENT_FIELDS = {"network", "slot", "transaction", "mint", "payer", "merchant",
                  "payer_delta_base_units", "merchant_delta_base_units", "decimals"}
CONFIRMATION_FIELDS = {"schema", "verified", "chain_id", "deployment_id", "machine_id", "registry",
                       "registry_machine_binding", "index", "event_count", "data_hash", "raw_data_sha256",
                       "job_sha256", "transaction_hash", "submission_block", "finalized_block", "block_hash"}
STORAGE_ADDRESS = "0x0000000000000000000000000000000000000801"
STORAGE_CONFIRMATION_FIELDS = {"schema", "route", "verified", "chain_id", "deployment_id", "machine_id",
                              "owner", "storage_address", "key_utf8", "value_utf8", "data_hash", "job_sha256",
                              "transaction_hash", "submission_block", "finalized_block", "block_hash",
                              "official_event_registry", "machine_credit_rating", "storage_mutable_by_owner",
                              "machine_authority_at_request_verified", "machine_authority_at_submission_verified"}
RECEIPT_REQUIRED = {"protocol", "request_id", "status", "provider", "capability", "parameters", "nonce",
                    "result", "started_at", "completed_at", "receipt_signature"}
RECEIPT_NULLABLE = {"authorization_ref", "delivery_proof", "error"}


def _hash(value):
    return isinstance(value, str) and HASH.fullmatch(value) is not None and int(value[2:], 16) != 0


def _address(value):
    return isinstance(value, str) and ADDRESS.fullmatch(value) is not None and int(value[2:], 16) != 0


def _positive(value):
    return type(value) is int and 0 < value <= 2**53 - 1


def public_evidence(manifest, policy, *, require_peaq=False):
    """Reject unsafe originals. Keep original signed job bytes and strip private outbox metadata."""
    if (not isinstance(manifest, dict) or manifest.get("schema") != "fieldproof-evidence-manifest-v1"
            or manifest.get("commercial_revenue") is not False):
        raise ValueError("Use a saved test-token evidence manifest. Commercial revenue must remain false.")
    job = manifest.get("job")
    validate_job(job, policy)
    receipt = job["receipt"]
    if (set(receipt) - RECEIPT_REQUIRED - RECEIPT_NULLABLE
            or any(receipt.get(name) is not None for name in RECEIPT_NULLABLE)
            or set(receipt["result"]) != {"metric", "sensor", "closed", "stable_samples", "total_samples"}):
        raise ValueError("The original receipt contains fields outside the reviewed public contact profile. Do not rewrite it.")
    raw = canonical(job)
    digest = hashlib.sha256(raw).hexdigest()
    if manifest.get("job_sha256") != digest:
        raise ValueError("Manifest job hash differs from the unchanged canonical job.")
    payment = manifest.get("payment_verification")
    if payment is not None:
        if not isinstance(payment, dict) or set(payment) != PAYMENT_FIELDS:
            raise ValueError("Payment readback contains unsupported fields.")
        expected = {"network": "Solana Devnet", "transaction": job["payment"]["transaction"],
                    "mint": job["payment"]["asset"], "payer": job["payment"]["payer"],
                    "merchant": job["payment"]["recipient"], "payer_delta_base_units": "-1000",
                    "merchant_delta_base_units": "1000", "decimals": 6}
        if not _positive(payment["slot"]) or any(payment[name] != value for name, value in expected.items()):
            raise ValueError("Payment readback differs from the saved job.")
    event = manifest.get("peaq_event")
    if not isinstance(event, dict) or event.get("state") not in {"pending", "submitting", "submitted", "uncertain", "confirmed"}:
        raise ValueError("Use an explicit saved peaq event state.")
    state = event["state"]
    transaction, data_hash = event.get("transaction_hash"), event.get("data_hash")
    reference, confirmation = event.get("reference"), event.get("confirmation")
    public_reference = None
    if transaction is not None:
        if state not in {"submitted", "uncertain", "confirmed"}:
            raise ValueError("Pending event states cannot claim a submitted transaction.")
        if not _hash(transaction) or not _hash(data_hash):
            raise ValueError("Event transaction and data hashes must be complete.")
        if isinstance(reference, dict) and reference.get("route") == "storage":
            if (reference.get("storage_address") != STORAGE_ADDRESS
                    or reference.get("key_utf8") != f'fieldproof.job:{job["job_id"]}'):
                raise ValueError("Storage reference changes the official precompile or paid job key.")
            public_reference = {"route": "storage", "storage_address": STORAGE_ADDRESS,
                                "key_utf8": reference["key_utf8"]}
        else:
            if not isinstance(reference, dict) or not _address(reference.get("registry")) or type(reference.get("index")) is not int or reference["index"] < 0:
                raise ValueError("The event requires its reviewed registry and index.")
            public_reference = {"registry": reference["registry"], "index": reference["index"]}
        # The isolated peaq SDK supplies eth_utils. Core static exports do not need it.
        expected_hash = prepare(raw, policy)["data_hash"]
        if data_hash.lower() != expected_hash.lower():
            raise ValueError("Event data hash does not commit the exact original job bytes.")
    elif data_hash is not None or reference is not None or confirmation is not None or state in {"submitted", "confirmed"}:
        raise ValueError("Event metadata has no matching transaction reference.")
    if state == "confirmed":
        storage = public_reference.get("route") == "storage"
        fields = STORAGE_CONFIRMATION_FIELDS if storage else CONFIRMATION_FIELDS
        if payment is None or not isinstance(confirmation, dict) or set(confirmation) != fields:
            raise ValueError("Confirmed evidence requires complete recorded payment and peaq readbacks.")
        expected = {"schema": "fieldproof-peaq-storage-inspection-v1" if storage else "fieldproof-peaq-event-inspection-v1",
                    "verified": True, "chain_id": 9990,
                    "deployment_id": policy["deployment_id"], "machine_id": policy["machine_id"],
                    "job_sha256": digest}
        if storage:
            expected.update({"route": "storage", "storage_address": STORAGE_ADDRESS,
                             "key_utf8": public_reference["key_utf8"],
                             "value_utf8": canonical({"v": 1, "machine_id": policy["machine_id"],
                                                      "data_hash": expected_hash}).decode(),
                             "official_event_registry": False, "machine_credit_rating": False,
                             "storage_mutable_by_owner": True, "machine_authority_at_request_verified": True,
                             "machine_authority_at_submission_verified": True})
        else:
            expected.update({"index": public_reference["index"], "raw_data_sha256": digest})
        if (any(confirmation[name] != value or type(confirmation[name]) is not type(value) for name, value in expected.items())
                or (not storage and (not _positive(confirmation["event_count"]) or confirmation["event_count"] <= confirmation["index"]))
                or not _positive(confirmation["submission_block"]) or not _positive(confirmation["finalized_block"])
                or confirmation["submission_block"] > confirmation["finalized_block"] or not _hash(confirmation["block_hash"])):
            raise ValueError("Recorded peaq readback fields do not match this job.")
        authority = [("owner", policy["owner"])] if storage else [
            ("registry", public_reference["registry"]),
            ("registry_machine_binding", job["identity"]["contracts"]["machine_registry"])]
        for name, expected_value in authority + [("transaction_hash", transaction), ("data_hash", data_hash)]:
            if not isinstance(confirmation[name], str) or confirmation[name].lower() != expected_value.lower():
                raise ValueError("Recorded peaq readback authority or hashes differ from the saved job.")
    elif confirmation is not None:
        raise ValueError("Unconfirmed evidence cannot carry a confirmed readback.")
    if require_peaq and state != "confirmed":
        raise ValueError("The peaq release gate requires a confirmed event with matching recorded readbacks.")
    return {"schema": "fieldproof-evidence-manifest-v1", "job": job, "job_sha256": digest,
            "payment_verification": payment,
            "peaq_event": {"state": state, "transaction_hash": transaction, "data_hash": data_hash,
                           "reference": public_reference, "confirmation": confirmation},
            "commercial_revenue": False,
            "verification_note": "Recorded evidence. This export validates signatures and byte bindings. It performs no independent live chain read."}
