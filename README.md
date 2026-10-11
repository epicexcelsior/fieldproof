# FieldProof

**Pay a device for a fresh physical check. Verify its signed answer before using it.**

[Start here: story, demo, deck, and recording materials](https://epicexcelsior.github.io/fieldproof/start.html) · [Replay the real paid check](https://epicexcelsior.github.io/fieldproof/review.html?view=20261011-story) · [Inspect the original receipt](https://epicexcelsior.github.io/fieldproof/?record=20261011&present=1)

A laptop buys a new contact reading from an ESP32-C6 through Solana x402.
The device signs its answer. The buyer checks the device key, request, samples, signature, and answer's age.

The proposed first product is paid remote inspection jobs.
The buyer hypothesis is remote-operations software that lacks a reliable answer from an existing API.
A validated buyer, commercial price, and customer revenue remain absent.
[Plain-language explanation, alternatives, and business test](docs/competition/STORY.md).

## What works today

```text
Buyer selects device, question, price, and 10-second age limit
  → x402 quotes 0.001 Devnet test USDC
  → Solana settles payment to the device operator
  → ESP32 takes a new contact reading and signs its answer
  → buyer verifies source, request, signature, samples, and age
  → demo policy: fresh OPEN gives DISPATCH; otherwise WAIT
```

The October 11 purchase used a real ESP32 input and an actual Devnet token transfer.
See [the original signed purchase](docs/evidence/device-signed-purchase-20261011.json) and [the actual Solana transaction](https://explorer.solana.com/tx/3R8BHWyVCMMnMdH3J3dXoDmpHvwBcpMGk345Qf1XXwLDeHHkYZbqSwGaRBoCh3HK8Ksqbb7fvjuukBgSURLpA1Fj?cluster=devnet).

BOOT represents the contact. Released produces OPEN. Held produces CLOSED.
Both honest states fulfill the observation. Payment buys a check, not a preferred result.
The operator wallet receives tokens. The ESP32 does not hold the Solana wallet key.
The buyer is bounded software callable by an AI agent. No autonomous AI reasoning is demonstrated.
DISPATCH and WAIT are recommendations. This prototype controls no equipment.

## Understand, test, record, submit

| Task | Material |
|---|---|
| Find every current artifact | [Material hub](docs/start.html), [documentation map](docs/README.md) |
| Understand the proposed business | [Story](docs/competition/STORY.md), [pilot questions](docs/competition/PILOT.md) |
| See working features and gaps | [Current status](docs/FOCUS.md), [executed verification](docs/VERIFICATION.md) |
| Test the physical board and record a payment | [Physical rehearsal](docs/competition/REHEARSAL.md) |
| Review the pitch and speaking scripts | [HTML deck](docs/competition/slides.html), [PDF](docs/competition/fieldproof-pitch.pdf), [PowerPoint](docs/competition/fieldproof-pitch.pptx), [scripts](docs/competition/VIDEO_SCRIPTS.md) |
| Collect feedback without a wallet | [Tester guide](docs/competition/TESTER_GUIDE.md) |
| Complete the three entries | [Requirements](docs/competition/REQUIREMENTS.md), [entry drafts](docs/competition/SUBMISSION_DRAFTS.md) |

## peaq integration status

The identity-linked job route resolves a registered device key before payment.
Its activity outbox links the job, original receipt, and Solana transaction.
Controlled tests cover the interfaces and recovery paths.

**No live FieldProof peaq identity or activity event exists.**
Current paid runs use Solana only and report peaq as not used.
An authoritative event deployment, funded testnet operator, activation, and independent readback remain open.
[Integration facts](docs/PEAQ_INTEGRATION.md) · [Paid-job execution and recovery](docs/JOBS.md).

## Run without hardware

Prerequisites: Python 3.10+, uv, and Node.js 22.13+ with node:sqlite.
Run from the repository root.

```bash
uv sync --project host
npm --prefix gateway ci
python3 scripts/demo.py sim
```

Open http://127.0.0.1:4022. Select **Get payment quote**, then **Run simulation**.
This mode simulates both payment and input. It moves no funds.
Open /proof for recorded evidence or /start for the material hub.
Stop this server before selecting another mode.

## Run with the ESP32

The deployed board uses GPIO9 BOOT. Keep other BLE clients closed.
Release BOOT for the first no-payment check.

```bash
python3 scripts/demo.py board --expect open
```

Hold BOOT throughout the next check. Do not press Reset.

```bash
python3 scripts/demo.py board --expect closed
```

The board returns five matching samples and a pinned P-256 signature.
Holding BOOT during reset can enter download mode.
[Input setup](docs/CONTACT_SETUP.md) · [Optional door-switch checklist](docs/HARDWARE_NEXT.md).

For the bounded paid route, follow [the physical rehearsal](docs/competition/REHEARSAL.md).
Payment requires the existing disposable Devnet wallet and its remaining operation budget.
The browser, batch, and agent share one wallet cap. Unknown operations block further payment.
Never delete a lock or reset a ledger to force another purchase.

## Inspect the recorded physical purchase

The [public inspector](https://epicexcelsior.github.io/fieldproof/?record=20261011&present=1) verifies the original receipt in the browser.
Its authentic answer is expired today. Signature validity does not restore freshness.
The optional payment query independently reads Solana Devnet. It starts no payment.
The [public replay](https://epicexcelsior.github.io/fieldproof/review.html?view=20261011-story) also shows historical acceptance at the original capture time.

Export only reviewed public assets to a new ignored directory:

```bash
python3 scripts/export_judge_demo.py .local/judge-demo-review
python3 -m http.server 8787 --bind 127.0.0.1 --directory .local/judge-demo-review
```

Open http://127.0.0.1:8787/start.html.
The exporter also creates a zip and SHA256 manifest. It refuses to overwrite earlier exports.
It includes the material hub, supporting deck, guide, recorded evidence, and browser verifier.
It copies no wallet, buyer journal, private key, backend, or payment endpoint.

## Verify

```bash
uv run --project host pytest -q
npm --prefix gateway test
```

For real hardware tests, use uv run --project host pytest -q --hardware.
The default Python suite explicitly skips hardware tests.
[Exact executed results and omissions](docs/VERIFICATION.md).

## Architecture and trust limits

[Architecture](docs/ARCHITECTURE.md) · [Protocol](docs/PROTOCOL.md) · [Receipt identity](docs/RECEIPT_IDENTITY.md) · [Detailed technical guide](docs/HOW_IT_WORKS.html) · [Recovery runbook](docs/DEMO.md).

A signature authenticates the provisioned device's claim. It does not prove physical truth, calibration, contents, safety, or completed work.
The ESP32 key resides in unencrypted storage. Commands use a public demonstration authorization key.
The board uses a prototype time anchor. Production authorization, protected keys, clock assurance, and installation trust remain open.
Payment and delivery are separate. No escrow or automatic refund exists.
The Seeker's proven role is an independent browser verifier. The [requested-photo app](mobile/seeker-inspector/README.md) remains an unpaid prototype.

The Python distribution and CLI are fieldproof. The capmesh command remains a compatibility alias.
Existing module names, BLE identifiers, and signed capmesh/0.1 receipts retain their values for compatibility.
