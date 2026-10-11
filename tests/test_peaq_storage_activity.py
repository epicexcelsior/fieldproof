"""Exact peaq Storage activity binding, bounded signing, and read-only recovery."""

import copy
import json
from types import SimpleNamespace as Row

import pytest

pytest.importorskip("web3", reason="Run Storage integration checks in the isolated peaq SDK environment")
from web3 import Web3
from web3.datastructures import AttributeDict
from web3.exceptions import Web3RPCError, ContractLogicError
from eth_abi import encode

from scripts import peaq_operator as operator
from scripts import peaq_storage_activity as storage
from scripts import resolve_peaq_identity as identity
from scripts.prepare_peaq_event import canonical
from test_peaq_job_event import recorded_job
from test_peaq_job_identity import policy


TX = "0x" + "ab" * 32
BLOCK_HASH = bytes.fromhex("cd" * 32)


def prepared():
    return storage.prepare_storage(canonical(recorded_job()), policy())


def test_storage_preparation_binds_canonical_job_and_documented_limits():
    raw = canonical(recorded_job())
    result = storage.prepare_storage(raw, policy())
    assert result["key_utf8"] == "fieldproof.job:" + recorded_job()["job_id"]
    assert result["raw_data_utf8"].encode() == raw
    assert len(result["key_utf8"].encode()) <= 64
    assert len(result["value_utf8"].encode()) <= 256
    assert json.loads(result["value_utf8"]) == {
        "v": 1, "machine_id": policy()["machine_id"], "data_hash": "0x" + Web3.keccak(raw).hex()}
    assert result["official_event_registry"] is False
    assert result["machine_credit_rating"] is False
    assert result["machine_authority_at_request_verified"] is False
    with pytest.raises(ValueError, match="canonical"):
        storage.prepare_storage(raw + b"\n", policy())
    job = recorded_job()
    job["receipt"]["result"]["closed"] = not job["receipt"]["result"]["closed"]
    with pytest.raises(ValueError):
        storage.prepare_storage(canonical(job), policy())


def _contract(get_item):
    real = storage.storage_contract(Web3())
    return Row(address=real.address, events=real.events, functions=Row(
        addItem=real.functions.addItem,
        getItem=lambda owner, key: Row(call=lambda **kwargs: get_item(owner, key, kwargs["block_identifier"]))))


def _missing(*_args):
    raise Web3RPCError("missing", rpc_response={"error": {"data": storage.MISSING_ITEM_REVERT}})


def test_absence_requires_exact_abi_revert_and_preserves_read_block():
    seen = []
    def missing(owner, key, block):
        seen.append((owner, key, block))
        _missing()
    assert storage.ensure_absent(_contract(missing), policy()["owner"], "new-key", 123) is True
    assert seen == [(policy()["owner"], b"new-key", 123)]
    for failure in (TimeoutError("Cannot find the item"),
                    ContractLogicError("revert Cannot find the item", data="0xdeadbeef"),
                    Web3RPCError("Cannot find the item", rpc_response={"error": {"data": "0xdeadbeef"}})):
        def bad(*_args):
            raise failure
        with pytest.raises(ValueError, match="absence is unverified"):
            storage.ensure_absent(_contract(bad), policy()["owner"], "new-key", 123)
    with pytest.raises(ValueError, match="already has"):
        storage.ensure_absent(_contract(lambda *_args: b"existing"), policy()["owner"], "new-key", 123)


def test_readiness_probe_names_its_limited_scope_and_never_claims_a_job(monkeypatch):
    calls = []
    block = {"number": 123, "hash": BLOCK_HASH}
    monkeypatch.setattr(storage, "read_agung", lambda: (None, Row(deployment_id=policy()["deployment_id"]), block, {}, None))
    monkeypatch.setattr(storage, "bind_storage", lambda *_args: object())
    monkeypatch.setattr(storage, "ensure_absent", lambda _contract, owner, key, number: calls.append((owner, key, number)))
    result = storage.probe_storage(policy())
    assert calls == [(policy()["owner"], "fieldproof.probe:v1", 123)]
    assert result["scope"] == "interface_probe_only"
    assert result["chain_write"] is False and result["signing"] is False
    assert result["identity_checked"] is False and result["settlement_checked"] is False


def _transaction_fixture():
    p = prepared()
    contract = storage.storage_contract(Web3())
    input_data = contract.functions.addItem(p["key_utf8"].encode(), p["value_utf8"].encode())._encode_transaction_data()
    transaction = {"hash": bytes.fromhex(TX[2:]), "from": p["owner"], "to": storage.STORAGE_ADDRESS,
                   "value": 0, "input": bytes.fromhex(input_data[2:]), "blockNumber": 20,
                   "blockHash": BLOCK_HASH, "chainId": 9990}
    log = {"address": storage.STORAGE_ADDRESS, "topics": [Web3.keccak(text="ItemAdded(address,bytes,bytes)")],
           "data": encode(["address", "bytes", "bytes"], [p["owner"], p["key_utf8"].encode(), p["value_utf8"].encode()]),
           "transactionHash": bytes.fromhex(TX[2:]), "transactionIndex": 0, "blockHash": BLOCK_HASH,
           "blockNumber": 20, "logIndex": 0, "removed": False}
    receipt = {"from": p["owner"], "to": storage.STORAGE_ADDRESS, "blockNumber": 20, "blockHash": BLOCK_HASH,
               "status": 1, "transactionHash": bytes.fromhex(TX[2:]), "logs": [log]}
    w3 = Row(keccak=Web3.keccak, eth=Row(get_transaction=lambda _: AttributeDict(transaction),
             get_transaction_receipt=lambda _: AttributeDict(receipt), get_block=lambda _: {"hash": BLOCK_HASH}))
    return p, contract, transaction, receipt, w3


def test_exact_owner_add_transaction_and_finalized_log_are_required():
    p, contract, transaction, receipt, w3 = _transaction_fixture()
    assert storage.verify_storage_transaction(w3, contract, TX, p, 100) == 20
    for change in ({"from": "0x" + "33" * 20}, {"to": "0x" + "22" * 20}, {"value": 1},
                   {"input": b"bad"}, {"blockNumber": 101}, {"blockHash": b"x" * 32},
                   {"hash": b"x" * 32}, {"chainId": 3338}):
        saved = copy.deepcopy(transaction)
        transaction.update(change)
        with pytest.raises(ValueError):
            storage.verify_storage_transaction(w3, contract, TX, p, 100)
        transaction.clear()
        transaction.update(saved)
    receipt["status"] = 0
    with pytest.raises(ValueError, match="successful finalized"):
        storage.verify_storage_transaction(w3, contract, TX, p, 100)
    receipt["status"] = 1
    receipt["logs"].append(copy.deepcopy(receipt["logs"][0]))
    with pytest.raises(ValueError, match="exactly one"):
        storage.verify_storage_transaction(w3, contract, TX, p, 100)


def test_inspection_checks_get_item_bytes_and_original_transaction(monkeypatch):
    p, _real, transaction, receipt, w3 = _transaction_fixture()
    seen = []
    def get_item(owner, key, block):
        seen.append((owner, key, block))
        return p["value_utf8"].encode()
    contract = _contract(get_item)
    block = {"number": 100, "hash": BLOCK_HASH}
    monkeypatch.setattr(storage, "read_agung", lambda: (w3, None, block, {}, None))
    monkeypatch.setattr(storage, "bind_storage", lambda *_args: contract)
    authority_calls = []
    def authority_at_block(_policy, selected):
        authority_calls.append(selected)
        original = recorded_job()["identity"]
        return {**policy(), "finalized_block": selected,
                "block_hash": original["block_hash"] if selected == original["finalized_block"] else "0x" + BLOCK_HASH.hex(),
                "block_timestamp": original["block_timestamp"]}
    monkeypatch.setattr(identity, "authority_at_block", authority_at_block, raising=False)
    result = storage.inspect_storage(canonical(recorded_job()), policy(), TX)
    assert result["verified"] is True
    assert result["submission_block"] == 20
    assert result["finalized_block"] == 100
    assert result["storage_mutable_by_owner"] is True
    assert result["machine_authority_at_submission_verified"] is True
    assert result["machine_authority_at_request_verified"] is True
    assert authority_calls == [10, 20]
    assert seen == [(policy()["owner"], p["key_utf8"].encode(), 100)]
    def wrong_submission_authority(_policy, selected):
        actual = authority_at_block(_policy, selected)
        if selected == 20:
            actual["owner"] = "0x" + "33" * 20
        return actual
    monkeypatch.setattr(identity, "authority_at_block", wrong_submission_authority)
    with pytest.raises(ValueError, match="machine authority"):
        storage.inspect_storage(canonical(recorded_job()), policy(), TX)
    monkeypatch.setattr(storage, "bind_storage", lambda *_args: _contract(lambda *_args: b"changed"))
    with pytest.raises(ValueError, match="Storage bytes differ"):
        storage.inspect_storage(canonical(recorded_job()), policy(), TX)


def _mock_preflight(monkeypatch):
    raw = canonical(recorded_job())
    original = recorded_job()["identity"]
    monkeypatch.setattr(identity, "authority_at_block", lambda _policy, selected: {
        **policy(), "finalized_block": selected, "block_hash": original["block_hash"],
        "block_timestamp": original["block_timestamp"]})
    monkeypatch.setattr(storage, "resolve", lambda _policy: {"machine_id": policy()["machine_id"], "owner": policy()["owner"]})
    monkeypatch.setattr(storage, "verify_solana_settlement", lambda _job: {"slot": 42})
    contract = _contract(_missing)
    block = {"number": 100, "hash": BLOCK_HASH}
    readonly = Row(eth=Row(get_code=lambda *_args, **_kwargs: bytes.fromhex("60006000fd")))
    monkeypatch.setattr(storage, "read_agung", lambda: (readonly, None, block, {}, None))
    monkeypatch.setattr(storage, "storage_contract", lambda _w3: contract)
    return raw, block, contract


@pytest.mark.parametrize("change", [
    {"block_timestamp": recorded_job()["identity"]["block_timestamp"] + 86400},
    {"block_hash": "0x" + "77" * 32},
    {"owner": "0x" + "33" * 20},
    {"controller": "0x" + "33" * 20},
    {"receipt_public_key": "04" + "99" * 64},
])
def test_forged_earlier_identity_rejects_preparation_write_and_independent_readback(monkeypatch, change):
    raw, _block, _contract_ = _mock_preflight(monkeypatch)
    original = recorded_job()["identity"]
    monkeypatch.setattr(identity, "authority_at_block", lambda _policy, selected: {
        **policy(), "finalized_block": selected, "block_hash": original["block_hash"],
        "block_timestamp": original["block_timestamp"], **change})
    monkeypatch.setattr(storage, "_operator_web3", lambda: pytest.fail("forged historical identity reached operator"))
    monkeypatch.setattr(storage, "_load_account", lambda *_args: pytest.fail("forged historical identity accessed key"))
    monkeypatch.setattr(storage, "read_agung", lambda: pytest.fail("forged historical identity reached storage inspection"))
    with pytest.raises(ValueError, match="original identity snapshot"):
        storage.prepare_verified_storage(raw, policy())
    with pytest.raises(ValueError, match="original identity snapshot"):
        storage.execute_storage(raw, policy(), 1200, "unused", "unused")
    with pytest.raises(ValueError, match="original identity snapshot"):
        storage.inspect_storage(raw, policy(), TX)


def test_preview_never_loads_key_or_creates_journal_and_reports_complete_fee(monkeypatch):
    # Capture the real ABI contract before the dependency seam replaces it.
    real = storage.storage_contract(Web3())
    raw, _block, contract = _mock_preflight(monkeypatch)
    functions = Row(getItem=contract.functions.getItem, addItem=lambda key, value: Row(
        call=lambda *_args, **_kwargs: True,
        _encode_transaction_data=lambda: real.functions.addItem(key, value)._encode_transaction_data()))
    monkeypatch.setattr(storage, "storage_contract", lambda _w3: Row(address=storage.STORAGE_ADDRESS, functions=functions))
    w3 = Row(eth=Row(estimate_gas=lambda _: 100, gas_price=10, get_balance=lambda *_args: 10**18))
    monkeypatch.setattr(storage, "_operator_web3", lambda: (w3, object()))
    monkeypatch.setattr(storage, "_load_account", lambda *_args: pytest.fail("preview accessed a private key"))
    monkeypatch.setattr(storage, "PrivateJournal", lambda *_args: pytest.fail("preview created a signer journal"))
    result = storage.preview_storage(raw, policy(), 1200)
    assert result["estimated_gas"] == 100
    assert result["gas_limit"] == 120
    assert result["gas_ceiling_wei"] == "1200"
    assert result["signing"] is False
    assert result["native_value_wei"] == "0"
    assert result["solana_payment_slot"] == 42
    with pytest.raises(ValueError, match="gas ceiling before signing"):
        storage.preview_storage(raw, policy(), 1199)


def test_write_gates_identity_payment_duplicate_and_gas_before_key_access(monkeypatch):
    raw, _block, _contract_ = _mock_preflight(monkeypatch)
    monkeypatch.setattr(storage, "_load_account", lambda *_args: pytest.fail("blocked write accessed key"))
    for cap in (0, storage.MAX_STORAGE_GAS_WEI + 1):
        with pytest.raises(ValueError):
            storage.execute_storage(raw, policy(), cap, "unused", "unused")
    monkeypatch.setattr(storage, "resolve", lambda _policy: {"machine_id": "1", "owner": policy()["owner"]})
    with pytest.raises(ValueError, match="current machine identity"):
        storage.execute_storage(raw, policy(), 1200, "unused", "unused")
    monkeypatch.setattr(storage, "resolve", lambda _policy: {"machine_id": policy()["machine_id"], "owner": policy()["owner"]})
    def unpaid(_job):
        raise ValueError("no finalized Solana settlement")
    monkeypatch.setattr(storage, "verify_solana_settlement", unpaid)
    with pytest.raises(ValueError, match="Solana settlement"):
        storage.execute_storage(raw, policy(), 1200, "unused", "unused")
    monkeypatch.setattr(storage, "verify_solana_settlement", lambda _job: {"slot": 42})
    duplicate = Row(address=storage.STORAGE_ADDRESS, functions=Row(
        getItem=lambda *_args: Row(call=lambda **_kwargs: b"existing")))
    monkeypatch.setattr(storage, "storage_contract", lambda _w3: duplicate)
    with pytest.raises(ValueError, match="already has"):
        storage.execute_storage(raw, policy(), 1200, "unused", "unused")


@pytest.mark.parametrize("response_lost", [True, False])
def test_execute_journals_before_single_send_and_preserves_uncertain_hash(tmp_path, monkeypatch, response_lost):
    real = storage.storage_contract(Web3())
    raw, block, contract = _mock_preflight(monkeypatch)
    functions = Row(getItem=contract.functions.getItem, addItem=lambda key, value: Row(
        call=lambda *_args, **_kwargs: True,
        _encode_transaction_data=lambda: real.functions.addItem(key, value)._encode_transaction_data()))
    monkeypatch.setattr(storage, "storage_contract", lambda _w3: Row(address=storage.STORAGE_ADDRESS, functions=functions))
    root = tmp_path / "journals"
    monkeypatch.setattr(operator, "JOURNAL_ROOT", root)
    path = root / "storage-fixture.jsonl"
    signed_raw = b"test-only-signed-storage-transaction"
    expected_hash = "0x" + Web3.keccak(signed_raw).hex()
    calls = []
    def approve(data):
        entries = [json.loads(line) for line in path.read_text().splitlines()]
        assert data == signed_raw
        assert entries[-1]["status"] == "signed_before_broadcast"
        assert entries[-1]["transaction_hash"] == expected_hash
        calls.append("authorized_after_sync")
    def send(data):
        assert calls == ["authorized_after_sync"]
        calls.append("sent")
        return Web3.keccak(data)
    def receipt(*_args, **_kwargs):
        if response_lost:
            raise TimeoutError("receipt response unavailable after broadcast")
        return {"status": 1, "to": storage.STORAGE_ADDRESS, "blockNumber": 10}
    w3 = Row(eth=Row(estimate_gas=lambda _: 100, gas_price=10, get_balance=lambda *_args: 10**18,
                    get_transaction_count=lambda *_args: 7, send_raw_transaction=send,
                    wait_for_transaction_receipt=receipt))
    monkeypatch.setattr(storage, "_operator_web3", lambda: (w3, Row(approve_once=approve)))
    monkeypatch.setattr(storage, "_load_account", lambda *_args: Row(sign_transaction=lambda _tx: Row(raw_transaction=signed_raw)))
    if response_lost:
        with pytest.raises(TimeoutError):
            storage.execute_storage(raw, policy(), 1200, "test-fixture", path)
    else:
        inspected = {"schema": "fieldproof-peaq-storage-inspection-v1", "verified": True, "finalized_block": 100,
                     "transaction_hash": expected_hash, "key_utf8": prepared()["key_utf8"]}
        def independent_inspection(exact_raw, approved_policy, selected_transaction):
            assert exact_raw == raw and approved_policy == policy() and selected_transaction == expected_hash
            calls.append("independently_inspected")
            return inspected
        monkeypatch.setattr(storage, "inspect_storage", independent_inspection)
        result = storage.execute_storage(raw, policy(), 1200, "test-fixture", path)
        assert result["status"] == "finalized_and_inspected"
        assert result["journal"] == path.name
    entries = [json.loads(line) for line in path.read_text().splitlines()]
    assert entries[-1]["status"] == ("broadcast_hash_returned" if response_lost else "finalized_and_inspected")
    assert entries[-1]["transaction_hash"] == expected_hash
    assert calls == ["authorized_after_sync", "sent"] + ([] if response_lost else ["independently_inspected"])
    assert path.stat().st_mode & 0o777 == 0o600
