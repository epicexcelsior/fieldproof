"""Validate one paid job and prepare exact bytes for a self-reported peaq activity event."""

import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import sys

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, utils

from scripts.peaq_rpc import BASE58, load_policy, validate_snapshot, _fields, _solana_recipient

JOB_FIELDS = frozenset({"schema", "job_id", "provider", "identity", "request", "receipt",
                        "receipt_sha256", "payment", "acceptance"})
PAYMENT_FIELDS = frozenset({"network", "asset", "recipient", "amount_base_units", "kind",
                            "transaction", "payer"})
NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
ASSET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
MAX_RAW = 16 * 1024


def canonical(value):
    def check(item):
        if isinstance(item, dict):
            if any(not isinstance(k, str) or not re.fullmatch(r"[A-Za-z0-9_]+\Z", k) for k in item):
                raise ValueError("job object keys must use ASCII letters, digits, and underscores")
            for child in item.values():
                check(child)
        elif isinstance(item, list):
            for child in item:
                check(child)
        elif type(item) is int and not -(2**53 - 1) <= item <= 2**53 - 1:
            raise ValueError("job integer exceeds the JavaScript safe range")
        elif type(item) is float:
            raise ValueError("job floats are not canonical")
        elif isinstance(item, str):
            item.encode("utf-8", errors="strict")
    check(value)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False).encode("utf-8")


def _solana_signature(value):
    if not isinstance(value, str) or not 64 <= len(value) <= 88 or any(c not in BASE58 for c in value):
        raise ValueError("payment transaction must be a full Solana base58 signature")
    number = 0
    for char in value:
        number = number * 58 + BASE58.index(char)
    raw = b"\0" * (len(value) - len(value.lstrip("1"))) + number.to_bytes((number.bit_length() + 7) // 8, "big")
    if len(raw) != 64 or raw == b"\0" * 64:
        raise ValueError("payment transaction must decode to 64 bytes")


def _verify_receipt(receipt, request, policy):
    required = {"protocol", "request_id", "status", "provider", "capability", "parameters", "nonce",
                "result", "started_at", "completed_at", "receipt_signature"}
    if not isinstance(receipt, dict) or not required.issubset(receipt):
        raise ValueError("receipt lacks required original fields")
    result = receipt["result"]
    if not isinstance(result, dict) or not {"metric", "sensor", "closed", "stable_samples", "total_samples"}.issubset(result):
        raise ValueError("receipt result lacks required original fields")
    if (receipt["protocol"] != "capmesh/0.1" or receipt["status"] != "success"
            or receipt["provider"] != policy["provider"] or receipt["capability"] != "state.observe"
            or receipt["request_id"] != request["id"] or receipt["nonce"] != request["nonce"]
            or receipt["parameters"] != {"location": request["location"]}
            or result["metric"] != "gate.closed" or result["sensor"] != policy["sensor"]
            or type(result["closed"]) is not bool or result["stable_samples"] != 5
            or result["total_samples"] != 5):
        raise ValueError("receipt does not match the approved contact request")
    start, end = receipt["started_at"], receipt["completed_at"]
    if (type(start) is not int or type(end) is not int or start > end
            or start < request["created_at"] - 2
            or end > request["created_at"] + 60):
        raise ValueError("receipt timing does not match request")
    signature = receipt["receipt_signature"]
    if not isinstance(signature, str) or not signature.startswith("v3:"):
        raise ValueError("receipt lacks the device P-256 signature")
    try:
        compact = base64.b64decode(signature[3:], validate=True)
        if len(compact) != 64 or base64.b64encode(compact).decode() != signature[3:]:
            raise ValueError("receipt signature is not canonical P-256 base64")
        digest = "|".join(str(x) for x in (
            "fieldproof-observation-v1", receipt["protocol"], receipt["request_id"], receipt["provider"],
            receipt["capability"], request["location"], receipt["nonce"], result["metric"], result["sensor"],
            int(result["closed"]), result["stable_samples"], result["total_samples"], start, end)).encode()
        public = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(),
                                                               bytes.fromhex(policy["receipt_public_key"]))
        r, s = int.from_bytes(compact[:32], "big"), int.from_bytes(compact[32:], "big")
        public.verify(utils.encode_dss_signature(r, s), digest, ec.ECDSA(hashes.SHA256()))
    except (ValueError, InvalidSignature) as error:
        raise ValueError("receipt P-256 signature verification failed") from error


def validate_job(job, policy, *, now=None):
    _fields(job, JOB_FIELDS, "job")
    if job["schema"] != "fieldproof-job-v1" or not isinstance(job["job_id"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}\Z", job["job_id"]):
        raise ValueError("job schema or ID is invalid")
    if job["provider"] != policy["provider"]:
        raise ValueError("job provider differs from policy")
    request = job["request"]
    _fields(request, {"id", "nonce", "created_at", "location", "max_age_seconds", "contact"}, "request")
    if (request["id"] != job["job_id"] or not re.fullmatch(r"[0-9a-f]{16}\Z", request["id"])
            or type(request["nonce"]) is not int or not 0 < request["nonce"] < 2**31
            or type(request["created_at"]) is not int or request["created_at"] <= 0
            or request["location"] != "demo-gate" or request["max_age_seconds"] != 10
            or request["contact"] != {"provider": policy["provider"], "sensor": policy["sensor"]}):
        raise ValueError("request challenge does not match the approved contact")
    acceptance = job["acceptance"]
    _fields(acceptance, {"accepted", "verified_at", "decision"}, "acceptance")
    if type(acceptance["verified_at"]) is not int or acceptance["verified_at"] <= 0:
        raise ValueError("acceptance verification time is invalid")
    validate_snapshot(job["identity"], policy, now=request["created_at"] if now is None else now)
    if job["identity"]["resolved_at"] > request["created_at"] + 2:
        raise ValueError("identity snapshot was resolved after the purchase request")
    receipt = job["receipt"]
    if job["receipt_sha256"] != hashlib.sha256(canonical(receipt)).hexdigest():
        raise ValueError("receipt digest differs from canonical receipt JSON")
    _verify_receipt(receipt, request, policy)
    payment = job["payment"]
    _fields(payment, PAYMENT_FIELDS, "payment")
    if (payment["network"] != NETWORK or payment["asset"] != ASSET
            or payment["recipient"] != policy["pay_to"] or payment["amount_base_units"] != "1000"
            or payment["kind"] != "test-token"):
        raise ValueError("payment terms differ from approved Devnet test-token terms")
    _solana_signature(payment["transaction"])
    _solana_recipient(payment["payer"])
    if payment["payer"] == policy["pay_to"]:
        raise ValueError("payment payer must differ from the approved recipient")
    if (acceptance["accepted"] is not True or type(acceptance["verified_at"]) is not int
            or acceptance["decision"] not in {"DISPATCH", "WAIT"}
            or acceptance["verified_at"] < receipt["completed_at"]
            or acceptance["verified_at"] - receipt["completed_at"] > request["max_age_seconds"]):
        raise ValueError("acceptance is missing, stale, or inconsistent")
    expected_decision = "WAIT" if receipt["result"]["closed"] else "DISPATCH"
    if acceptance["decision"] != expected_decision:
        raise ValueError("acceptance decision differs from contact policy")
    return job


def prepare(raw, policy, *, now=None):
    if len(raw) > MAX_RAW or not raw:
        raise ValueError("job raw bytes exceed the 16 KiB limit or are empty")
    job = json.loads(raw.decode("utf-8"))
    if raw != canonical(job):
        raise ValueError("job file must contain exact canonical JSON bytes without a trailing newline")
    validate_job(job, policy, now=now)
    from eth_utils import keccak
    metadata = canonical({"schema": "fieldproof-peaq-activity-v1", "job_id": job["job_id"],
                          "receipt_sha256": job["receipt_sha256"]})
    return {"schema": "fieldproof-peaq-event-preparation-v1", "machine_id": policy["machine_id"],
            "event_type": 1, "value": 1, "currency": "", "trust_level": 0,
            "source_chain_id": 0, "source_tx_hash": None, "timestamp": job["acceptance"]["verified_at"],
            "raw_data_utf8": raw.decode("utf-8"), "raw_data_sha256": hashlib.sha256(raw).hexdigest(),
            "data_hash": "0x" + keccak(raw).hex(), "metadata_utf8": metadata.decode("utf-8"),
            "settlement_proof": "not_checked_by_offline_preparation"}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", required=True)
    parser.add_argument("--raw", required=True, help="Exact canonical paid job JSON file")
    args = parser.parse_args(argv)
    try:
        print(json.dumps(prepare(Path(args.raw).read_bytes(), load_policy(args.policy)), sort_keys=True))
    except Exception as error:
        print(f"Event preparation failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
