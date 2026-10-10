"""Buyer policy and finalized identity snapshot checks."""

from types import SimpleNamespace as Row

import pytest

from scripts.peaq_rpc import CONTRACT_ROLES, validate_policy, validate_snapshot
from scripts.resolve_peaq_identity import snapshot_from_state


PIN = "046218c52391433f9a687743192c5558a121320b8fa664931e5aaa1b6e5fbf342f9411913c8b72c91a3e7b9762e34e77955ed6035b81fa27ab7770dd8d4922ed63"
MACHINE = "2044618828586167349407969644236800133676464971368659651643404080491769435145"
OWNER = "0x1111111111111111111111111111111111111111"
CONTROLLER = "0x2222222222222222222222222222222222222222"
PAY_TO = "CaQAKBcwf7G5vXeu2RNuNGJafnJ8724Uj4wv9ivfxfQA"
CONTRACTS = {role: f"0x{i+1:040x}" for i, role in enumerate(sorted(CONTRACT_ROLES))}


def policy():
    return {"schema": "fieldproof-provider-policy-v1", "chain_id": 9990,
            "deployment_id": "agung-2026-08-28", "machine_id": MACHINE,
            "provider": "esp32-c6-96a2", "sensor": "gpio9-contact", "owner": OWNER,
            "controller": CONTROLLER, "receipt_public_key": PIN,
            "verification_method_id": "#receipt-key", "service_id": "#contact-observation",
            "service_type": "FieldProofBLEContactV1",
            "service_endpoint": "urn:fieldproof:ble-contact:esp32-c6-96a2:gpio9-contact:state.observe",
            "pay_to": PAY_TO, "max_identity_age_seconds": 120}


def snapshot(now=1000):
    return {"schema": "fieldproof-peaq-identity-v1", "chain_id": 9990,
            "deployment_id": "agung-2026-08-28", "machine_id": MACHINE,
            "owner": OWNER, "controller": CONTROLLER, "receipt_public_key": PIN,
            "key_id": "#receipt-key", "authentication": True,
            "service": {"id": "#contact-observation", "type": "FieldProofBLEContactV1",
                        "endpoint": policy()["service_endpoint"]},
            "subscription": "active", "available": True, "paused": False,
            "homed_locally": True, "relocating": False, "finalized_block": 10,
            "block_hash": "0x" + "ab" * 32, "block_timestamp": now,
            "resolved_at": now, "contracts": CONTRACTS, "peers_match": True}


def test_policy_rejects_unknown_fields_and_authority_changes():
    validate_policy(policy())
    for change in ({"extra": True}, {"max_identity_age_seconds": 500}, {"pay_to": "11111111111111111111111111111111"},
                   {"service_endpoint": "https://example.com"}, {"owner": "0x" + "0" * 40},
                   {"sensor": "gpio18-contact", "service_endpoint": policy()["service_endpoint"].replace("gpio9-contact", "gpio18-contact")}):
        with pytest.raises(ValueError):
            validate_policy({**policy(), **change})


def test_snapshot_rejects_stale_or_weakened_identity():
    validate_snapshot(snapshot(), policy(), now=1120)
    with pytest.raises(ValueError, match="stale"):
        validate_snapshot(snapshot(), policy(), now=1121)
    with pytest.raises(ValueError):
        validate_snapshot({**snapshot(), "block_timestamp": 879}, policy(), now=1000)
    with pytest.raises(ValueError):
        validate_snapshot({**snapshot(), "finalized_block": 0}, policy(), now=1000)
    for change in ({"owner": CONTROLLER}, {"authentication": False}, {"available": False},
                   {"peers_match": False}, {"service": {"id": "#contact-observation", "type": "Other",
                                                          "endpoint": policy()["service_endpoint"]}}):
        with pytest.raises(ValueError):
            validate_snapshot({**snapshot(), **change}, policy(), now=1001)


def _state():
    from scripts.prepare_peaq_identity import public_multikey
    method = Row(id="#receipt-key", method_type="Multikey", controller=CONTROLLER,
                 public_key_multibase=public_multikey(PIN))
    service = Row(id="#contact-observation", service_type="FieldProofBLEContactV1",
                  service_endpoint=policy()["service_endpoint"])
    did = Row(controller=CONTROLLER, authentication=(0,), verification_methods=(method,),
              service_endpoints=(service,))
    flags = Row(is_general_paused=False, is_technical_paused=False,
                is_operator_paused=False, is_subscription_paused=False)
    return Row(machine_id=int(MACHINE), owner=OWNER, controller=CONTROLLER,
               did_document=did, subscription=Row(status="active", machine_id=int(MACHINE)),
               pause_flags=flags, is_available=True, is_homed_locally=True, is_relocating=False)


def test_resolver_checks_authenticated_method_and_active_state():
    block = {"number": 10, "hash": Row(to_0x_hex=lambda: "0x" + "ab" * 32), "timestamp": 998}
    actual = snapshot_from_state(policy(), _state(), computed_id=int(MACHINE), block=block,
                                 contracts=CONTRACTS, resolved_at=1000)
    assert actual["authentication"] is True
    bad = _state()
    bad.did_document.authentication = ()
    with pytest.raises(ValueError, match="authentication"):
        snapshot_from_state(policy(), bad, computed_id=int(MACHINE), block=block,
                            contracts=CONTRACTS, resolved_at=1000)
    bad = _state()
    bad.is_relocating = True
    with pytest.raises(ValueError, match="unavailable"):
        snapshot_from_state(policy(), bad, computed_id=int(MACHINE), block=block,
                            contracts=CONTRACTS, resolved_at=1000)
