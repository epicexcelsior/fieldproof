# FieldProof Seeker photo inspector

This is an **operator-assisted extension prototype**. It does not take a Solana payment, resolve peaq identity, submit an event, or join the paid provider catalog. Its Camera2 preview and Android Keystore signing path compiled locally. No phone install, capture, or Keystore result was tested in this sandbox.

The app records a fresh request before it enables one JPEG capture. It signs this UTF-8 message with a persistent Android Keystore P-256 key:

```text
fieldproof-photo-v1|job_id|provider|nonce|image_sha256|requested_at|captured_at
```

`requested_at` and `captured_at` are decimal Unix seconds from the phone clock. `image_sha256` is lowercase SHA-256 of the exact saved JPEG bytes. `signature_base64` contains a DER-encoded ECDSA P-256 SHA-256 signature. The public key is uncompressed SEC1 hex. The private key never enters the JSON envelope. The reported Keystore security level is metadata, not attestation. Neither the signature nor the image hash proves camera origin, scene truth, location, or safe equipment operation.

The app records `captured_at` when the JPEG reaches `ImageReader`, not at sensor exposure. The key persists across app launches and updates. Uninstalling the app can remove its Keystore key.

## Build without network access

From the repository root, run:

```bash
mobile/seeker-inspector/build-offline.sh
```

The script uses the installed Android SDK platform 35, build tools 35.0.0, and JDK. It invokes `javac`, `d8`, `aapt2`, `zipalign`, and `apksigner` directly. It downloads no dependencies. The signed debug APK and debug signing key stay in ignored `.local/competition/seeker-build/`. The build script sets a fixed password only for that local debug key. Do not publish or reuse it for a release build.

The compile-only result in this session is [the local debug APK](../../.local/competition/seeker-build/seeker-inspector-debug.apk). `apksigner verify` passed its v3 signature check. The package requests CAMERA permission and has no INTERNET permission. It is debuggable so `run-as` can export its private app files for review.

## Capture and export on a connected Android phone

1. Install the local APK with `adb install -r .local/competition/seeker-build/seeker-inspector-debug.apk`.
2. Open **FieldProof Photo** in the foreground.
3. Grant Camera permission in the prompt. For a debug setup, `adb shell pm grant com.fieldproof.seekerinspector android.permission.CAMERA` grants the same permission.
4. Enter the externally selected 16-character lowercase hex job ID and positive nonce. Keep provider `seeker-inspector-01` unless the test defines another ID.
5. Select **Request fresh photo**. Record the displayed `requested_at` Unix second with the external job challenge.
6. Check the preview. Select **Capture requested photo** once. The app saves a JPEG and JSON envelope under its internal `files/jobs/` directory.
7. List the saved names with `adb shell run-as com.fieldproof.seekerinspector ls files/jobs`.
8. Export the matching pair with the commands below. Replace each example basename with the exact name from step 7.

```bash
adb exec-out run-as com.fieldproof.seekerinspector cat files/jobs/0123456789abcdef-1791000004-example.json > /tmp/fieldproof-photo.json
adb exec-out run-as com.fieldproof.seekerinspector cat files/jobs/0123456789abcdef-1791000004-example.jpg > /tmp/fieldproof-photo.jpg
```

Keep the image local until the operator reviews it for personal or site data. The app does not copy it to shared storage.

## Verify the exact challenge and photo

Pin the public SEC1 key from a trusted first-use transfer. Do not copy it from the envelope under inspection. Use the job ID, nonce, provider, and request timestamp from the external challenge record:

```bash
python3 mobile/seeker-inspector/verify_photo.py \
  --envelope /tmp/fieldproof-photo.json \
  --image /tmp/fieldproof-photo.jpg \
  --pin 04YOUR_TRUSTED_128_HEX_DIGITS \
  --job-id 0123456789abcdef \
  --provider seeker-inspector-01 \
  --nonce 12345 \
  --requested-at 1791000000
```

The verifier checks the external challenge, capture order and 60-second window, JPEG hash, canonical DER signature, and trusted public pin. It reports current freshness separately from signature validity. Its Python API accepts a caller-maintained `seen_ids` set to reject reuse of the requested challenge during one verifier session. A different valid signature cannot reset that challenge. A durable job ledger must enforce replay rejection across sessions before this becomes a paid provider. The verifier cannot prove that the phone clock is honest or the JPEG came from the camera.

Run the synthetic crypto tests with:

```bash
UV_CACHE_DIR=/tmp/fieldproof-uv-cache uv run --offline --project host pytest -q tests/test_phone_evidence.py
```

These tests generate temporary keys and test JPEG bytes. They make no claim about a Seeker capture or hardware-backed key support.
