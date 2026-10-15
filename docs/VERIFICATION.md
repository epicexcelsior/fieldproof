# FieldProof verification

## October 15 repository checks

- `uv run --project host pytest -q`: **249 passed, 40 skipped**.
- `npm --prefix gateway test`: **147 passed, no failures or skips**.
- `uv run --project host pytest -q tests/test_judge_export.py`: **8 passed, 1 optional SDK skip**.
- Static export: completed. All exported material-hub links returned HTTP 200.
- Chrome: technical guide interaction checks passed. The material hub passed desktop/mobile layout and status checks.
- All tracked Markdown/HTML relative file links resolve. Public evidence files remain unchanged.
- The feedback server returned HTTP 200 for all three current Markdown routes.

The export subset overlaps the full Python suite. Do not add their test counts.

The Python skips cover hardware and optional SDK dependencies. This cleanup ran no hardware capture, payment, or chain write.
These results establish software regression coverage. They do not establish production security or truthful sensing.

## October 13 submission release checks

The declared gateway suite passed **147 tests**. The core Python suite passed **249 tests with 40 skips**.
The isolated peaq SDK integration and export subset passed **79 tests with no skips**.
These suites overlap. Their counts must not be added together.
The core skips cover hardware and optional SDK dependencies. This final audit ran no new hardware capture or payment.

A new read-only Agung inspection passed at finalized block `11142157`.
It matched the original public job hash, successful Storage transaction, and both historical machine-authority checks.
The original public evidence remains unchanged. Native Storage remains owner-controlled.

Anonymous YouTube metadata confirms the [product demo](https://youtu.be/eDuEJVad3oY) at 97 seconds
and the [founder pitch](https://www.youtube.com/watch?v=LToCUlqJuao) at 98 seconds.
Both videos are unlisted. Automated video downloads returned HTTP 403, so they do not establish playback or audio review.

The public guide passed Chrome checks at 1280, 390, and 320 pixels.
Checks covered keyboard navigation, original signature, expiry, changed-copy rejection, restoration, and legacy links.
The check made only read requests and started no measurement or payment.
The production npm audit reports no known vulnerabilities. A selected-pattern scan found no credentials in tracked text files.
These checks are not a security audit or a guarantee about competition judging.

The local job page now reads the operator's finalized work-record status without resetting payment verification or receipt age.
Regression tests cover unchanged job binding, readback hash and authority, and switching tickets during a pending query.
The static export includes all five slide images. The deck states registered identity and signing key instead of claiming reputation.
Colosseum submission now reports submitted. The separate Earn entries remain unverified.

## October 12 real peaq activation and paid work

The approved operator received 3 AGUNG. The current preview matched the 0.4-token bond and approved gas bounds.
The first activation guard stopped before signing because its private web3 encoder did not align the SDK DID mapping.
The public ABI encoder fixes that failure. A no-network regression reproduced the failure and passed after the change.
The approval transaction confirmed. Its journal contained no activation signature. The remaining activation then confirmed without another approval.
The first finalized identity read preceded activation finality and reported an absent token. A later finalized read established the actual identity.

- Activation: `0x1f49e3c0b4b35f2ced2026953184715c97d73b3ee3c4d36adc9ae81290d23ded`, block `11135495`.
- Independent identity read: finalized block `11135503`, matching owner, controller, P-256 key, and GPIO9 service.
- New job: `31be41e44b1e40c5`. The buyer resolved the actual identity before payment.
- Solana Devnet payment: `4URoDYxkuM3VRgE8AoPCXu896sotnPMReb6AMi4rW4Rr3pi3xtCEUbVBfVriRvmEdqX1mgzDPCkACHc2Cc7SPD2Y`, slot `510265773`.
- Real BLE reading: OPEN, five matching samples, original P-256 signature. No human button press was required.
- Approved native Storage write: `0xe88e808f6089fbbf91e5eb5e0a8997ab3e25859f94ce807f8cf8b88a0cb99fad`, block `11135606`.
- Independent Storage inspection: finalized block `11135611`. Exact job hash, storage bytes, successful transaction, and both historical authority checks passed.

[The reviewed public packet](evidence/current-job.json) contains only public job fields and recorded readbacks.
Private wallet files, signed-transaction journals, account data, founder working materials, and review messages remain local.
The work record uses native peaq Storage. It does not claim an EventRegistry event, Machine Credit Rating, or commercial revenue.

## Versions and limits

The submission used ESP-IDF 6.1.0, esptool 5.4.0, Node.js 24.10.0, CPython 3.13.13, Solana Kit 5.5.1, and x402 2.27.0.
The chip is ESP32-C6FH4 revision v0.2, with 4 MB embedded flash and USB Serial/JTAG.
The signed-receipt firmware identity remains in [the original identity record](evidence/receipt-identity-checks.json).

Historical HMAC receipts and current P-256 receipts remain distinct.
Unencrypted device keys, host-anchored time, reboot-cleared replay state, and one observer remain prototype limits.
No customer equipment, protected installation, commercial revenue, or production authorization is demonstrated.

## Earlier execution records

[The full verification record at the submitted source revision](https://github.com/epicexcelsior/fieldproof/blob/a6f37abd2e903ff391cdaf1426505d530172072c/docs/VERIFICATION.md)
preserves the October 1–13 chronology, failures, firmware hashes, hardware checks, and historical test counts.
The original public receipts and capture times remain unchanged under [evidence](evidence/).
