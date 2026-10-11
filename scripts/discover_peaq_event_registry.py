"""Check an officially sourced Agung EventRegistry without signing."""

import argparse
import json
import sys

from scripts.inspect_peaq_event import (OFFICIAL_AGUNG_REGISTRY, REGISTRY_SOURCE,
                                       RegistryBindingMismatch, bind_verified_registry)
from scripts.peaq_rpc import read_agung


def discover(address=OFFICIAL_AGUNG_REGISTRY):
    w3, deployment, block, contracts, _context = read_agung()
    registry, bound = bind_verified_registry(w3, block, contracts, address)
    return {"schema": "fieldproof-peaq-registry-discovery-v1", "verified": True, "chain_id": 9990,
            "deployment_id": deployment.deployment_id, "registry": registry.address,
            "source": REGISTRY_SOURCE if address.lower() == OFFICIAL_AGUNG_REGISTRY.lower() else "InfoDesk peer",
            "registry_machine_binding": bound, "finalized_block": block["number"],
            "block_hash": block["hash"].to_0x_hex(), "signing": False,
            "signer_eligibility": "requires an active machine and submitEvent simulation"}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", default=OFFICIAL_AGUNG_REGISTRY,
                        help="Official guide address, or a matching live InfoDesk peer")
    args = parser.parse_args(argv)
    try:
        print(json.dumps(discover(args.registry), sort_keys=True))
    except RegistryBindingMismatch as error:
        print(json.dumps(error.evidence, sort_keys=True))
        print(str(error) + " No signing occurred.", file=sys.stderr)
        return 1
    except Exception as error:
        print(f"Agung activity registry discovery failed: {error}. Do not substitute another deployment.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
