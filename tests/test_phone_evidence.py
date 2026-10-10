"""Synthetic cryptographic fixtures for the phone photo profile; no device capture."""

import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature, encode_dss_signature


MODULE = Path(__file__).resolve().parents[1] / "mobile/seeker-inspector/verify_photo.py"
spec = importlib.util.spec_from_file_location("fieldproof_verify_photo", MODULE)
verify_photo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify_photo)


@pytest.fixture
def evidence(tmp_path):
    key = ec.generate_private_key(ec.SECP256R1())
    pin = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint).hex()
    # These bytes test the signed hash contract. They do not represent a camera capture.
    jpeg = b"\xff\xd8" + bytes(range(100)) + b"\xff\xd9"
    image_file = tmp_path / "synthetic.jpg"
    image_file.write_bytes(jpeg)
    image_hash = hashlib.sha256(jpeg).hexdigest()
    job_id, provider, nonce, requested_at, captured_at = "0123456789abcdef", "seeker-inspector-01", 12345, 1791000000, 1791000004
    message = f"fieldproof-photo-v1|{job_id}|{provider}|{nonce}|{image_hash}|{requested_at}|{captured_at}".encode()
    signature = key.sign(message, ec.ECDSA(hashes.SHA256()))
    envelope = {"schema": "fieldproof-photo-v1", "job_id": job_id, "provider": provider, "nonce": nonce,
        "requested_at": requested_at, "captured_at": captured_at, "image_sha256": image_hash,
        "image_file": image_file.name, "public_key_sec1_hex": pin, "signature_algorithm": "ECDSA_P256_SHA256",
        "signature_encoding": "DER", "signature_base64": base64.b64encode(signature).decode()}
    return envelope, jpeg, pin, dict(job_id=job_id, provider=provider, nonce=nonce,
        requested_at=requested_at, now=captured_at + 1)


def test_valid_synthetic_photo_signature_and_replay_rejection(evidence):
    envelope, jpeg, pin, expected = evidence
    seen = set()
    result = verify_photo.verify_evidence(envelope, jpeg, pin=pin, seen_ids=seen, **expected)
    assert result["signature"] == "valid"
    assert result["camera_origin"] == "not_attested"
    assert result["replay_id"] in seen
    assert result["fresh_now"] is True
    with pytest.raises(verify_photo.EvidenceError, match="already used"):
        verify_photo.verify_evidence(envelope, jpeg, pin=pin, seen_ids=seen, **expected)


def test_hash_challenge_key_and_timestamp_tampering_fail(evidence):
    envelope, jpeg, pin, expected = evidence
    changes = [
        (dict(envelope), jpeg[:-3] + b"X\xff\xd9", pin, expected, "hash"),
        (dict(envelope), jpeg, pin, {**expected, "nonce": expected["nonce"] + 1}, "nonce"),
        (dict(envelope), jpeg, pin, {**expected, "requested_at": expected["requested_at"] + 1}, "timestamp"),
        ({**envelope, "captured_at": envelope["captured_at"] + 1}, jpeg, pin, expected, "signature"),
        (dict(envelope), jpeg, "04" + "00" * 64, expected, "trusted pin"),
    ]
    for changed, image, trusted, challenge, reason in changes:
        with pytest.raises(verify_photo.EvidenceError, match=reason):
            verify_photo.verify_evidence(changed, image, pin=trusted, **challenge)


def test_capture_must_follow_request_within_window(evidence):
    envelope, jpeg, pin, expected = evidence
    with pytest.raises(verify_photo.EvidenceError, match="requested window"):
        verify_photo.verify_evidence({**envelope, "captured_at": expected["requested_at"] - 1}, jpeg, pin=pin, **expected)
    with pytest.raises(verify_photo.EvidenceError, match="requested window"):
        verify_photo.verify_evidence(envelope, jpeg, pin=pin, max_capture_delay=2, **expected)


def test_another_valid_signature_cannot_replay_the_same_requested_job(evidence):
    envelope, jpeg, pin, expected = evidence
    seen = set()
    verify_photo.verify_evidence(envelope, jpeg, pin=pin, seen_ids=seen, **expected)
    r, s = decode_dss_signature(base64.b64decode(envelope["signature_base64"]))
    order = int("FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551", 16)
    changed = {**envelope, "signature_base64": base64.b64encode(encode_dss_signature(r, order - s)).decode()}
    assert changed["signature_base64"] != envelope["signature_base64"]
    with pytest.raises(verify_photo.EvidenceError, match="already used"):
        verify_photo.verify_evidence(changed, jpeg, pin=pin, seen_ids=seen, **expected)


def test_cli_uses_external_challenge_and_matching_image_file(evidence, tmp_path):
    envelope, jpeg, pin, expected = evidence
    image = tmp_path / envelope["image_file"]
    image.write_bytes(jpeg)
    record = tmp_path / "envelope.json"
    record.write_text(json.dumps(envelope))
    command = [sys.executable, str(MODULE), "--envelope", str(record), "--image", str(image),
        "--pin", pin, "--job-id", expected["job_id"], "--provider", expected["provider"],
        "--nonce", str(expected["nonce"]), "--requested-at", str(expected["requested_at"])]
    # The fixture timestamp is in the past and the CLI uses the current clock.
    valid = subprocess.run(command, capture_output=True, text=True, check=False)
    assert valid.returncode == 0, valid.stderr
    assert json.loads(valid.stdout)["camera_origin"] == "not_attested"
    assert json.loads(valid.stdout)["fresh_now"] is False
    image.rename(tmp_path / "other.jpg")
    mismatch = subprocess.run(command[:command.index("--image") + 1] + [str(tmp_path / "other.jpg")] +
        command[command.index("--pin"):], capture_output=True, text=True, check=False)
    assert mismatch.returncode == 2
    assert "filename does not match" in mismatch.stderr
