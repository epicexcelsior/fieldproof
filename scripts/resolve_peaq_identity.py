"""Resolve one approved Agung machine identity at a single finalized block."""

import argparse
import json
import sys
import time

from scripts.check_peaq_readiness import observer_subject
from scripts.peaq_rpc import SNAPSHOT_SCHEMA, load_policy, read_agung, validate_snapshot
from scripts.prepare_peaq_identity import MACHINE_TYPE, public_multikey


def check_state_authority(policy, state, computed_id):
    """Check identity authority without claiming that historical state is fresh."""
    if state.machine_id != computed_id or str(computed_id) != policy["machine_id"]:
        raise ValueError("on-chain machine ID differs from approved policy")
    if state.owner.lower() != policy["owner"].lower() or state.controller.lower() != policy["controller"].lower():
        raise ValueError("on-chain owner or controller differs from approved policy")
    did = state.did_document
    if did.controller.lower() != policy["controller"].lower():
        raise ValueError("DID controller differs from approved policy")
    if len(did.authentication) != 1 or len(did.verification_methods) != 1:
        raise ValueError("DID authentication must use exactly the approved method")
    index = did.authentication[0]
    if index != 0:
        raise ValueError("DID authentication index differs from approved method")
    method = did.verification_methods[index]
    if (method.id != policy["verification_method_id"] or method.method_type != "Multikey"
            or method.controller.lower() != policy["controller"].lower()
            or method.public_key_multibase != public_multikey(policy["receipt_public_key"])):
        raise ValueError("DID method differs from approved public receipt key")
    if len(did.service_endpoints) != 1:
        raise ValueError("DID must expose exactly the approved observation service")
    service = did.service_endpoints[0]
    if (service.id != policy["service_id"] or service.service_type != policy["service_type"]
            or service.service_endpoint != policy["service_endpoint"]):
        raise ValueError("DID service differs from approved policy")
    if state.subscription.status != "active" or state.subscription.machine_id != computed_id:
        raise ValueError("machine subscription is not active")
    flags = state.pause_flags
    paused = any((flags.is_general_paused, flags.is_technical_paused, flags.is_operator_paused,
                  flags.is_subscription_paused))
    if paused or state.is_available is not True or state.is_homed_locally is not True or state.is_relocating is not False:
        raise ValueError("machine is paused, unavailable, foreign, or relocating")
    return method, service


def snapshot_from_state(policy, state, *, computed_id, block, contracts, resolved_at):
    method, service = check_state_authority(policy, state, computed_id)
    snapshot = {
        "schema": SNAPSHOT_SCHEMA, "chain_id": 9990, "deployment_id": policy["deployment_id"],
        "machine_id": policy["machine_id"], "owner": state.owner, "controller": state.controller,
        "receipt_public_key": policy["receipt_public_key"], "key_id": method.id,
        "authentication": True,
        "service": {"id": service.id, "type": service.service_type, "endpoint": service.service_endpoint},
        "subscription": "active", "available": True, "paused": False, "homed_locally": True,
        "relocating": False, "finalized_block": block["number"],
        "block_hash": block["hash"].to_0x_hex(), "block_timestamp": block["timestamp"],
        "resolved_at": resolved_at, "contracts": contracts, "peers_match": True,
    }
    return validate_snapshot(snapshot, policy, now=resolved_at)


def authority_at_block(policy, block_number):
    """Verify an activity signer's actual registered authority at its submission block."""
    from peaq_os_sdk.tokenomics.get_machine_management_state import get_machine_management_state
    w3, _deployment, block, _contracts, context = read_agung(block_number=block_number)
    state = get_machine_management_state(context, int(policy["machine_id"]))
    check_state_authority(policy, state, int(policy["machine_id"]))
    return {"machine_id": policy["machine_id"], "owner": state.owner, "controller": state.controller,
            "receipt_public_key": policy["receipt_public_key"], "finalized_block": block["number"],
            "block_hash": block["hash"].to_0x_hex(), "block_timestamp": block["timestamp"]}


def resolve(policy):
    from web3 import Web3
    from peaq_os_sdk.tokenomics.abis import MACHINE_REGISTRY_ABI
    from peaq_os_sdk.tokenomics.get_machine_management_state import get_machine_management_state

    w3, _deployment, block, contracts, context = read_agung()
    subject = observer_subject({"algorithm": "ecdsa-p256-sha256",
                                "providers": {policy["provider"]: policy["receipt_public_key"]}}, policy["provider"])
    registry = w3.eth.contract(address=Web3.to_checksum_address(contracts["machine_registry"]),
                               abi=MACHINE_REGISTRY_ABI)
    computed_id = registry.functions.computeTokenId(MACHINE_TYPE, subject).call(block_identifier=block["number"])
    if str(computed_id) != policy["machine_id"]:
        raise ValueError("approved machine ID differs from on-chain computed ID")
    state = get_machine_management_state(context, computed_id)
    return snapshot_from_state(policy, state, computed_id=computed_id, block=block,
                               contracts=contracts, resolved_at=int(time.time()))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", required=True, help="Reviewed public provider policy JSON")
    args = parser.parse_args(argv)
    try:
        print(json.dumps(resolve(load_policy(args.policy)), sort_keys=True, separators=(",", ":")))
    except Exception as error:
        print(f"Identity resolution failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
