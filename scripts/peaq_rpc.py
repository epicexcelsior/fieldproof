"""Strict public FieldProof peaq policy and read-only Agung RPC helpers."""

from dataclasses import asdict
import json
from pathlib import Path
import re
import time

from cryptography.hazmat.primitives.asymmetric import ec

from scripts.check_peaq_readiness import (DEPLOYMENT_ID, RPC_URL, SDK_VERSION,
                                           RegistryReadContext, guarded_request)
from scripts.prepare_peaq_identity import BASE58, public_multikey

POLICY_SCHEMA = "fieldproof-provider-policy-v1"
SNAPSHOT_SCHEMA = "fieldproof-peaq-identity-v1"
POLICY_FIELDS = frozenset({"schema", "chain_id", "deployment_id", "machine_id", "provider", "sensor",
                           "owner", "controller", "receipt_public_key", "verification_method_id", "service_id",
                           "service_type", "service_endpoint", "pay_to", "max_identity_age_seconds"})
SNAPSHOT_FIELDS = frozenset({"schema", "chain_id", "deployment_id", "machine_id", "owner", "controller",
                             "receipt_public_key", "key_id", "authentication", "service", "subscription",
                             "available", "paused", "homed_locally", "relocating", "finalized_block",
                             "block_hash", "block_timestamp", "resolved_at", "contracts", "peers_match"})
CONTRACT_ROLES = frozenset({"info_desk", "machine_registry", "machine_state_and_sync",
                            "machine_subscription", "cross_chain_mirror", "machine_bridge_adapter",
                            "subscription_token_provision_pool"})
ADDRESS = re.compile(r"0x[0-9a-fA-F]{40}\Z")
DECIMAL = re.compile(r"(?:0|[1-9][0-9]*)\Z")
CORE_PAY_TO = "CaQAKBcwf7G5vXeu2RNuNGJafnJ8724Uj4wv9ivfxfQA"
TRANSACTION_READS = frozenset({"eth_getTransactionReceipt", "eth_getTransactionByHash"})


def read_request(send, method, params, *, read_block=None):
    """Extend the existing RPC guard with two exact transaction read methods."""
    if method in TRANSACTION_READS:
        if (not isinstance(params, (tuple, list)) or len(params) != 1
                or not isinstance(params[0], str)
                or not re.fullmatch(r"0x[0-9a-fA-F]{64}\Z", params[0])):
            raise ValueError("transaction reads require one 32-byte transaction hash")
        return send(method, params)
    return guarded_request(send, method, params, read_block=read_block)


def _fields(value, fields, name):
    if not isinstance(value, dict) or set(value) != fields:
        raise ValueError(f"{name} has missing or unknown fields")


def _address(value, name):
    if not isinstance(value, str) or not ADDRESS.fullmatch(value) or int(value[2:], 16) == 0:
        raise ValueError(f"{name} must be a nonzero EVM address")
    return value


def _machine_id(value):
    if not isinstance(value, str) or not DECIMAL.fullmatch(value) or len(value) > 78 or not int(value) < 2**256:
        raise ValueError("machine_id must be a canonical uint256 decimal string")
    return value


def _public_key(value):
    if not isinstance(value, str) or not re.fullmatch(r"04[0-9a-f]{128}\Z", value):
        raise ValueError("receipt_public_key must be lowercase SEC1 P-256 hex")
    ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), bytes.fromhex(value))
    return value


def _solana_recipient(value):
    if not isinstance(value, str) or not 32 <= len(value) <= 44 or any(c not in BASE58 for c in value):
        raise ValueError("pay_to must be a Solana base58 public key")
    number = 0
    for char in value:
        number = number * 58 + BASE58.index(char)
    raw = b"\0" * (len(value) - len(value.lstrip("1"))) + (number.to_bytes((number.bit_length() + 7) // 8, "big") if number else b"")
    if len(raw) != 32:
        raise ValueError("pay_to must decode to 32 bytes")
    if raw == b"\0" * 32:
        raise ValueError("pay_to must be a nonzero Solana public key")
    return value


def validate_policy(policy):
    _fields(policy, POLICY_FIELDS, "provider policy")
    if policy["schema"] != POLICY_SCHEMA or type(policy["chain_id"]) is not int or policy["chain_id"] != 9990:
        raise ValueError("provider policy has the wrong schema or chain")
    if policy["deployment_id"] != DEPLOYMENT_ID:
        raise ValueError("provider policy has the wrong deployment")
    _machine_id(policy["machine_id"])
    if not isinstance(policy["provider"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,31}\Z", policy["provider"]):
        raise ValueError("provider policy has an invalid provider")
    if policy["sensor"] != "gpio9-contact":
        raise ValueError("the competition job uses the installed GPIO9 contact profile")
    _address(policy["owner"], "owner")
    _address(policy["controller"], "controller")
    _public_key(policy["receipt_public_key"])
    if (policy["verification_method_id"] != "#receipt-key" or policy["service_id"] != "#contact-observation"
            or policy["service_type"] != "FieldProofBLEContactV1"):
        raise ValueError("provider policy changes the approved DID method or service")
    expected = f'urn:fieldproof:ble-contact:{policy["provider"]}:{policy["sensor"]}:state.observe'
    if policy["service_endpoint"] != expected:
        raise ValueError("provider policy service endpoint does not match provider and sensor")
    _solana_recipient(policy["pay_to"])
    if policy["pay_to"] != CORE_PAY_TO:
        raise ValueError("provider policy changes the current approved payment recipient")
    if type(policy["max_identity_age_seconds"]) is not int or policy["max_identity_age_seconds"] != 120:
        raise ValueError("provider policy must use a 120-second identity limit")
    return policy


def load_policy(path):
    return validate_policy(json.loads(Path(path).read_text()))


def validate_snapshot(snapshot, policy, *, now=None):
    validate_policy(policy)
    _fields(snapshot, SNAPSHOT_FIELDS, "identity snapshot")
    for name in ("chain_id", "deployment_id", "machine_id", "owner", "controller", "receipt_public_key"):
        left, right = snapshot[name], policy[name]
        if name in {"owner", "controller"}:
            left, right = str(left).lower(), right.lower()
        if left != right:
            raise ValueError(f"identity snapshot {name} differs from policy")
    if snapshot["schema"] != SNAPSHOT_SCHEMA or snapshot["key_id"] != policy["verification_method_id"]:
        raise ValueError("identity snapshot schema or key differs from policy")
    if snapshot["authentication"] is not True or snapshot["subscription"] != "active":
        raise ValueError("identity authentication or subscription is inactive")
    for name, expected in (("available", True), ("paused", False), ("homed_locally", True),
                           ("relocating", False), ("peers_match", True)):
        if snapshot[name] is not expected:
            raise ValueError(f"identity snapshot {name} does not satisfy policy")
    _fields(snapshot["service"], {"id", "type", "endpoint"}, "identity service")
    if snapshot["service"] != {"id": policy["service_id"], "type": policy["service_type"],
                                "endpoint": policy["service_endpoint"]}:
        raise ValueError("identity service differs from policy")
    if (type(snapshot["finalized_block"]) is not int or snapshot["finalized_block"] < 1
            or not isinstance(snapshot["block_hash"], str)
            or not re.fullmatch(r"0x[0-9a-fA-F]{64}\Z", snapshot["block_hash"])):
        raise ValueError("identity finalized block is invalid")
    for name in ("block_timestamp", "resolved_at"):
        if type(snapshot[name]) is not int or snapshot[name] <= 0:
            raise ValueError(f"identity {name} is invalid")
    if snapshot["block_timestamp"] > snapshot["resolved_at"]:
        raise ValueError("identity block time is in the future")
    current = int(time.time()) if now is None else now
    if (type(current) is not int or snapshot["resolved_at"] > current + 2
            or snapshot["block_timestamp"] > current + 2
            or current - snapshot["resolved_at"] > policy["max_identity_age_seconds"]
            or current - snapshot["block_timestamp"] > policy["max_identity_age_seconds"]):
        raise ValueError("identity snapshot is stale or from the future")
    if (not isinstance(snapshot["contracts"], dict) or set(snapshot["contracts"]) != CONTRACT_ROLES
            or any(not isinstance(v, str) or not ADDRESS.fullmatch(v) or int(v[2:], 16) == 0
                   for v in snapshot["contracts"].values())):
        raise ValueError("identity deployment contracts are invalid")
    return snapshot


def read_agung(*, block_number=None):
    """Pin reads to the finalized head or an explicitly bounded historical block."""
    from importlib.metadata import version
    if version("peaq-os-sdk") != SDK_VERSION:
        raise ValueError(f"Use peaq-os-sdk=={SDK_VERSION}")
    from web3 import Web3, HTTPProvider
    from peaq_os_sdk.tokenomics.deployments import resolve_tokenomics20_deployment
    from peaq_os_sdk.tokenomics.abis import INFO_DESK_ABI

    class ReadOnlyHTTPProvider(HTTPProvider):
        read_block = None

        def make_request(self, method, params):
            return read_request(super().make_request, method, params, read_block=self.read_block)

    transport = ReadOnlyHTTPProvider(RPC_URL, request_kwargs={"timeout": 15}, exception_retry_configuration=None)
    w3 = Web3(transport)
    deployment = resolve_tokenomics20_deployment(DEPLOYMENT_ID)
    if w3.eth.chain_id != 9990 or deployment.chain_id != 9990:
        raise ValueError("RPC chain differs from Agung deployment")
    block = w3.eth.get_block("finalized")
    if block_number is not None:
        if type(block_number) is not int or not 0 < block_number <= block["number"]:
            raise ValueError("historical identity reads require an already finalized positive block")
        block = w3.eth.get_block(block_number)
        if block["number"] != block_number:
            raise ValueError("RPC returned a different historical identity block")
    number = block["number"]
    transport.read_block = number
    contracts = asdict(deployment.contracts)
    for role, address in contracts.items():
        if not w3.eth.get_code(Web3.to_checksum_address(address), block_identifier=number):
            raise ValueError(f"No code at published {role}")
    info = w3.eth.contract(address=Web3.to_checksum_address(contracts["info_desk"]), abi=INFO_DESK_ABI)
    for role, address in contracts.items():
        if role != "info_desk":
            peer = info.functions.peer(Web3.keccak(text=role.upper())).call(block_identifier=number)
            if peer.lower() != address.lower():
                raise ValueError(f"InfoDesk peer differs for {role}")
    return w3, deployment, block, contracts, RegistryReadContext(w3, deployment)
