"""Read one Agung activity event and compare it with the exact local paid job bytes."""

import argparse
import json
from pathlib import Path
import re
import sys

from scripts.peaq_rpc import load_policy, read_agung
from scripts.prepare_peaq_event import prepare

# Reviewed official guide commit. This Agung address is a provenance lead,
# not permission to accept a registry that targets a different identity system.
OFFICIAL_AGUNG_REGISTRY = "0x2DAD8905380993940e340C5cE6d313d5c2780040"
REGISTRY_SOURCE = "https://github.com/peaqnetwork/peaq-os-skills/blob/d1f7e87db50f5f16c62527344673a470dcec3c39/skills/peaqos/GUIDE.md#network-reference"


class RegistryBindingMismatch(ValueError):
    def __init__(self, evidence):
        self.evidence = evidence
        super().__init__("The published EventRegistry targets a different identity registry. "
                         "Do not submit this Tokenomics 2.0 machine to the legacy registry.")


def verify_event(event, prepared):
    if len(event) != 10:
        raise ValueError("EventRegistry returned an unexpected event shape")
    machine, event_type, value, timestamp, data_hash, trust, source_chain, source_hash, metadata, currency = event
    expected_hash = bytes.fromhex(prepared["data_hash"][2:])
    if (machine != int(prepared["machine_id"]) or event_type != 1 or value != 1
            or timestamp != prepared["timestamp"] or bytes(data_hash) != expected_hash
            or trust != 0 or source_chain != 0 or bytes(source_hash) != b"\0" * 32
            or bytes(metadata) != prepared["metadata_utf8"].encode() or currency != ""):
        raise ValueError("on-chain event differs from the prepared paid job")
    return True


def verify_transaction(w3, registry, transaction_hash, machine_id, index, finalized_block):
    if not isinstance(transaction_hash, str) or not re.fullmatch(r"0x[0-9a-fA-F]{64}\Z", transaction_hash):
        raise ValueError("supply an explicit peaq transaction hash")
    transaction = w3.eth.get_transaction(transaction_hash)
    receipt = w3.eth.get_transaction_receipt(transaction_hash)
    if (transaction is None or receipt is None or transaction["blockNumber"] is None
            or transaction["blockNumber"] > finalized_block or receipt["blockNumber"] > finalized_block
            or transaction["blockNumber"] != receipt["blockNumber"]
            or receipt["status"] != 1 or transaction["to"].lower() != registry.address.lower()
            or receipt["to"].lower() != registry.address.lower()
            or ("0x" + bytes(receipt["transactionHash"]).hex()).lower() != transaction_hash.lower()):
        raise ValueError("transaction is not a successful finalized EventRegistry submission")
    topic = w3.keccak(text="EventSubmitted(uint256,uint256,uint8,uint256,string)")
    matches = []
    for log in receipt["logs"]:
        if log["address"].lower() == registry.address.lower() and log["topics"] and log["topics"][0] == topic:
            decoded = registry.events.EventSubmitted().process_log(log)["args"]
            if (decoded["machineId"] == int(machine_id) and decoded["eventIndex"] == index
                    and decoded["eventType"] == 1 and decoded["value"] == 1):
                matches.append(decoded)
    if len(matches) != 1:
        raise ValueError("transaction does not emit the selected activity event exactly once")
    return receipt["blockNumber"]


def bind_verified_registry(w3, block, contracts, registry_address):
    if not isinstance(registry_address, str) or not re.fullmatch(r"0x[0-9a-fA-F]{40}\Z", registry_address):
        raise ValueError("supply an explicit EVM EventRegistry address")
    from web3 import Web3
    from peaq_os_sdk.abis import load_abi
    from peaq_os_sdk.tokenomics.abis import INFO_DESK_ABI

    registry_address = Web3.to_checksum_address(registry_address)
    number = block["number"]
    if not w3.eth.get_code(registry_address, block_identifier=number):
        raise ValueError("no deployed EventRegistry code exists at the explicit address")
    info = w3.eth.contract(address=Web3.to_checksum_address(contracts["info_desk"]), abi=INFO_DESK_ABI)
    peer = info.functions.peer(w3.keccak(text="EVENT_REGISTRY")).call(block_identifier=number)
    # The operator guide explicitly configures EventRegistry separately. An
    # unset optional peer is not proof that the published address is absent.
    if peer.lower() != registry_address.lower() and registry_address.lower() != OFFICIAL_AGUNG_REGISTRY.lower():
        raise ValueError("EventRegistry address has no reviewed official source or matching InfoDesk peer")
    registry = w3.eth.contract(address=registry_address, abi=load_abi("EventRegistry"))
    # Source provenance alone does not establish compatibility. Legacy and
    # Tokenomics 2.0 registries have different owner/controller authorities.
    try:
        bound = registry.functions.identityRegistryAddress().call(block_identifier=number)
    except Exception as error:
        raise ValueError("EventRegistry provenance could not be established") from error
    if bound.lower() != contracts["machine_registry"].lower():
        code = w3.eth.get_code(registry_address, block_identifier=number)
        raise RegistryBindingMismatch({
            "schema": "fieldproof-peaq-registry-discovery-v1", "verified": False,
            "reason": "identity_registry_mismatch", "chain_id": 9990,
            "deployment_id": "agung-2026-08-28", "registry": registry_address,
            "source": REGISTRY_SOURCE if registry_address.lower() == OFFICIAL_AGUNG_REGISTRY.lower() else "InfoDesk peer",
            "info_desk_peer": peer, "registry_machine_binding": bound,
            "expected_machine_registry": contracts["machine_registry"],
            "code_bytes": len(code), "code_keccak": w3.keccak(code).to_0x_hex(),
            "finalized_block": number, "block_hash": block["hash"].to_0x_hex(),
            "signing": False,
        })
    if registry.functions.paused().call(block_identifier=number):
        raise ValueError("EventRegistry is paused")
    return registry, bound


def inspect(registry_address, machine_id, index, raw, policy, transaction_hash):
    if machine_id != policy["machine_id"]:
        raise ValueError("machine ID differs from approved policy")
    if type(index) is not int or index < 0:
        raise ValueError("event index must be nonnegative")
    prepared = prepare(raw, policy)
    w3, _deployment, block, contracts, _context = read_agung()
    registry, bound = bind_verified_registry(w3, block, contracts, registry_address)
    number = block["number"]
    count = registry.functions.getEventCount(int(machine_id)).call(block_identifier=number)
    if type(count) is not int or index >= count:
        raise ValueError("approved machine has no event at this index")
    event = registry.functions.getEventAt(int(machine_id), index).call(block_identifier=number)
    verify_event(event, prepared)
    submission_block = verify_transaction(w3, registry, transaction_hash, machine_id, index, number)
    return {"schema": "fieldproof-peaq-event-inspection-v1", "verified": True,
            "chain_id": 9990, "deployment_id": policy["deployment_id"], "machine_id": machine_id,
            "registry": registry_address, "registry_machine_binding": bound,
            "index": index, "event_count": count, "data_hash": prepared["data_hash"],
            "raw_data_sha256": prepared["raw_data_sha256"], "job_sha256": prepared["raw_data_sha256"],
            "transaction_hash": transaction_hash, "submission_block": submission_block,
            "finalized_block": number,
            "block_hash": block["hash"].to_0x_hex()}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", required=True)
    parser.add_argument("--registry", required=True, help="Explicit Agung EventRegistry address")
    parser.add_argument("--machine-id", required=True, help="Canonical decimal machine ID")
    parser.add_argument("--index", type=int, required=True)
    parser.add_argument("--transaction", required=True, help="Expected peaq submission transaction hash")
    parser.add_argument("--raw", required=True, help="Exact canonical paid job JSON file")
    args = parser.parse_args(argv)
    try:
        print(json.dumps(inspect(args.registry, args.machine_id, args.index,
                                 Path(args.raw).read_bytes(), load_policy(args.policy),
                                 args.transaction), sort_keys=True))
    except Exception as error:
        print(f"Event inspection failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
