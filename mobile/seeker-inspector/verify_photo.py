"""Verify an operator-assisted FieldProof photo against an external challenge and pin."""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import json
import re
import time
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature, encode_dss_signature

PROFILE = "fieldproof-photo-v1"
MAX_IMAGE_BYTES = 12 * 1024 * 1024


class EvidenceError(ValueError):
    pass


def _integer(value: object, name: str) -> int:
    if type(value) is not int or value < 1 or value > 2**53 - 1:
        raise EvidenceError(f"{name} must be a positive safe integer")
    return value


def verify_evidence(
    envelope: dict,
    jpeg: bytes,
    *,
    pin: str,
    job_id: str,
    provider: str,
    nonce: int,
    requested_at: int,
    now: int | None = None,
    max_capture_delay: int = 60,
    seen_ids: set[str] | None = None,
) -> dict:
    """Check exact external challenge, image bytes, P-256 signature, and local replay set.

    The device clock, camera-origin claim, key security level, and scene truth are not attested.
    """
    if not isinstance(envelope, dict) or envelope.get("schema") != PROFILE:
        raise EvidenceError("Unsupported photo envelope")
    if not re.fullmatch(r"[0-9a-f]{16}", job_id) or not re.fullmatch(r"[A-Za-z0-9_-]{3,64}", provider):
        raise EvidenceError("External job or provider is invalid")
    if type(nonce) is not int or nonce < 1 or nonce > 0x7FFFFFFF:
        raise EvidenceError("External nonce is invalid")
    requested_at = _integer(requested_at, "External requested_at")
    if envelope.get("job_id") != job_id or envelope.get("provider") != provider or envelope.get("nonce") != nonce:
        raise EvidenceError("Photo does not match the external job, provider, or nonce")
    if _integer(envelope.get("requested_at"), "requested_at") != requested_at:
        raise EvidenceError("Photo request timestamp does not match the external challenge")
    captured_at = _integer(envelope.get("captured_at"), "captured_at")
    if type(max_capture_delay) is not int or max_capture_delay < 0 or captured_at < requested_at or captured_at - requested_at > max_capture_delay:
        raise EvidenceError("Capture timestamp falls outside the requested window")
    now = int(time.time()) if now is None else _integer(now, "now")
    if captured_at > now + 2:
        raise EvidenceError("Capture timestamp is ahead of the verifier clock")
    if not isinstance(jpeg, bytes) or not 100 <= len(jpeg) <= MAX_IMAGE_BYTES or not jpeg.startswith(b"\xff\xd8") or not jpeg.endswith(b"\xff\xd9"):
        raise EvidenceError("Image is not a bounded JPEG byte stream")
    image_hash = hashlib.sha256(jpeg).hexdigest()
    if envelope.get("image_sha256") != image_hash:
        raise EvidenceError("JPEG hash does not match the signed envelope")
    if envelope.get("signature_algorithm") != "ECDSA_P256_SHA256" or envelope.get("signature_encoding") != "DER":
        raise EvidenceError("Unsupported photo signature format")
    if not isinstance(pin, str) or not re.fullmatch(r"04[0-9a-f]{128}", pin):
        raise EvidenceError("Trusted P-256 pin is invalid")
    if envelope.get("public_key_sec1_hex") != pin:
        raise EvidenceError("Envelope public key differs from the trusted pin")
    encoded = envelope.get("signature_base64")
    if not isinstance(encoded, str) or len(encoded) > 144:
        raise EvidenceError("Photo signature is missing or too long")
    try:
        signature = base64.b64decode(encoded, validate=True)
        if base64.b64encode(signature).decode("ascii") != encoded:
            raise EvidenceError("Photo signature has noncanonical base64")
        r, s = decode_dss_signature(signature)
        if encode_dss_signature(r, s) != signature:
            raise EvidenceError("Photo signature has noncanonical DER")
        key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), bytes.fromhex(pin))
    except (ValueError, binascii.Error) as error:
        raise EvidenceError("Photo signature or trusted pin is malformed") from error
    message = f"{PROFILE}|{job_id}|{provider}|{nonce}|{image_hash}|{requested_at}|{captured_at}".encode("utf-8")
    try:
        key.verify(signature, message, ec.ECDSA(hashes.SHA256()))
    except InvalidSignature as error:
        raise EvidenceError("Photo signature does not match the trusted key and challenge") from error
    receipt_id = hashlib.sha256(message + b"\x00" + signature).hexdigest()
    # Consume the requested challenge, not the signature. ECDSA signatures admit
    # another valid encoding, and a provider can also sign the same job again.
    replay_id = hashlib.sha256(f"{PROFILE}|{job_id}|{provider}|{nonce}|{requested_at}".encode()).hexdigest()
    if seen_ids is not None:
        if replay_id in seen_ids:
            raise EvidenceError("Photo receipt was already used")
        seen_ids.add(replay_id)
    return {"schema": PROFILE, "job_id": job_id, "provider": provider, "nonce": nonce,
            "image_sha256": image_hash, "requested_at": requested_at, "captured_at": captured_at,
            "receipt_id": receipt_id, "replay_id": replay_id, "signature": "valid",
            "fresh_now": now - captured_at <= max_capture_delay, "camera_origin": "not_attested"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--envelope", required=True, type=Path)
    parser.add_argument("--image", required=True, type=Path)
    parser.add_argument("--pin", required=True, help="Trusted SEC1 P-256 public key, 130 lowercase hex characters")
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--provider", required=True)
    parser.add_argument("--nonce", required=True, type=int)
    parser.add_argument("--requested-at", required=True, type=int, help="Unix seconds from an external challenge record")
    parser.add_argument("--max-capture-delay", type=int, default=60)
    args = parser.parse_args()
    try:
        if args.envelope.stat().st_size > 16_384:
            raise EvidenceError("Envelope exceeds 16 KB")
        if args.image.stat().st_size > MAX_IMAGE_BYTES:
            raise EvidenceError("JPEG exceeds 12 MB")
        envelope = json.loads(args.envelope.read_text(encoding="utf-8"))
        if envelope.get("image_file") != args.image.name:
            raise EvidenceError("Envelope image filename does not match the selected JPEG")
        result = verify_evidence(envelope, args.image.read_bytes(), pin=args.pin, job_id=args.job_id,
            provider=args.provider, nonce=args.nonce, requested_at=args.requested_at,
            max_capture_delay=args.max_capture_delay)
    except (OSError, json.JSONDecodeError, EvidenceError) as error:
        parser.exit(2, f"Verification failed: {error}\n")
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
