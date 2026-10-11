"""Anchor one paid FieldProof job through the official peaq Storage precompile.

This explicit route creates an owner-attributed Storage record. It does not
submit an EventRegistry event or establish a Machine Credit Rating. Inspection
checks both the successful finalized addItem transaction and current finalized
getItem bytes. The storage owner can later update or remove those bytes.
"""

import argparse
from collections.abc import Mapping
import json
from pathlib import Path
import re
import sys
import time

from scripts.peaq_rpc import load_policy, read_agung
from scripts.prepare_peaq_event import canonical, prepare
from scripts.peaq_operator import (
    JournaledSigner, PrivateJournal, _bound, _load_account, _operator_web3,
    verify_solana_settlement,
)
from scripts.resolve_peaq_identity import resolve

STORAGE_ADDRESS = "0x0000000000000000000000000000000000000801"
STORAGE_SOURCE = "https://docs.peaq.xyz/peaqchain/sdk-reference/javascript/storage-operations"
ABI_SOURCE = ("https://github.com/peaqnetwork/peaq-network-node/blob/"
              "cbcb7a7d5875f55a5d37d3917c9bfd247cf9117a/precompiles/peaq-storage/storage.sol")
MAX_STORAGE_GAS_WEI = 10**16  # 0.01 AGUNG for one explicitly approved activity.
MAX_KEY_BYTES, MAX_VALUE_BYTES = 64, 256
STORAGE_ABI = [
    {"type": "function", "name": "addItem", "stateMutability": "nonpayable",
     "inputs": [{"name": "item_type", "type": "bytes"}, {"name": "item", "type": "bytes"}],
     "outputs": [{"name": "", "type": "bool"}]},
    {"type": "function", "name": "getItem", "stateMutability": "view",
     "inputs": [{"name": "account", "type": "address"}, {"name": "item_type", "type": "bytes"}],
     "outputs": [{"name": "", "type": "bytes"}]},
    {"type": "event", "name": "ItemAdded", "anonymous": False,
     "inputs": [{"name": "sender", "type": "address", "indexed": False},
                {"name": "item_type", "type": "bytes", "indexed": False},
                {"name": "item", "type": "bytes", "indexed": False}]},
]
HASH = re.compile(r"0x[0-9a-fA-F]{64}\Z")
_missing_text = b"Cannot find the item"
MISSING_ITEM_REVERT = ("0x08c379a0" + (32).to_bytes(32, "big").hex()
                       + len(_missing_text).to_bytes(32, "big").hex()
                       + _missing_text.ljust(32, b"\0").hex())


def prepare_storage(raw, policy):
    """Validate the historical job and derive its exact compact activity bytes."""
    prepared = prepare(raw, policy)
    job = json.loads(raw)
    key = f'fieldproof.job:{job["job_id"]}'
    record = {"v": 1, "machine_id": policy["machine_id"], "data_hash": prepared["data_hash"]}
    value = canonical(record).decode("utf-8")
    if not 0 < len(key.encode()) <= MAX_KEY_BYTES or not 0 < len(value.encode()) <= MAX_VALUE_BYTES:
        raise ValueError("storage key or value exceeds the official documented byte limit")
    return {"schema": "fieldproof-peaq-storage-preparation-v1", "route": "storage",
            "chain_id": 9990, "machine_id": policy["machine_id"], "owner": policy["owner"],
            "storage_address": STORAGE_ADDRESS, "key_utf8": key, "value_utf8": value,
            "data_hash": prepared["data_hash"], "job_sha256": prepared["raw_data_sha256"],
            "raw_data_utf8": prepared["raw_data_utf8"],
            "settlement_proof": "not_checked_by_offline_preparation",
            "official_event_registry": False, "machine_credit_rating": False,
            "machine_authority_at_request_verified": False}


def verify_request_authority(raw, policy):
    """Read the actual machine authority at the original buyer's identity block."""
    from scripts.resolve_peaq_identity import authority_at_block
    job = json.loads(raw)
    expected = job["identity"]
    authority = authority_at_block(policy, expected["finalized_block"])
    if (authority["machine_id"] != expected["machine_id"]
            or authority["owner"].lower() != expected["owner"].lower()
            or authority["controller"].lower() != expected["controller"].lower()
            or authority["receipt_public_key"] != expected["receipt_public_key"]
            or authority["finalized_block"] != expected["finalized_block"]
            or authority["block_hash"].lower() != expected["block_hash"].lower()
            or authority["block_timestamp"] != expected["block_timestamp"]
            or authority["block_timestamp"] > job["request"]["created_at"]):
        raise ValueError("original identity snapshot differs from actual registered authority at the buyer request block")
    return True


def prepare_verified_storage(raw, policy):
    prepared = prepare_storage(raw, policy)
    verify_request_authority(raw, policy)
    return {**prepared, "machine_authority_at_request_verified": True}


def storage_contract(w3):
    from web3 import Web3
    return w3.eth.contract(address=Web3.to_checksum_address(STORAGE_ADDRESS), abi=STORAGE_ABI)


def bind_storage(w3, block):
    """Require the fixed Agung precompile marker at the pinned finalized block."""
    contract = storage_contract(w3)
    if bytes(w3.eth.get_code(contract.address, block_identifier=block["number"])) != bytes.fromhex("60006000fd"):
        raise ValueError("the official Agung Storage precompile marker differs from the reviewed deployment")
    return contract


def _is_missing_item(error):
    # Accept only the exact ABI-encoded revert. Network errors and unrelated
    # reverts must never authorize a new write.
    data = getattr(error, "data", None)
    response = getattr(error, "rpc_response", None)
    if isinstance(response, dict) and isinstance(response.get("error"), dict):
        data = response["error"].get("data")
    return isinstance(data, str) and data.lower() == MISSING_ITEM_REVERT


def ensure_absent(contract, owner, key, block_identifier):
    from web3 import Web3
    try:
        contract.functions.getItem(Web3.to_checksum_address(owner), key.encode()).call(block_identifier=block_identifier)
    except Exception as error:
        if _is_missing_item(error):
            return True
        raise ValueError("storage absence is unverified. Stop before signing") from error
    raise ValueError("this job already has a peaq Storage record. Inspect it instead of writing again")


def probe_storage(policy):
    """Read the documented interface. Do not claim an identity or completed job."""
    w3, deployment, block, _contracts, _context = read_agung()
    contract = bind_storage(w3, block)
    key = "fieldproof.probe:v1"
    ensure_absent(contract, policy["owner"], key, block["number"])
    return {"schema": "fieldproof-peaq-storage-readiness-v1", "verified": True,
            "scope": "interface_probe_only", "route": "storage", "chain_id": 9990,
            "deployment_id": deployment.deployment_id, "storage_address": STORAGE_ADDRESS,
            "owner": policy["owner"], "probe_key": key, "missing_key_response_verified": True,
            "finalized_block": block["number"], "block_hash": _hex(block["hash"]),
            "source": STORAGE_SOURCE, "abi_source": ABI_SOURCE,
            "identity_checked": False, "settlement_checked": False,
            "signing": False, "chain_write": False, "official_event_registry": False}


def _hex(value):
    if isinstance(value, str):
        return value.lower()
    return "0x" + bytes(value).hex()


def verify_storage_transaction(w3, contract, transaction_hash, prepared, finalized_block):
    """Require the owner's exact addItem call in one canonical finalized block."""
    if not isinstance(transaction_hash, str) or not HASH.fullmatch(transaction_hash):
        raise ValueError("supply an explicit 32-byte peaq transaction hash")
    transaction = w3.eth.get_transaction(transaction_hash)
    receipt = w3.eth.get_transaction_receipt(transaction_hash)
    expected = contract.functions.addItem(prepared["key_utf8"].encode(), prepared["value_utf8"].encode())._encode_transaction_data()
    if (not isinstance(transaction, Mapping) or not isinstance(receipt, Mapping)
            or type(transaction.get("blockNumber")) is not int or not 1 <= transaction["blockNumber"] <= finalized_block
            or type(receipt.get("blockNumber")) is not int or receipt["blockNumber"] != transaction["blockNumber"]
            or type(receipt.get("status")) is not int or receipt["status"] != 1
            or str(transaction.get("from", "")).lower() != prepared["owner"].lower()
            or str(receipt.get("from", "")).lower() != prepared["owner"].lower()
            or str(transaction.get("to", "")).lower() != contract.address.lower()
            or str(receipt.get("to", "")).lower() != contract.address.lower()
            or type(transaction.get("value")) is not int or transaction["value"] != 0
            or _hex(transaction.get("input", b"")) != expected.lower()
            or _hex(transaction.get("hash", b"")) != transaction_hash.lower()
            or _hex(receipt.get("transactionHash", b"")) != transaction_hash.lower()
            or ("chainId" in transaction and transaction["chainId"] != 9990)):
        raise ValueError("transaction is not the successful finalized owner addItem call for this job")
    block = w3.eth.get_block(transaction["blockNumber"])
    if (_hex(block["hash"]) != _hex(transaction.get("blockHash", b""))
            or _hex(block["hash"]) != _hex(receipt.get("blockHash", b""))):
        raise ValueError("storage transaction block differs from the canonical finalized chain")
    topic = w3.keccak(text="ItemAdded(address,bytes,bytes)")
    matches = []
    for log in receipt.get("logs", []):
        if log["address"].lower() == contract.address.lower() and log["topics"] and log["topics"][0] == topic:
            if (log.get("removed", False) is not False or _hex(log.get("transactionHash", b"")) != transaction_hash.lower()
                    or _hex(log.get("blockHash", b"")) != _hex(block["hash"])):
                raise ValueError("storage log differs from the selected finalized transaction")
            entry = contract.events.ItemAdded().process_log(log)["args"]
            if (entry["sender"].lower() != prepared["owner"].lower()
                    or bytes(entry["item_type"]) != prepared["key_utf8"].encode()
                    or bytes(entry["item"]) != prepared["value_utf8"].encode()):
                raise ValueError("ItemAdded log differs from the exact prepared activity")
            matches.append(entry)
    if len(matches) != 1:
        raise ValueError("storage transaction must emit exactly one matching ItemAdded log")
    return transaction["blockNumber"]


def inspect_storage(raw, policy, transaction_hash):
    prepared = prepare_verified_storage(raw, policy)
    w3, _deployment, block, _contracts, _ = read_agung()
    contract = bind_storage(w3, block)
    from web3 import Web3
    value = contract.functions.getItem(Web3.to_checksum_address(policy["owner"]),
                                      prepared["key_utf8"].encode()).call(block_identifier=block["number"])
    if bytes(value) != prepared["value_utf8"].encode():
        raise ValueError("finalized peaq Storage bytes differ from the exact paid job")
    submission = verify_storage_transaction(w3, contract, transaction_hash, prepared, block["number"])
    from scripts.resolve_peaq_identity import authority_at_block
    authority = authority_at_block(policy, submission)
    if (authority["machine_id"] != policy["machine_id"]
            or authority["owner"].lower() != policy["owner"].lower()
            or authority["controller"].lower() != policy["controller"].lower()
            or authority["receipt_public_key"] != policy["receipt_public_key"]
            or authority["finalized_block"] != submission
            or authority["block_hash"].lower() != _hex(w3.eth.get_block(submission)["hash"])):
        raise ValueError("machine authority at the storage transaction block differs from the paid job policy")
    return {"schema": "fieldproof-peaq-storage-inspection-v1", "route": "storage", "verified": True,
            "chain_id": 9990, "deployment_id": policy["deployment_id"], "machine_id": policy["machine_id"],
            "owner": policy["owner"], "storage_address": STORAGE_ADDRESS,
            "key_utf8": prepared["key_utf8"], "value_utf8": prepared["value_utf8"],
            "data_hash": prepared["data_hash"], "job_sha256": prepared["job_sha256"],
            "transaction_hash": transaction_hash, "submission_block": submission,
            "finalized_block": block["number"], "block_hash": _hex(block["hash"]),
            "official_event_registry": False, "machine_credit_rating": False,
            "storage_mutable_by_owner": True, "machine_authority_at_submission_verified": True,
            "machine_authority_at_request_verified": True}


def _gas_bound(max_total_gas_wei):
    _bound(max_total_gas_wei, "max_total_gas_wei")
    if max_total_gas_wei > MAX_STORAGE_GAS_WEI:
        raise ValueError("one storage activity has a maximum gas ceiling of 0.01 AGUNG")
    return max_total_gas_wei


def _preflight(raw, policy):
    prepared = prepare_verified_storage(raw, policy)
    job = json.loads(raw)
    resolved = resolve(policy)
    if (resolved["machine_id"] != job["identity"]["machine_id"]
            or resolved["owner"].lower() != policy["owner"].lower()):
        raise ValueError("current machine identity differs from the paid job authority")
    settlement = verify_solana_settlement(job)
    w3, _deployment, block, _contracts, _context = read_agung()
    contract = bind_storage(w3, block)
    ensure_absent(contract, policy["owner"], prepared["key_utf8"], block["number"])
    return prepared, settlement, block


def _build_call(w3, prepared, max_total_gas_wei):
    from web3 import Web3
    contract = storage_contract(w3)
    owner = Web3.to_checksum_address(prepared["owner"])
    ensure_absent(contract, owner, prepared["key_utf8"], "latest")
    function = contract.functions.addItem(prepared["key_utf8"].encode(), prepared["value_utf8"].encode())
    if function.call({"from": owner, "value": 0}, block_identifier="latest") is not True:
        raise ValueError("exact storage addItem simulation did not return true")
    transaction = {"from": owner, "to": contract.address, "data": function._encode_transaction_data(), "value": 0}
    estimate = w3.eth.estimate_gas(transaction)
    price = w3.eth.gas_price
    if type(estimate) is not int or estimate <= 0 or type(price) is not int or price <= 0:
        raise ValueError("RPC did not return a positive exact-call gas estimate and gas price")
    # Preserve a visible 20% execution margin while the signer enforces the
    # complete gas*price ceiling. No fee is spent by estimateGas or eth_call.
    gas = (estimate * 120 + 99) // 100
    ceiling = gas * price
    if ceiling > max_total_gas_wei:
        raise ValueError("storage transaction exceeds the approved gas ceiling before signing")
    if w3.eth.get_balance(owner, "latest") < ceiling:
        raise ValueError("owner balance cannot cover the reviewed storage gas ceiling")
    transaction.update({"chainId": 9990, "gas": gas, "gasPrice": price})
    return transaction, estimate, ceiling


def preview_storage(raw, policy, max_total_gas_wei=MAX_STORAGE_GAS_WEI):
    """Resolve identity, inspect payment, simulate and estimate. Never load a key."""
    _gas_bound(max_total_gas_wei)
    prepared, settlement, block = _preflight(raw, policy)
    w3, _provider = _operator_web3()
    transaction, estimate, ceiling = _build_call(w3, prepared, max_total_gas_wei)
    return {**prepared, "schema": "fieldproof-peaq-storage-preview-v1", "signing": False,
            "write_authorized": False, "solana_payment_slot": settlement["slot"],
            "finalized_block": block["number"], "block_hash": _hex(block["hash"]),
            "estimated_gas": estimate, "gas_limit": transaction["gas"],
            "gas_price_wei": str(transaction["gasPrice"]), "gas_ceiling_wei": str(ceiling),
            "approved_max_total_gas_wei": str(max_total_gas_wei), "native_value_wei": "0",
            "calldata": transaction["data"], "settlement_proof": "finalized_solana_rpc_read"}


def execute_storage(raw, policy, max_total_gas_wei, key_file, journal_path):
    """Send once after durable journaling. Every unknown result requires inspection."""
    _gas_bound(max_total_gas_wei)
    prepared, settlement, _block = _preflight(raw, policy)
    w3, provider = _operator_web3()
    transaction, _estimate, _ceiling = _build_call(w3, prepared, max_total_gas_wei)
    transaction["nonce"] = w3.eth.get_transaction_count(transaction["from"], "pending")
    account = _load_account(key_file, policy["owner"])
    journal = PrivateJournal(journal_path)
    try:
        signer = JournaledSigner(account, provider, journal, owner=policy["owner"],
                                 targets={"event": STORAGE_ADDRESS, "event_data": transaction["data"]},
                                 max_total_gas_wei=max_total_gas_wei)
        journal.append({"phase": "storage", "status": "prepared", "key_utf8": prepared["key_utf8"],
                        "value_utf8": prepared["value_utf8"], "job_sha256": prepared["job_sha256"],
                        "solana_payment_slot": settlement["slot"]})
        signed = signer.sign_transaction(transaction)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        transaction_hash = _hex(tx_hash)
        journal.append({"phase": "storage", "status": "broadcast_hash_returned", "transaction_hash": transaction_hash,
                        "nonce": transaction["nonce"], "job_sha256": prepared["job_sha256"]})
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=90)
        if receipt["status"] != 1 or receipt["to"].lower() != STORAGE_ADDRESS.lower():
            raise ValueError("storage transaction mined without a successful precompile receipt")
        deadline = time.monotonic() + 90
        while True:
            _w3, _deployment, finalized, _contracts, _context = read_agung()
            if finalized["number"] >= receipt["blockNumber"]:
                break
            if time.monotonic() >= deadline:
                raise TimeoutError("storage transaction mined but finality is pending. Reconcile the private journal")
            time.sleep(2)
        result = inspect_storage(raw, policy, transaction_hash)
        journal.append({"phase": "storage", "status": "finalized_and_inspected", "transaction_hash": transaction_hash,
                        "key_utf8": prepared["key_utf8"], "job_sha256": prepared["job_sha256"]})
        return {**result, "schema": "fieldproof-agung-storage-result-v1",
                "journal": journal.name, "status": "finalized_and_inspected"}
    finally:
        journal.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)
    probe = sub.add_parser("probe", help="Read the official precompile and missing-key response without a job or signer")
    probe.add_argument("--policy", required=True)
    for mode in ("prepare", "preview", "submit", "inspect"):
        command = sub.add_parser(mode)
        command.add_argument("--policy", required=True)
        command.add_argument("--raw", required=True, help="Exact canonical paid job JSON bytes")
        if mode in {"preview", "submit"}:
            command.add_argument("--max-total-gas-wei", type=int,
                                 required=mode == "submit", default=MAX_STORAGE_GAS_WEI)
        if mode == "submit":
            command.add_argument("--execute-agung-test-write", action="store_true", required=True)
            command.add_argument("--key-file", required=True)
            command.add_argument("--journal", required=True)
        if mode == "inspect":
            command.add_argument("--transaction", required=True)
    args = parser.parse_args(argv)
    try:
        policy = load_policy(args.policy)
        if args.mode == "probe":
            print(json.dumps(probe_storage(policy), sort_keys=True))
            return 0
        raw = Path(args.raw).read_bytes()
        if args.mode == "prepare":
            result = prepare_verified_storage(raw, policy)
        elif args.mode == "preview":
            result = preview_storage(raw, policy, args.max_total_gas_wei)
        elif args.mode == "inspect":
            result = inspect_storage(raw, policy, args.transaction)
        else:
            if not args.execute_agung_test_write:
                raise ValueError("explicit Agung test-write flag is required")
            result = execute_storage(raw, policy, args.max_total_gas_wei, args.key_file, args.journal)
        print(json.dumps(result, sort_keys=True))
    except Exception as error:
        if args.mode == "submit":
            print(f"Agung storage write stopped ({type(error).__name__}). Reconcile the private journal before any retry.", file=sys.stderr)
        else:
            print(f"Agung storage {args.mode} failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
