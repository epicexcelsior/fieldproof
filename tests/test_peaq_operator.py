"""Operator limits and recovery records, with no network or private key."""

import json
import io
from pathlib import Path
from types import SimpleNamespace as Row

import pytest

import scripts.peaq_operator as operator
from test_peaq_job_event import recorded_job
from test_peaq_job_identity import policy


def _transaction(*, target="0x" + "11" * 20, data="0xdeadbeef", gas=100, price=2):
    return {"chainId": 9990, "from": policy()["owner"], "nonce": 1, "value": 0,
            "to": target, "data": data, "gas": gas, "gasPrice": price}


def test_signing_limit_rejects_wrong_call_and_aggregate_fee():
    target = "0x" + "11" * 20
    approved = {"activation": target, "activation_data": "0xdeadbeef"}
    phase, maximum = operator.check_signing_transaction(
        _transaction(), owner=policy()["owner"], chain_id=9990, targets=approved,
        signed_phases=set(), spent_gas=0, max_total_gas_wei=200)
    assert (phase, maximum) == ("activation", 200)
    for transaction in (_transaction(target="0x" + "22" * 20),
                        {**_transaction(), "chainId": 3338},
                        {**_transaction(), "value": 1}):
        with pytest.raises(ValueError):
            operator.check_signing_transaction(transaction, owner=policy()["owner"], chain_id=9990,
                                               targets=approved, signed_phases=set(), spent_gas=0,
                                               max_total_gas_wei=200)
    with pytest.raises(ValueError, match="aggregate gas"):
        operator.check_signing_transaction(_transaction(), owner=policy()["owner"], chain_id=9990,
                                           targets=approved, signed_phases=set(), spent_gas=1,
                                           max_total_gas_wei=200)
    with pytest.raises(ValueError, match="already signed"):
        operator.check_signing_transaction(_transaction(), owner=policy()["owner"], chain_id=9990,
                                           targets=approved, signed_phases={"activation"}, spent_gas=0,
                                           max_total_gas_wei=400)


def test_approval_must_bind_spender_and_amount():
    token = "0x" + "11" * 20
    spender = "0x" + "22" * 20
    data = operator.APPROVE_SELECTOR + "0" * 24 + spender[2:] + f"{1000:064x}"
    targets = {"approval": token, "spender": spender, "max_net": 1000,
               "expected_approval_amount": 1000}
    assert operator.check_signing_transaction(
        _transaction(target=token, data=data), owner=policy()["owner"], chain_id=9990,
        targets=targets, signed_phases=set(), spent_gas=0, max_total_gas_wei=400)[0] == "approval"
    with pytest.raises(ValueError):
        operator.check_signing_transaction(_transaction(target=token, data=data[:-1] + "1"),
                                           owner=policy()["owner"], chain_id=9990,
                                           targets=targets, signed_phases=set(), spent_gas=0,
                                           max_total_gas_wei=400)


def test_event_write_validates_gas_bound_before_any_other_work():
    with pytest.raises(ValueError, match="max_total_gas_wei"):
        operator.execute_event(policy(), b"{}", "0x" + "11" * 20, 0, "unused", "unused")


def test_solana_rpc_requires_bounded_correlated_response(monkeypatch):
    for body in (json.dumps({"jsonrpc": "2.0", "id": 2, "result": {}}).encode(),
                 json.dumps({"jsonrpc": "2.0", "id": True, "result": {}}).encode(),
                 json.dumps({"jsonrpc": "2.0", "id": 1, "error": None}).encode(),
                 b" " * 262145):
        monkeypatch.setattr(operator, "urlopen", lambda *_args, **_kwargs: io.BytesIO(body))
        with pytest.raises(ValueError, match="RPC"):
            operator.verify_solana_settlement(recorded_job())


def test_private_journal_is_exclusive_and_permissions_are_private(tmp_path, monkeypatch):
    root = tmp_path / "journals"
    monkeypatch.setattr(operator, "JOURNAL_ROOT", root)
    path = root / "test.jsonl"
    journal = operator.PrivateJournal(path)
    try:
        journal.append({"phase": "event", "status": "signed_before_broadcast", "transaction_hash": "0xabc"})
        assert path.stat().st_mode & 0o777 == 0o600
        assert json.loads(path.read_text())["status"] == "signed_before_broadcast"
        with pytest.raises(FileExistsError):
            operator.PrivateJournal(path)
    finally:
        journal.close()


def test_key_loader_rejects_loose_permissions_and_symlinks(tmp_path):
    pytest.importorskip("eth_account", reason="Run the key-file check in the isolated peaq environment")
    key_file = tmp_path / "fixture.json"
    key_file.write_text(json.dumps({"private_key_hex": "0x" + "01" * 32}))
    key_file.chmod(0o644)
    with pytest.raises(ValueError, match="owner-only"):
        operator._load_account(key_file, policy()["owner"])
    key_file.chmod(0o600)
    linked = tmp_path / "linked.json"
    linked.symlink_to(key_file)
    with pytest.raises(OSError):
        operator._load_account(linked, policy()["owner"])


def test_finalized_solana_payment_checks_exact_owner_deltas():
    job = recorded_job()
    payer, recipient = job["payment"]["payer"], job["payment"]["recipient"]
    asset = job["payment"]["asset"]
    def entry(index, owner, amount):
        return {"accountIndex": index, "owner": owner, "mint": asset,
                "programId": operator.SOLANA_TOKEN_PROGRAM,
                "uiTokenAmount": {"amount": str(amount), "decimals": 6}}
    result = {"slot": 100, "blockTime": job["receipt"]["started_at"] - 1,
              "transaction": {"signatures": [job["payment"]["transaction"]],
                              "message": {"accountKeys": [{"pubkey": payer, "signer": True},
                                                          {"pubkey": "payer-token"}, {"pubkey": "merchant-token"}],
                                          "instructions": [{"programId": operator.SOLANA_TOKEN_PROGRAM,
                                                            "parsed": {"type": "transferChecked",
                                                                       "info": {"mint": asset, "authority": payer,
                                                                                "source": "payer-token",
                                                                                "destination": "merchant-token",
                                                                                "tokenAmount": {"amount": "1000",
                                                                                                "decimals": 6}}}}]}},
              "meta": {"err": None, "preTokenBalances": [entry(1, payer, 2000), entry(2, recipient, 0)],
                       "postTokenBalances": [entry(1, payer, 1000), entry(2, recipient, 1000)]}}
    call = lambda method, params: result
    assert operator.verify_solana_settlement(job, rpc_call=call)["slot"] == 100
    result["meta"]["postTokenBalances"][1]["uiTokenAmount"]["amount"] = "999"
    with pytest.raises(ValueError, match="balance changes"):
        operator.verify_solana_settlement(job, rpc_call=call)
    result["meta"]["postTokenBalances"][1]["uiTokenAmount"]["amount"] = "1000"
    result["meta"]["postTokenBalances"][1]["uiTokenAmount"]["decimals"] = 9
    with pytest.raises(ValueError, match="ambiguous"):
        operator.verify_solana_settlement(job, rpc_call=call)
    result["meta"]["postTokenBalances"][1]["uiTokenAmount"]["decimals"] = 6
    result["transaction"]["message"]["instructions"][0]["programId"] = "impostor"
    with pytest.raises(ValueError, match="transfer"):
        operator.verify_solana_settlement(job, rpc_call=call)


def test_sdk_activation_inputs_match_approved_public_subject():
    pytest.importorskip("peaq_os_sdk", reason="Run the SDK input check in the isolated peaq environment")
    params = operator.activation_inputs(policy(), "0x" + "33" * 20, 400000000000000000)
    assert params.expected_machine_id == int(policy()["machine_id"])
    assert params.authentication == (0,)
    assert params.verification_methods[0].id == "#receipt-key"
    assert params.service_endpoints[0].service_endpoint == policy()["service_endpoint"]


def test_activation_guard_encodes_the_sdk_did_mapping_without_network():
    pytest.importorskip("peaq_os_sdk", reason="Run the ABI regression in the isolated peaq environment")
    from web3 import Web3
    from peaq_os_sdk.tokenomics.abis import MACHINE_STATE_AND_SYNC_ABI
    params = operator.activation_inputs(policy(), "0x" + "33" * 20, 400000000000000000)
    contract = Web3().eth.contract(address="0x" + "11" * 20, abi=MACHINE_STATE_AND_SYNC_ABI)
    data = operator.activation_calldata(contract, params)
    function, decoded = contract.decode_function_input(data)
    assert function.fn_name == "activateMachine"
    values = list(decoded.values())
    assert values[0]["controller"].lower() == policy()["controller"].lower()
    assert values[0]["verificationMethods"][0]["publicKeyMultibase"] == params.verification_methods[0].public_key_multibase
    assert values[1:] == [params.machine_type, params.credential_subject, params.manufacturer, params.tier]


def test_signer_syncs_private_journal_before_authorizing_raw_send(tmp_path, monkeypatch):
    pytest.importorskip("eth_utils", reason="Run the signer check in the isolated peaq environment")
    root = tmp_path / "journals"
    monkeypatch.setattr(operator, "JOURNAL_ROOT", root)
    journal = operator.PrivateJournal(root / "signed.jsonl")
    raw = b"signed-transaction-fixture"
    account = Row(sign_transaction=lambda _: Row(raw_transaction=raw))
    def authorize(_raw):
        assert _raw == raw
        entry = json.loads((root / "signed.jsonl").read_text())
        assert entry["status"] == "signed_before_broadcast"
        assert entry["raw_transaction_hex"] == "0x" + raw.hex()
    provider = Row(approve_once=authorize)
    target = "0x" + "11" * 20
    signer = operator.JournaledSigner(account, provider, journal, owner=policy()["owner"],
                                      targets={"activation": target, "activation_data": "0xdeadbeef"},
                                      max_total_gas_wei=200)
    try:
        signer.sign_transaction(_transaction())
    finally:
        journal.close()


def test_provider_sends_each_journaled_raw_transaction_once(monkeypatch):
    eth_utils = pytest.importorskip("eth_utils", reason="Run the transport check in the isolated peaq environment")
    web3 = pytest.importorskip("web3", reason="Run the transport check in the isolated peaq environment")
    raw = b"signed-transaction-fixture"
    sent = []
    def fake_send(self, method, params):
        sent.append((method, params))
        return {"jsonrpc": "2.0", "id": 1, "result": "0x" + eth_utils.keccak(raw).hex()}
    monkeypatch.setattr(web3.HTTPProvider, "make_request", fake_send)
    provider = operator.write_provider()
    provider.approve_once(raw)
    provider.make_request("eth_sendRawTransaction", ["0x" + raw.hex()])
    assert len(sent) == 1
    with pytest.raises(PermissionError):
        provider.make_request("eth_sendRawTransaction", ["0x" + raw.hex()])
