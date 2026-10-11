"""Official provenance and live compatibility are separate registry gates."""

import json
from types import SimpleNamespace as Row

import pytest

import scripts.discover_peaq_event_registry as discovery
from scripts.inspect_peaq_event import (OFFICIAL_AGUNG_REGISTRY, RegistryBindingMismatch,
                                       bind_verified_registry)


def environment(monkeypatch, *, peer="0x" + "00" * 20, binding=None, code=b"deployed", paused=False):
    pytest.importorskip("web3", reason="Run with the isolated peaq SDK")
    pytest.importorskip("peaq_os_sdk", reason="Run with the isolated peaq SDK")
    calls = []
    contracts = {"info_desk": "0x" + "11" * 20, "machine_registry": "0x" + "22" * 20}
    def read(value):
        def call(**kwargs):
            calls.append(kwargs)
            return value
        return Row(call=call)
    registry = Row(address=OFFICIAL_AGUNG_REGISTRY, functions=Row(
        identityRegistryAddress=lambda: read(binding or contracts["machine_registry"]),
        paused=lambda: read(paused)))
    def contract(address, **_kwargs):
        if address.lower() == contracts["info_desk"].lower():
            return Row(functions=Row(peer=lambda _key: read(peer)))
        return registry
    w3 = Row(eth=Row(contract=contract, get_code=lambda *_args, **_kwargs: code),
             keccak=lambda *_args, **_kwargs: Row(to_0x_hex=lambda: "0x" + "44" * 32))
    block = {"number": 123, "hash": Row(to_0x_hex=lambda: "0x" + "33" * 32)}
    monkeypatch.setattr(discovery, "read_agung", lambda: (w3, Row(deployment_id="agung-2026-08-28"), block, contracts, None))
    return w3, block, contracts, calls


def test_official_registry_does_not_require_an_undocumented_infodesk_peer(monkeypatch):
    _w3, _block, contracts, calls = environment(monkeypatch)
    result = discovery.discover()
    assert result["verified"] is True and result["signing"] is False
    assert result["registry_machine_binding"] == contracts["machine_registry"]
    assert "d1f7e87" in result["source"]
    assert calls == [{"block_identifier": 123}] * 3


def test_published_legacy_registry_is_not_accepted_for_a_new_machine(monkeypatch):
    legacy = "0x9E9463a65c7B74623b3b6Cdc39F71be7274e5971"
    _w3, _block, contracts, _calls = environment(monkeypatch, binding=legacy)
    with pytest.raises(RegistryBindingMismatch, match="different identity registry") as error:
        discovery.discover()
    evidence = error.value.evidence
    assert evidence["verified"] is False and evidence["reason"] == "identity_registry_mismatch"
    assert evidence["registry_machine_binding"] == legacy
    assert evidence["expected_machine_registry"] == contracts["machine_registry"]
    assert evidence["finalized_block"] == 123 and evidence["signing"] is False


def test_unreviewed_address_without_matching_peer_is_rejected(monkeypatch):
    w3, block, contracts, _calls = environment(monkeypatch)
    with pytest.raises(ValueError, match="no reviewed official source"):
        bind_verified_registry(w3, block, contracts, "0x" + "55" * 20)


def test_matching_peer_still_requires_machine_binding_and_unpaused_registry(monkeypatch):
    address = "0x" + "55" * 20
    w3, block, contracts, _calls = environment(monkeypatch, peer=address)
    _registry, bound = bind_verified_registry(w3, block, contracts, address)
    assert bound == contracts["machine_registry"]
    w3, block, contracts, _calls = environment(monkeypatch, peer=address, paused=True)
    with pytest.raises(ValueError, match="paused"):
        bind_verified_registry(w3, block, contracts, address)


def test_no_bytecode_blocks_even_an_official_address(monkeypatch):
    environment(monkeypatch, code=b"")
    with pytest.raises(ValueError, match="no deployed EventRegistry code"):
        discovery.discover()


def test_cli_preserves_the_binding_error_and_exact_public_evidence(monkeypatch, capsys):
    evidence = {"verified": False, "reason": "identity_registry_mismatch", "signing": False}
    def mismatch(_address):
        raise RegistryBindingMismatch(evidence)
    monkeypatch.setattr(discovery, "discover", mismatch)
    assert discovery.main([]) == 1
    output = capsys.readouterr()
    assert json.loads(output.out) == evidence
    assert "legacy registry" in output.err and "No signing occurred" in output.err
