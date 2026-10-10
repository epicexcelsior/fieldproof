"""Registry discovery uses the finalized Agung peer and never a fallback."""

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
    environment(monkeypatch, "0x" + "00" * 20)
    monkeypatch.setattr(discovery, "bind_verified_registry", lambda *_args: pytest.fail("No guessed registry is allowed"))
    with pytest.raises(ValueError, match="EventRegistry peer"):
        discovery.discover()
