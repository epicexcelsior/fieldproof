"""Bounded Agung operator preview and journaled test writes.

Run with the isolated peaq-os-sdk==0.10.0 environment. No command executes a
write unless the explicit Agung test-write flag is present. Signed transactions
remain in a private journal for reconciliation after every uncertain outcome.
"""

import argparse
from dataclasses import asdict, dataclass
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
from urllib.request import Request, urlopen

from scripts.check_peaq_readiness import ROOT, RPC_URL, observer_subject
from scripts.peaq_rpc import _address, load_policy, read_agung
from scripts.prepare_peaq_event import ASSET, prepare
from scripts.prepare_peaq_identity import MACHINE_TYPE, public_multikey

JOURNAL_ROOT = ROOT / ".local" / "peaq-journals"
UINT256 = 2**256
APPROVE_SELECTOR = "0x095ea7b3"
SOLANA_RPC = "https://api.devnet.solana.com"
SOLANA_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"


def _bound(value, name, *, positive=True):
    if type(value) is not int or value < int(positive) or value >= UINT256:
        raise ValueError(f"{name} must be a reviewed uint256 bound")
    return value


def activation_inputs(policy, manufacturer, max_net_base_units):
    """Build exact SDK inputs from approved public policy, without network or key access."""
    _address(manufacturer, "manufacturer")
    _bound(max_net_base_units, "max_net_base_units")
    from peaq_os_sdk.tokenomics.activation_types import (ActivateMachineParams, ServiceEndpointInput,
                                                          VerificationMethodInput)
    from peaq_os_sdk.validation.tokenomics_activation import validate_activate_machine_params

    subject = observer_subject({"algorithm": "ecdsa-p256-sha256",
                                "providers": {policy["provider"]: policy["receipt_public_key"]}}, policy["provider"])
    params = ActivateMachineParams(
        controller=policy["controller"],
        verification_methods=(VerificationMethodInput(
            id=policy["verification_method_id"], method_type="Multikey", controller=policy["controller"],
            public_key_multibase=public_multikey(policy["receipt_public_key"])),),
        authentication=(0,),
        service_endpoints=(ServiceEndpointInput(id=policy["service_id"], service_type=policy["service_type"],
                                                 service_endpoint=policy["service_endpoint"]),),
        machine_type=MACHINE_TYPE, credential_subject=subject, manufacturer=manufacturer, tier=0,
        expected_machine_id=int(policy["machine_id"]), max_net_peaq_amount=max_net_base_units,
        confirmations=1, timeout_seconds=90.0)
    validate_activate_machine_params(params)
    return params


@dataclass(frozen=True)
class OperatorContext:
    w3: object
    tokenomics20: object
    account: object
    address: str


def preview_activation(policy, manufacturer, max_net_base_units):
    params = activation_inputs(policy, manufacturer, max_net_base_units)
    from peaq_os_sdk.tokenomics.preview_machine_activation import preview_machine_activation
    w3, deployment, block, _contracts, _ = read_agung()
    context = OperatorContext(w3, deployment, object(), policy["owner"])
    quote = preview_machine_activation(context, params)
    if (quote.chain_id != 9990 or quote.deployment_id != policy["deployment_id"]
            or quote.machine_id != int(policy["machine_id"])
            or quote.signer.lower() != policy["owner"].lower()
            or quote.controller.lower() != policy["controller"].lower()
            or quote.net_peaq_amount > max_net_base_units):
        raise ValueError("activation preview differs from the approved Agung budget or identity")
    return {"schema": "fieldproof-agung-activation-preview-v1", "chain_id": 9990,
            "deployment_id": policy["deployment_id"], "machine_id": policy["machine_id"],
            "owner": quote.signer, "controller": quote.controller, "manufacturer": manufacturer,
            "tier": 0, "bond_base_units": str(quote.bond_amount),
            "voucher_credit_base_units": str(quote.voucher_credit),
            "net_peaq_base_units": str(quote.net_peaq_amount),
            "approved_max_net_base_units": str(max_net_base_units),
            "balance_base_units": str(quote.balance), "allowance_base_units": str(quote.current_allowance),
            "approval_required": quote.approval_required, "peaq_token": quote.peaq_token,
            "contracts": asdict(quote.contracts), "finalized_block": block["number"],
            "block_hash": block["hash"].to_0x_hex(), "write_authorized": False}


class PrivateJournal:
    """Exclusive append-only signed-transaction record. fsync precedes broadcast."""

    def __init__(self, path):
        path = Path(path)
        if JOURNAL_ROOT.is_symlink():
            raise ValueError("private journal directory must not be a symlink")
        JOURNAL_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
        root = JOURNAL_ROOT.resolve()
        if path.parent.resolve() != root or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}\.jsonl\Z", path.name):
            raise ValueError("journal must be a new .local/peaq-journals/*.jsonl file")
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        self.fd = os.open(path, flags, 0o600)
        self.name = path.name
        directory = os.open(root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)

    def append(self, record):
        data = json.dumps(record, sort_keys=True, separators=(",", ":")).encode() + b"\n"
        while data:
            data = data[os.write(self.fd, data):]
        os.fsync(self.fd)

    def close(self):
        os.close(self.fd)


def check_signing_transaction(transaction, *, owner, chain_id, targets, signed_phases, spent_gas, max_total_gas_wei):
    """Return the phase and maximum fee. Reject every unapproved call or bound."""
    if (type(transaction.get("chainId")) is not int or transaction["chainId"] != chain_id
            or str(transaction.get("from", "")).lower() != owner.lower()
            or type(transaction.get("nonce")) is not int or transaction["nonce"] < 0
            or transaction.get("value") != 0):
        raise ValueError("transaction changes the approved chain, signer, nonce, or native value")
    target = str(transaction.get("to", "")).lower()
    data = transaction.get("data", "")
    if not isinstance(data, str) or not data.startswith("0x"):
        raise ValueError("transaction call data is invalid")
    if target == targets.get("activation", "").lower() and data.lower() == targets.get("activation_data", "").lower():
        phase = "activation"
    elif target == targets.get("event", "").lower() and data.lower() == targets.get("event_data", "").lower():
        phase = "event"
    elif target == targets.get("approval", "").lower() and data.lower().startswith(APPROVE_SELECTOR):
        if len(data) != 2 + 8 + 64 + 64:
            raise ValueError("approval call data is not exact ERC-20 approve")
        spender_word = data[10:74]
        amount = int(data[74:138], 16)
        if (int(spender_word[:24], 16) != 0 or "0x" + spender_word[24:].lower() != targets.get("spender", "").lower()
                or amount <= 0 or amount > targets.get("max_net", -1)
                or ("expected_approval_amount" in targets and amount != targets["expected_approval_amount"])):
            raise ValueError("approval changes the spender or reviewed amount")
        phase = "approval"
    else:
        raise ValueError("transaction targets an unapproved contract call")
    if phase in signed_phases or (phase == "approval" and ("activation" in signed_phases or "event" in signed_phases)):
        raise ValueError("transaction phase was already signed")
    gas = transaction.get("gas")
    price = transaction.get("maxFeePerGas", transaction.get("gasPrice"))
    if (type(gas) is not int or gas <= 0 or type(price) is not int or price <= 0
            or ("maxFeePerGas" in transaction and "gasPrice" in transaction)
            or ("maxPriorityFeePerGas" in transaction and
                (type(transaction["maxPriorityFeePerGas"]) is not int
                 or not 0 <= transaction["maxPriorityFeePerGas"] <= price))):
        raise ValueError("transaction has no unambiguous gas ceiling")
    maximum = gas * price
    if maximum > max_total_gas_wei - spent_gas:
        raise ValueError("transaction exceeds the approved aggregate gas ceiling")
    return phase, maximum


class JournaledSigner:
    def __init__(self, account, provider, journal, *, owner, targets, max_total_gas_wei):
        self.account, self.provider, self.journal = account, provider, journal
        self.owner, self.targets, self.max_total_gas_wei = owner, targets, max_total_gas_wei
        self.signed_phases = set()
        self.spent_gas = 0

    def sign_transaction(self, transaction):
        from eth_utils import keccak
        phase, maximum = check_signing_transaction(
            transaction, owner=self.owner, chain_id=9990, targets=self.targets,
            signed_phases=self.signed_phases, spent_gas=self.spent_gas,
            max_total_gas_wei=self.max_total_gas_wei)
        signed = self.account.sign_transaction(transaction)
        raw = bytes(signed.raw_transaction)
        tx_hash = "0x" + keccak(raw).hex()
        self.journal.append({"phase": phase, "status": "signed_before_broadcast", "transaction_hash": tx_hash,
                             "raw_transaction_hex": "0x" + raw.hex(), "nonce": transaction["nonce"],
                             "to": transaction["to"], "gas_ceiling_wei": str(maximum)})
        self.provider.approve_once(raw)
        self.signed_phases.add(phase)
        self.spent_gas += maximum
        return signed


def write_provider():
    """Permit only SDK read/build methods and one previously journaled raw send."""
    from web3 import HTTPProvider
    from scripts.peaq_rpc import read_request

    reads = frozenset({"eth_blockNumber", "eth_getTransactionCount", "eth_estimateGas",
                       "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_getBalance"})

    class Provider(HTTPProvider):
        def __init__(self):
            super().__init__(RPC_URL, request_kwargs={"timeout": 15}, exception_retry_configuration=None)
            self.allowed_raw = set()

        def approve_once(self, raw):
            self.allowed_raw.add("0x" + raw.hex())

        def make_request(self, method, params):
            if method == "eth_sendRawTransaction":
                if not isinstance(params, (tuple, list)) or len(params) != 1:
                    raise PermissionError("raw transaction lacks a synced private journal entry")
                raw_arg = params[0]
                normalized = "0x" + bytes(raw_arg).hex() if isinstance(raw_arg, (bytes, bytearray)) else str(raw_arg).lower()
                if normalized not in self.allowed_raw:
                    raise PermissionError("raw transaction lacks a synced private journal entry")
                self.allowed_raw.remove(normalized)
                result = super().make_request(method, params)
                from eth_utils import keccak
                if result.get("result") and result["result"].lower() != "0x" + keccak(hexstr=normalized).hex():
                    raise ValueError("RPC returned another transaction hash; reconcile the signed journal")
                return result
            if method in reads:
                return super().make_request(method, params)
            return read_request(super().make_request, method, params)

    return Provider()


def _load_account(path, expected_owner):
    from eth_account import Account
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        metadata = os.fstat(fd)
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid()
                or metadata.st_mode & 0o077 or metadata.st_size > 4096):
            raise ValueError("key file must be a small regular owner-only file")
        with os.fdopen(fd, "r") as source:
            fd = None
            content = json.load(source)
    finally:
        if fd is not None:
            os.close(fd)
    if not isinstance(content, dict) or set(content) != {"private_key_hex"}:
        raise ValueError("key file must contain only private_key_hex")
    key = content["private_key_hex"]
    if not isinstance(key, str) or not re.fullmatch(r"0x[0-9a-fA-F]{64}\Z", key):
        raise ValueError("private key file has an invalid key shape")
    account = Account.from_key(key)
    if account.address.lower() != expected_owner.lower():
        raise ValueError("key file does not match the approved owner")
    return account


def _operator_web3():
    from web3 import Web3
    provider = write_provider()
    w3 = Web3(provider)
    if w3.eth.chain_id != 9990:
        raise ValueError("operator RPC is not Agung chain 9990")
    return w3, provider


def verify_solana_settlement(job, *, rpc_call=None):
    """Check finalized Devnet metadata for the exact payer-to-recipient USDC delta."""
    transaction = job["payment"]["transaction"]
    def request(method, params):
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
        with urlopen(Request(SOLANA_RPC, body, {"Content-Type": "application/json"}), timeout=15) as response:
            raw = response.read(262145)
        if len(raw) > 262144:
            raise ValueError("Solana RPC response exceeds the verification limit")
        result = json.loads(raw)
        if (not isinstance(result, dict) or result.get("jsonrpc") != "2.0" or type(result.get("id")) is not int
                or result["id"] != 1 or "error" in result):
            raise ValueError("Solana RPC returned an uncorrelated result or error")
        return result.get("result")
    call = rpc_call or request
    result = call("getTransaction", [transaction, {"encoding": "jsonParsed", "commitment": "finalized",
                                                   "maxSupportedTransactionVersion": 0}])
    if (not isinstance(result, dict) or type(result.get("slot")) is not int
            or result["slot"] <= 0 or type(result.get("blockTime")) is not int
            or not isinstance(result.get("meta"), dict) or "err" not in result["meta"]
            or result["meta"]["err"] is not None):
        raise ValueError("payment transaction lacks finalized successful Devnet metadata")
    if not (job["request"]["created_at"] - 5 <= result["blockTime"] <= job["receipt"]["started_at"] + 5):
        raise ValueError("payment timestamp does not precede the physical observation")
    tx = result.get("transaction", {})
    if not isinstance(tx.get("signatures"), list) or not tx["signatures"] or tx["signatures"][0] != transaction:
        raise ValueError("payment signature differs from finalized transaction")
    keys = tx.get("message", {}).get("accountKeys", [])
    if not isinstance(keys, list) or not any(isinstance(key, dict) and key.get("pubkey") == job["payment"]["payer"]
               and key.get("signer") is True for key in keys):
        raise ValueError("approved payer did not sign the payment transaction")
    balances = {}
    for side in ("preTokenBalances", "postTokenBalances"):
        entries = result["meta"].get(side)
        if not isinstance(entries, list):
            raise ValueError("payment lacks parsed token balances")
        values = {}
        for entry in entries:
            if entry.get("mint") != ASSET:
                continue
            index = entry.get("accountIndex")
            token_amount = entry.get("uiTokenAmount")
            amount = token_amount.get("amount") if isinstance(token_amount, dict) else None
            if (type(index) is not int or index < 0 or index >= len(keys)
                    or not isinstance(keys[index], dict) or not isinstance(keys[index].get("pubkey"), str)
                    or not isinstance(entry.get("owner"), str) or not entry["owner"]
                    or entry.get("programId") != SOLANA_TOKEN_PROGRAM
                    or not isinstance(token_amount, dict)
                    or token_amount.get("decimals") != 6
                    or not isinstance(amount, str) or not re.fullmatch(r"(?:0|[1-9][0-9]*)\Z", amount)
                    or index in values):
                raise ValueError("payment token balance entry is ambiguous")
            values[index] = (entry["owner"], int(amount))
        balances[side] = values
    deltas = {}
    accounts = {}
    for index in set(balances["preTokenBalances"]) | set(balances["postTokenBalances"]):
        before = balances["preTokenBalances"].get(index)
        after = balances["postTokenBalances"].get(index)
        owner = (after or before)[0]
        if before and after and before[0] != after[0]:
            raise ValueError("payment token account owner changed")
        deltas[owner] = deltas.get(owner, 0) + (after[1] if after else 0) - (before[1] if before else 0)
        accounts[keys[index]["pubkey"]] = owner
    if deltas.get(job["payment"]["recipient"]) != 1000 or deltas.get(job["payment"]["payer"]) != -1000:
        raise ValueError("finalized USDC balance changes do not prove the approved 1000-unit payment")
    outer = tx.get("message", {}).get("instructions")
    inner = result["meta"].get("innerInstructions", [])
    if (not isinstance(outer, list) or not isinstance(inner, list)
            or any(not isinstance(group, dict) or not isinstance(group.get("instructions"), list) for group in inner)):
        raise ValueError("payment instructions are malformed")
    instructions = outer + [instruction for group in inner for instruction in group["instructions"]]
    if any(not isinstance(instruction, dict) for instruction in instructions):
        raise ValueError("payment instructions are malformed")
    transfer = any(
        instruction.get("programId") == SOLANA_TOKEN_PROGRAM
        and isinstance(instruction.get("parsed"), dict)
        and instruction["parsed"].get("type") == "transferChecked"
        and isinstance(instruction["parsed"].get("info"), dict)
        and instruction["parsed"]["info"].get("mint") == ASSET
        and instruction["parsed"]["info"].get("authority") == job["payment"]["payer"]
        and accounts.get(instruction["parsed"]["info"].get("source")) == job["payment"]["payer"]
        and accounts.get(instruction["parsed"]["info"].get("destination")) == job["payment"]["recipient"]
        and isinstance(instruction["parsed"]["info"].get("tokenAmount"), dict)
        and instruction["parsed"]["info"]["tokenAmount"].get("amount") == "1000"
        and instruction["parsed"]["info"]["tokenAmount"].get("decimals") == 6
        for instruction in instructions)
    if not transfer:
        raise ValueError("finalized payment lacks the approved SPL Token transfer")
    return {"slot": result["slot"], "block_time": result["blockTime"]}


def execute_activation(policy, manufacturer, max_net_base_units, max_total_gas_wei, key_file, journal_path):
    """Use SDK's preflight, exact approval, activation, and post-state checks."""
    _bound(max_total_gas_wei, "max_total_gas_wei")
    params = activation_inputs(policy, manufacturer, max_net_base_units)
    preview = preview_activation(policy, manufacturer, max_net_base_units)
    account = _load_account(key_file, policy["owner"])
    journal = PrivateJournal(journal_path)
    try:
        from web3 import Web3
        from peaq_os_sdk.tokenomics.abis import MACHINE_STATE_AND_SYNC_ABI
        from peaq_os_sdk.tokenomics.deployments import resolve_tokenomics20_deployment
        from peaq_os_sdk.tokenomics._internal.encode_did import encode_did_document
        from peaq_os_sdk.tokenomics.activate_machine import activate_machine

        w3, provider = _operator_web3()
        deployment = resolve_tokenomics20_deployment(policy["deployment_id"])
        contracts = deployment.contracts
        state = w3.eth.contract(address=Web3.to_checksum_address(contracts.machine_state_and_sync),
                                abi=MACHINE_STATE_AND_SYNC_ABI)
        activation_data = state.functions.activateMachine(
            encode_did_document(params), params.machine_type, params.credential_subject,
            params.manufacturer, params.tier)._encode_transaction_data()
        targets = {"approval": "", "activation": contracts.machine_state_and_sync,
                   "activation_data": activation_data, "spender": contracts.machine_subscription,
                   "max_net": max_net_base_units,
                   "expected_approval_amount": int(preview["net_peaq_base_units"])}
        # InfoDesk resolves the payment token. SDK preflight verifies the same peer before signing.
        from peaq_os_sdk.tokenomics.abis import INFO_DESK_ABI
        info = w3.eth.contract(address=Web3.to_checksum_address(contracts.info_desk), abi=INFO_DESK_ABI)
        targets["approval"] = info.functions.peaqToken().call()
        signer = JournaledSigner(account, provider, journal, owner=policy["owner"], targets=targets,
                                 max_total_gas_wei=max_total_gas_wei)
        context = OperatorContext(w3, deployment, signer, policy["owner"])
        def observed(submitted):
            journal.append({"phase": submitted.phase, "status": "broadcast_hash_returned",
                            "transaction_hash": submitted.transaction_hash, "nonce": submitted.sender_nonce})
        params = dataclass_replace(params, on_transaction_submitted=observed)
        result = activate_machine(context, params)
        journal.append({"phase": "activation", "status": "sdk_confirmed_and_reconciled",
                        "transaction_hash": result.transaction_hash, "machine_id": str(result.machine_id)})
        return {"schema": "fieldproof-agung-activation-result-v1", "chain_id": 9990,
                "machine_id": str(result.machine_id), "transaction_hash": result.transaction_hash,
                "journal": journal.name, "status": "confirmed_and_reconciled"}
    finally:
        journal.close()


def execute_event(policy, raw, registry_address, max_total_gas_wei, key_file, journal_path):
    """Submit one independently paid activity and inspect its finalized readback."""
    _bound(max_total_gas_wei, "max_total_gas_wei")
    prepared = prepare(raw, policy)
    job = json.loads(raw)
    from scripts.resolve_peaq_identity import resolve
    from scripts.inspect_peaq_event import bind_verified_registry, inspect
    resolved = resolve(policy)
    if resolved["machine_id"] != job["identity"]["machine_id"] or resolved["owner"].lower() != policy["owner"].lower():
        raise ValueError("current machine identity differs from the paid job authority")
    settlement = verify_solana_settlement(job)
    readonly_w3, _deployment, block, contracts, _ = read_agung()
    registry, _registry_binding = bind_verified_registry(readonly_w3, block, contracts, registry_address)
    count = registry.functions.getEventCount(int(policy["machine_id"])).call(block_identifier=block["number"])
    if type(count) is not int or not 0 <= count <= 100:
        raise ValueError("event count exceeds the bounded duplicate check")
    for index in range(count):
        earlier = registry.functions.getEventAt(int(policy["machine_id"]), index).call(block_identifier=block["number"])
        if bytes(earlier[4]) == bytes.fromhex(prepared["data_hash"][2:]):
            raise ValueError("the exact paid job already has a peaq activity event")
    account = _load_account(key_file, policy["owner"])
    journal = PrivateJournal(journal_path)
    try:
        from web3 import Web3
        from peaq_os_sdk.abis import load_abi
        from peaq_os_sdk.tokenomics.abis import INFO_DESK_ABI

        w3, provider = _operator_web3()
        registry = w3.eth.contract(address=Web3.to_checksum_address(registry_address), abi=load_abi("EventRegistry"))
        info = w3.eth.contract(address=Web3.to_checksum_address(contracts["info_desk"]), abi=INFO_DESK_ABI)
        if (info.functions.peer(w3.keccak(text="EVENT_REGISTRY")).call().lower() != registry.address.lower()
                or registry.functions.identityRegistryAddress().call().lower() != contracts["machine_registry"].lower()):
            raise ValueError("EventRegistry binding changed before signing")
        function = registry.functions.submitEvent(
            int(policy["machine_id"]), 1, 1, "", prepared["timestamp"],
            bytes.fromhex(prepared["data_hash"][2:]), 0, 0, b"\0" * 32,
            prepared["metadata_utf8"].encode())
        function.call({"from": Web3.to_checksum_address(policy["owner"]), "value": 0})
        nonce = w3.eth.get_transaction_count(Web3.to_checksum_address(policy["owner"]), "pending")
        transaction = function.build_transaction({"from": Web3.to_checksum_address(policy["owner"]),
                                                  "nonce": nonce, "value": 0, "chainId": 9990})
        targets = {"event": registry.address, "event_data": function._encode_transaction_data()}
        signer = JournaledSigner(account, provider, journal, owner=policy["owner"], targets=targets,
                                 max_total_gas_wei=max_total_gas_wei)
        signed = signer.sign_transaction(transaction)
        tx_hash_obj = w3.eth.send_raw_transaction(signed.raw_transaction)
        transaction_hash = "0x" + bytes(tx_hash_obj).hex()
        journal.append({"phase": "event", "status": "broadcast_hash_returned",
                        "transaction_hash": transaction_hash, "nonce": nonce,
                        "solana_payment_slot": settlement["slot"]})
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash_obj, timeout=90)
        if receipt["status"] != 1 or receipt["to"].lower() != registry.address.lower():
            raise ValueError("event transaction mined without a successful registry receipt")
        event_logs = []
        topic = w3.keccak(text="EventSubmitted(uint256,uint256,uint8,uint256,string)")
        for log in receipt["logs"]:
            if log["address"].lower() == registry.address.lower() and log["topics"] and log["topics"][0] == topic:
                event_logs.append(registry.events.EventSubmitted().process_log(log)["args"])
        matching = [entry for entry in event_logs if entry["machineId"] == int(policy["machine_id"])
                    and entry["eventType"] == 1 and entry["value"] == 1]
        if len(matching) != 1:
            raise ValueError("mined receipt lacks one matching EventSubmitted log")
        index = matching[0]["eventIndex"]
        deadline = time.monotonic() + 90
        while True:
            _w3, _deployment, finalized, _contracts, _context = read_agung()
            if finalized["number"] >= receipt["blockNumber"]:
                break
            if time.monotonic() >= deadline:
                raise TimeoutError("event mined but finality is pending; reconcile the journal")
            time.sleep(2)
        result = inspect(registry_address, policy["machine_id"], index, raw, policy, transaction_hash)
        journal.append({"phase": "event", "status": "finalized_and_inspected",
                        "transaction_hash": transaction_hash, "index": index,
                        "job_sha256": prepared["raw_data_sha256"]})
        return {"schema": "fieldproof-agung-event-result-v1", "transaction_hash": transaction_hash,
                "data_hash": prepared["data_hash"], "job_sha256": prepared["raw_data_sha256"],
                "index": index, "journal": journal.name, "finalized_block": result["finalized_block"],
                "status": "finalized_and_inspected"}
    finally:
        journal.close()


def dataclass_replace(value, **changes):
    from dataclasses import replace
    return replace(value, **changes)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)
    for mode in ("preview", "activate"):
        command = sub.add_parser(mode)
        command.add_argument("--policy", required=True)
        command.add_argument("--manufacturer", required=True, help="Reviewed public EVM manufacturer address")
        command.add_argument("--max-net-base-units", type=int, required=True)
        if mode == "activate":
            command.add_argument("--execute-agung-test-write", action="store_true", required=True)
            command.add_argument("--max-total-gas-wei", type=int, required=True)
            command.add_argument("--key-file", required=True, help="Private local JSON key file")
            command.add_argument("--journal", required=True, help="New private .local/peaq-journals/*.jsonl file")
    event = sub.add_parser("event")
    event.add_argument("--policy", required=True)
    event.add_argument("--raw", required=True, help="Exact canonical paid job file")
    event.add_argument("--registry", required=True, help="InfoDesk-confirmed Agung EventRegistry")
    event.add_argument("--execute-agung-test-write", action="store_true", required=True)
    event.add_argument("--max-total-gas-wei", type=int, required=True)
    event.add_argument("--key-file", required=True)
    event.add_argument("--journal", required=True)
    args = parser.parse_args(argv)
    try:
        policy = load_policy(args.policy)
        if args.mode == "preview":
            result = preview_activation(policy, args.manufacturer, args.max_net_base_units)
        elif args.mode == "activate":
            if not args.execute_agung_test_write:
                raise ValueError("explicit Agung test-write flag is required")
            result = execute_activation(policy, args.manufacturer, args.max_net_base_units,
                                        args.max_total_gas_wei, args.key_file, args.journal)
        else:
            if not args.execute_agung_test_write:
                raise ValueError("explicit Agung test-write flag is required")
            result = execute_event(policy, Path(args.raw).read_bytes(), args.registry,
                                   args.max_total_gas_wei, args.key_file, args.journal)
        print(json.dumps(result, sort_keys=True))
    except Exception as error:
        if args.mode in {"activate", "event"}:
            print(f"Agung test write stopped ({type(error).__name__}). Inspect and reconcile the private journal before any retry.",
                  file=sys.stderr)
        else:
            print(f"Agung preview failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
