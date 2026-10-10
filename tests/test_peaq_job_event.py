"""Paid job byte binding and activity event readback checks."""

import copy
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace as Row

import pytest

from scripts.inspect_peaq_event import verify_event, verify_transaction
from scripts.peaq_rpc import read_request
from scripts.prepare_peaq_event import canonical, prepare
from test_peaq_job_identity import policy, snapshot


ROOT = Path(__file__).resolve().parents[1]


def recorded_job():
    recorded = json.loads((ROOT / "docs/evidence/device-signed-purchase-fast-20261005.json").read_text())
    challenge = recorded["challenge"]
    request = {**challenge, "contact": {"provider": policy()["provider"], "sensor": policy()["sensor"]}}
    receipt = recorded["receipt"]
    identity = snapshot(challenge["created_at"] - 1)
    payment = {"network": recorded["settlement"]["network"], "asset": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
               "recipient": policy()["pay_to"], "amount_base_units": "1000", "kind": "test-token",
               "transaction": recorded["settlement"]["transaction"], "payer": recorded["settlement"]["payer"]}
    return {"schema": "fieldproof-job-v1", "job_id": recorded["purchase_id"],
            "provider": policy()["provider"], "identity": identity, "request": request,
            "receipt": receipt, "receipt_sha256": hashlib.sha256(canonical(receipt)).hexdigest(),
            "payment": payment, "acceptance": {"accepted": True,
                                               "verified_at": receipt["completed_at"] + 1,
                                               "decision": "DISPATCH"}}


def test_historical_signed_receipt_prepares_exact_activity_bytes():
    pytest.importorskip("eth_utils", reason="Run the peaq SDK integration check in the isolated environment")
    job = recorded_job()
    raw = canonical(job)
    prepared = prepare(raw, policy())
    assert prepared["event_type"] == 1
    assert prepared["currency"] == ""
    assert prepared["trust_level"] == 0
    assert prepared["source_tx_hash"] is None
    assert prepared["raw_data_sha256"] == hashlib.sha256(raw).hexdigest()
    assert job["payment"]["transaction"] in prepared["raw_data_utf8"]
    event = (int(policy()["machine_id"]), 1, 1, prepared["timestamp"],
             bytes.fromhex(prepared["data_hash"][2:]), 0, 0, b"\0" * 32,
             prepared["metadata_utf8"].encode(), "")
    assert verify_event(event, prepared) is True
    changed = list(event)
    changed[4] = b"x" * 32
    with pytest.raises(ValueError, match="differs"):
        verify_event(changed, prepared)


def test_event_rejects_noncanonical_bytes_and_mismatched_receipt():
    job = recorded_job()
    with pytest.raises(ValueError, match="canonical"):
        prepare(json.dumps(job).encode() + b"\n", policy())
    job["receipt"]["result"]["closed"] = True
    job["receipt_sha256"] = hashlib.sha256(canonical(job["receipt"])).hexdigest()
    with pytest.raises(ValueError, match="signature"):
        prepare(canonical(job), policy())


@pytest.mark.parametrize("path,value", [
    (("provider",), "another"),
    (("payment", "recipient"), "11111111111111111111111111111111"),
    (("payment", "transaction"), "short"),
    (("payment", "amount_base_units"), "1001"),
    (("request", "nonce"), 7),
    (("identity", "owner"), "0x3333333333333333333333333333333333333333"),
])
def test_event_rejects_changed_authority_payment_or_challenge(path, value):
    job = recorded_job()
    target = job
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    with pytest.raises(ValueError):
        prepare(canonical(job), policy())


def test_transaction_read_guard_rejects_writes_and_malformed_hashes():
    sent = []
    sender = lambda method, params: sent.append((method, params))
    tx = "0x" + "ab" * 32
    read_request(sender, "eth_getTransactionReceipt", [tx], read_block=10)
    assert sent == [("eth_getTransactionReceipt", [tx])]
    with pytest.raises(PermissionError):
        read_request(sender, "eth_sendRawTransaction", [tx], read_block=10)
    with pytest.raises(ValueError):
        read_request(sender, "eth_getTransactionByHash", ["short"], read_block=10)


def test_event_transaction_requires_finalized_success_and_matching_log():
    tx = "0x" + "ab" * 32
    address = "0x" + "11" * 20
    log = {"address": address, "topics": [b"topic"]}
    transaction = {"blockNumber": 10, "to": address}
    receipt = {"blockNumber": 10, "status": 1, "to": address,
               "transactionHash": bytes.fromhex(tx[2:]), "logs": [log]}
    eth = Row(get_transaction=lambda _: transaction, get_transaction_receipt=lambda _: receipt)
    w3 = Row(eth=eth, keccak=lambda **_: b"topic")
    events = Row(EventSubmitted=lambda: Row(process_log=lambda _: {"args": {
        "machineId": int(policy()["machine_id"]), "eventIndex": 2,
        "eventType": 1, "value": 1}}))
    registry = Row(address=address, events=events)
    assert verify_transaction(w3, registry, tx, policy()["machine_id"], 2, 10) == 10
    receipt["status"] = 0
    with pytest.raises(ValueError, match="successful finalized"):
        verify_transaction(w3, registry, tx, policy()["machine_id"], 2, 10)
    receipt["status"] = 1
    transaction["blockNumber"] = 11
    with pytest.raises(ValueError, match="successful finalized"):
        verify_transaction(w3, registry, tx, policy()["machine_id"], 2, 10)
