"""Registry discovery uses the finalized Agung peer and never a fallback."""

import json
from types import SimpleNamespace as Row

import pytest

import scripts.discover_peaq_event_registry as discovery


def environment(monkeypatch, address):
    pytest.importorskip("web3", reason="Run the registry check with the isolated peaq SDK")
    pytest.importorskip("peaq_os_sdk", reason="Run the registry check with the isolated peaq SDK")
    calls = []
    def peer(_key):
        def call(**kwargs):
            calls.append(kwargs)
            return address
        return Row(call=call)
    w3 = Row(eth=Row(contract=lambda **_kwargs: Row(functions=Row(peer=peer))), keccak=lambda **_kwargs: b"peer")
    contracts = {"info_desk": "0x" + "11" * 20, "machine_registry": "0x" + "22" * 20}
    block = {"number": 123, "hash": Row(to_0x_hex=lambda: "0x" + "33" * 32)}
    monkeypatch.setattr(discovery, "read_agung", lambda: (w3, Row(deployment_id="agung-2026-08-28"), block, contracts, None))
    return calls, contracts


def test_registry_discovery_uses_finalized_peer_and_machine_binding(monkeypatch):
    address = "0x" + "44" * 20
    calls, contracts = environment(monkeypatch, address)
    def bind(w3, block, configured, supplied):
        assert block["number"] == 123
        assert configured == contracts and supplied == address
        return Row(address=address), contracts["machine_registry"]
    monkeypatch.setattr(discovery, "bind_verified_registry", bind)
    result = discovery.discover()
    assert result["registry"] == address and result["signing"] is False
    assert calls == [{"block_identifier": 123}]


def test_absent_registry_peer_blocks_discovery(monkeypatch):
    calls, contracts = environment(monkeypatch, "0x" + "00" * 20)
    monkeypatch.setattr(discovery, "bind_verified_registry", lambda *_args: pytest.fail("No guessed registry is allowed"))
    with pytest.raises(discovery.RegistryPeerUnavailable, match="EventRegistry peer") as error:
        discovery.discover()
    evidence = error.value.evidence
    assert evidence["verified"] is False and evidence["reason"] == "peer_unset"
    assert evidence["info_desk"] == contracts["info_desk"] and evidence["machine_registry"] == contracts["machine_registry"]
    assert evidence["finalized_block"] == 123 and evidence["registry"] == "0x" + "00" * 20
    assert calls == [{"block_identifier": 123}]


def test_missing_peer_cli_preserves_public_diagnostic_without_claiming_no_deployment(monkeypatch, capsys):
    evidence = {"schema": "fieldproof-peaq-registry-discovery-v1", "verified": False,
                "reason": "peer_unset", "chain_id": 9990, "finalized_block": 123,
                "registry": "0x" + "00" * 20, "signing": False}
    def unavailable():
        raise discovery.RegistryPeerUnavailable(evidence)
    monkeypatch.setattr(discovery, "discover", unavailable)
    assert discovery.main() == 1
    output = capsys.readouterr()
    assert json.loads(output.out) == evidence
    assert "official Agung EventRegistry address" in output.err
    assert "No signing or fallback" in output.err
