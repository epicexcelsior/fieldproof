"""Buyer policy and finalized identity snapshot checks."""

from types import SimpleNamespace as Row
from importlib import import_module

import pytest

from scripts.peaq_rpc import CONTRACT_ROLES, validate_policy, validate_snapshot
from scripts.resolve_peaq_identity import authority_at_block, snapshot_from_state


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


def test_historical_authority_reads_exact_block_and_keeps_its_actual_time(monkeypatch):
    pytest.importorskip("peaq_os_sdk", reason="Run with the isolated peaq SDK")
    import scripts.resolve_peaq_identity as resolver
    sdk_state = import_module("peaq_os_sdk.tokenomics.get_machine_management_state")
    calls = []
    context = object()
    block = {"number": 42, "hash": Row(to_0x_hex=lambda: "0x" + "ab" * 32), "timestamp": 990}
    def pinned_read(**kwargs):
        calls.append(kwargs)
        return None, None, block, CONTRACTS, context
    def read_state(actual_context, machine_id):
        assert actual_context is context and machine_id == int(MACHINE)
        return _state()
    monkeypatch.setattr(resolver, "read_agung", pinned_read)
    monkeypatch.setattr(sdk_state, "get_machine_management_state", read_state)
    actual = authority_at_block(policy(), 42)
    assert calls == [{"block_number": 42}]
    assert actual == {"machine_id": MACHINE, "owner": OWNER, "controller": CONTROLLER,
                      "receipt_public_key": PIN, "finalized_block": 42,
                      "block_hash": "0x" + "ab" * 32, "block_timestamp": 990}


def test_historical_authority_rejects_a_different_registered_key(monkeypatch):
    pytest.importorskip("peaq_os_sdk", reason="Run with the isolated peaq SDK")
    import scripts.resolve_peaq_identity as resolver
    sdk_state = import_module("peaq_os_sdk.tokenomics.get_machine_management_state")
    state = _state()
    state.did_document.verification_methods[0].public_key_multibase = "zDifferent"
    monkeypatch.setattr(resolver, "read_agung", lambda **_kwargs: (None, None, {}, {}, None))
    monkeypatch.setattr(sdk_state, "get_machine_management_state", lambda *_args: state)
    with pytest.raises(ValueError, match="approved public receipt key"):
        authority_at_block(policy(), 42)
