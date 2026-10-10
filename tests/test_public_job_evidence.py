"""Public export byte bindings. All peaq state in these fixtures is synthetic."""

import copy
import hashlib
import json

import pytest

from scripts.public_job_evidence import public_evidence
from scripts.prepare_peaq_event import canonical, prepare
from test_peaq_job_event import recorded_job
from test_peaq_job_identity import policy


def manifest(*, confirmed=False):
    job = recorded_job()
    digest = hashlib.sha256(canonical(job)).hexdigest()
    payment = {"network": "Solana Devnet", "slot": 1, "transaction": job["payment"]["transaction"],
               "payer": job["payment"]["payer"], "merchant": policy()["pay_to"], "mint": job["payment"]["asset"],
               "payer_delta_base_units": "-1000", "merchant_delta_base_units": "1000", "decimals": 6}
    event = {"state": "pending", "transaction_hash": None, "data_hash": None, "reference": None, "confirmation": None}
    if confirmed:
        prepared = prepare(canonical(job), policy())
        transaction, registry = "0x" + "ab" * 32, "0x" + "cd" * 20
        event = {"state": "confirmed", "transaction_hash": transaction, "data_hash": prepared["data_hash"],
                 "reference": {"registry": registry, "index": 0, "journal": "PRIVATE FIXTURE"},
                 "confirmation": {"schema": "fieldproof-peaq-event-inspection-v1", "verified": True,
                                  "chain_id": 9990, "deployment_id": policy()["deployment_id"],
                                  "machine_id": policy()["machine_id"], "registry": registry,
                                  "registry_machine_binding": job["identity"]["contracts"]["machine_registry"],
                                  "index": 0, "event_count": 1, "data_hash": prepared["data_hash"],
                                  "job_sha256": digest, "raw_data_sha256": digest, "transaction_hash": transaction,
                                  "submission_block": 100, "finalized_block": 101, "block_hash": "0x" + "ef" * 32}}
    return {"schema": "fieldproof-evidence-manifest-v1", "job": job, "job_sha256": digest,
            "payment_verification": payment, "peaq_event": event, "commercial_revenue": False,
            "verification_note": "PRIVATE FIXTURE", "private_operator_metadata": "PRIVATE FIXTURE"}


def test_pending_public_export_preserves_signed_job_and_strips_private_metadata():
    source = manifest()
    exported = public_evidence(source, policy())
    assert canonical(exported["job"]) == canonical(source["job"])
    assert "PRIVATE FIXTURE" not in json.dumps(exported)
    assert "no independent live chain read" in exported["verification_note"]
    with pytest.raises(ValueError, match="confirmed event"):
        public_evidence(source, policy(), require_peaq=True)


@pytest.mark.parametrize("mutation", [
    lambda value: value.update(job_sha256="0" * 64),
    lambda value: value.update(commercial_revenue=True),
    lambda value: value["job"]["receipt"].update(authorization_ref="PRIVATE FIXTURE"),
    lambda value: value["job"]["receipt"].update(extra="PRIVATE FIXTURE"),
    lambda value: value["payment_verification"].update(merchant="11111111111111111111111111111111"),
    lambda value: value["payment_verification"].update(secret="PRIVATE FIXTURE"),
    lambda value: value["peaq_event"].update(state="confirmed"),
])
def test_public_export_rejects_changed_or_unsafe_evidence(mutation):
    source = manifest()
    mutation(source)
    # Keep the receipt hash current to prove the public-profile check rejects unsigned private fields.
    source["job"]["receipt_sha256"] = hashlib.sha256(canonical(source["job"]["receipt"])).hexdigest()
    source["job_sha256"] = hashlib.sha256(canonical(source["job"])).hexdigest() if source["job_sha256"] != "0" * 64 else "0" * 64
    with pytest.raises(ValueError):
        public_evidence(source, policy())


def test_confirmed_public_export_binds_both_recorded_readbacks_and_keeps_no_journal():
    pytest.importorskip("eth_utils", reason="The isolated SDK supplies event Keccak hashing")
    source = manifest(confirmed=True)
    exported = public_evidence(source, policy(), require_peaq=True)
    assert exported["peaq_event"]["state"] == "confirmed"
    assert set(exported["peaq_event"]["reference"]) == {"registry", "index"}
    assert "PRIVATE FIXTURE" not in json.dumps(exported)
    assert exported["commercial_revenue"] is False
    for mutation in [
        lambda value: value["peaq_event"].update(data_hash="0x" + "11" * 32),
        lambda value: value["peaq_event"]["confirmation"].update(machine_id="123"),
        lambda value: value["peaq_event"]["confirmation"].update(registry_machine_binding="0x" + "22" * 20),
        lambda value: value["peaq_event"]["confirmation"].update(finalized_block=99),
        lambda value: value["peaq_event"]["confirmation"].update(secret="PRIVATE FIXTURE"),
        lambda value: value["peaq_event"].update(state="pending"),
    ]:
        changed = copy.deepcopy(source)
        mutation(changed)
        with pytest.raises(ValueError):
            public_evidence(changed, policy(), require_peaq=True)
