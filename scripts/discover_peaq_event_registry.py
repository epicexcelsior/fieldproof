"""Resolve the Agung EventRegistry peer without a wallet or chain write."""

import json
import sys

from scripts.inspect_peaq_event import bind_verified_registry
from scripts.peaq_rpc import _address, read_agung


def discover():
    from web3 import Web3
    from peaq_os_sdk.tokenomics.abis import INFO_DESK_ABI

    w3, deployment, block, contracts, _context = read_agung()
    info = w3.eth.contract(address=Web3.to_checksum_address(contracts["info_desk"]), abi=INFO_DESK_ABI)
    address = info.functions.peer(w3.keccak(text="EVENT_REGISTRY")).call(block_identifier=block["number"])
    _address(address, "InfoDesk EventRegistry peer")
    registry, bound = bind_verified_registry(w3, block, contracts, address)
    return {"schema": "fieldproof-peaq-registry-discovery-v1", "chain_id": 9990,
            "deployment_id": deployment.deployment_id, "registry": registry.address,
            "registry_machine_binding": bound, "finalized_block": block["number"],
            "block_hash": block["hash"].to_0x_hex(), "signing": False}


def main():
    try:
        print(json.dumps(discover(), sort_keys=True))
    except Exception as error:
        print(f"Agung activity registry discovery failed: {error}. Do not substitute another deployment.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
