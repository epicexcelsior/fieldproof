"""Challenge-bound observations and explicit buyer policy for the contact demo."""

from dataclasses import dataclass
from decimal import Decimal
import re
import time

from .protocol.auth import DEFAULT_SECRET, create_auth_payload, generate_nonce, verify_receipt
from .protocol.models import InvocationReceipt, InvocationRequest
from .protocol.identity import ReceiptPublicKey

CONTACT_INPUT_PINS = frozenset({0, 1, 2, 3, 6, 7, 9, 18, 19, 20, 21, 22, 23})
CONTACT_SENSORS = frozenset(f"gpio{pin}-contact" for pin in CONTACT_INPUT_PINS)


@dataclass(frozen=True)
class ObservationContract:
    location: str = "demo-gate"
    metric: str = "gate.closed"
    max_age_seconds: int = 10
    max_price_usdc: str = "0.003"
    sensor: str | None = None

    def __post_init__(self):
        if not re.fullmatch(r"[a-z0-9-]{1,16}", self.location):
            raise ValueError("Location must contain 1–16 lowercase letters, digits, or hyphens")
        if self.metric != "gate.closed":
            raise ValueError("The MVP supports only gate.closed")
        if self.sensor is not None and (not isinstance(self.sensor, str) or self.sensor not in CONTACT_SENSORS | {"simulated-contact"}):
            raise ValueError("Select a supported GPIO contact or explicitly simulated contact")
        if type(self.max_age_seconds) is not int or not 1 <= self.max_age_seconds <= 30:
            raise ValueError("Freshness must be 1–30 seconds")
        price = Decimal(self.max_price_usdc)
        if not price.is_finite() or price <= 0:
            raise ValueError("Budget must be a positive finite USDC amount")


def observation_request(device_id: str, contract: ObservationContract, *, nonce=None, request_id=None,
                        now=None, secret=DEFAULT_SECRET) -> InvocationRequest:
    now = int(time.time()) if now is None else now
    nonce = generate_nonce() if nonce is None else nonce
    request_id = request_id or f"obs-{nonce:08x}"
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,16}", request_id):
        raise ValueError("Request ID must contain 1–16 letters, digits, hyphens, or underscores")
    if type(nonce) is not int or not 1 <= nonce <= 0x7fffffff:
        raise ValueError("Nonce must be a positive signed 32-bit integer")
    parameters = {"location": contract.location}
    expiration = now + 30
    return InvocationRequest(
        request_id=request_id, device_id=device_id, capability="state.observe", parameters=parameters,
        nonce=nonce, timestamp=now, expiration=expiration,
        authorization=create_auth_payload(request_id, "state.observe", nonce, expiration,
                                          device_id=device_id, parameters=parameters, timestamp=now, secret=secret),
    )


class EvidenceError(ValueError):
    """Evidence cannot satisfy this buyer's observation contract."""


class ObservationVerifier:
    def __init__(self, provider_keys: dict[str, str | ReceiptPublicKey]):
        # This is buyer configuration. Provider manifests cannot add keys to it.
        self.provider_keys = dict(provider_keys)
        self._consumed = set()

    def verify(self, receipt: InvocationReceipt, request: InvocationRequest,
               contract: ObservationContract, *, now=None) -> dict:
        now = int(time.time()) if now is None else now
        key = self.provider_keys.get(request.device_id)
        if key is None:
            raise EvidenceError("UNKNOWN_PROVIDER: buyer has no provisioned key")
        if receipt.status == "error" and receipt.protocol == request.protocol and receipt.request_id == request.request_id:
            code = receipt.error.get("code") if isinstance(receipt.error, dict) else None
            code = code if isinstance(code, str) and re.fullmatch(r"[A-Z][A-Z0-9_]{0,39}", code) else "UNSPECIFIED"
            # Error responses explain rejection. They never authorize a decision.
            raise EvidenceError(f"PROVIDER_ERROR: {code} (unsigned provider report, no accepted measurement)")
        if (receipt.protocol, receipt.request_id, receipt.provider, receipt.capability, receipt.nonce,
            receipt.parameters) != (request.protocol, request.request_id, request.device_id,
                                    "state.observe", request.nonce, {"location": contract.location}):
            raise EvidenceError("CHALLENGE_MISMATCH: evidence does not match this request")
        authenticated = (verify_receipt(receipt, public_key=key) if isinstance(key, ReceiptPublicKey)
                         else verify_receipt(receipt, secret=key))
        if not authenticated:
            raise EvidenceError("INVALID_SIGNATURE: observation fields failed authentication")
        result = receipt.result or {}
        accepted_sensors = (contract.sensor,) if contract.sensor else ("gpio9-contact", "simulated-contact")
        if (result.get("metric") != contract.metric or result.get("sensor") not in accepted_sensors
            or type(result.get("closed")) is not bool
            or type(result.get("stable_samples")) is not int
            or type(result.get("total_samples")) is not int
            or result["total_samples"] != 5 or not 0 <= result["stable_samples"] <= 5):
            raise EvidenceError("INVALID_MEASUREMENT: unexpected sensor or sample values")
        if result["stable_samples"] != result["total_samples"]:
            raise EvidenceError("UNSTABLE_MEASUREMENT: contact changed during sampling")
        start, end = receipt.started_at, receipt.completed_at
        if (type(start) is not int or type(end) is not int or not request.timestamp - 2 <= start <= end <= now + 2
            or now - end > contract.max_age_seconds or now > request.expiration):
            raise EvidenceError("STALE_EVIDENCE: observation is outside the freshness window")
        token = (receipt.provider, receipt.nonce)
        if token in self._consumed:
            raise EvidenceError("REPLAY_DETECTED: evidence was already consumed")
        self._consumed.add(token)
        return {
            "decision": "WAIT" if result["closed"] else "DISPATCH",
            "reason": "Gate contact is closed" if result["closed"] else "Gate contact is open",
            "closed": result["closed"], "age_seconds": max(0, now - end),
            "sample_agreement": f"{result['stable_samples']}/{result['total_samples']}",
            "confidence": None,
            "confidence_note": "Sample agreement is not calibrated confidence or independent corroboration",
            "receipt_identity": "pinned-device-p256" if isinstance(key, ReceiptPublicKey) else "public-demo-hmac",
            "evidence_mode": "simulated" if result["sensor"] == "simulated-contact" else "physical-contact-demo",
        }
