# Run one peaq-linked physical-check job

FieldProof preserves Solana Devnet x402 prepayment and the existing ESP32 P-256 contact receipt.
The buyer checks a peaq identity before payment. It records one fulfilled observation as activity, not commercial revenue.
This is the optional Agung route. Use the [Solana rehearsal](competition/REHEARSAL.md) when peaq identity is not active.
That route claims no peaq identity or event. This route must not relax its live identity gate.

## Current state

The identity resolver, job envelope, bounded buyer tool, durable outbox, operator commands, and job workbench exist in code.
Live peaq activation and activity submission remain unverified.
The coordinator has laptop and device access. Founder-held BOOT footage and unlocked Seeker rehearsal remain open.
The public inspector still serves historical real evidence. It does not expose a funded signer.

Both OPEN and CLOSED can fulfill a paid observation.
The buyer's operational decision remains separate from payment.
Rejected evidence requires review. This prototype implements no escrow or automatic refund.

## Start with one safe command

Run from the repository root:

```bash
python3 scripts/competition_check.py
```

This runs focused gateway and Python checks. It creates private logs under `.local/competition/checks/`.
It makes no payment, chain write, device request, or installation.
Optional SDK checks skip in the core host environment. The log states each skip.
Add `--build-phone` to compile and verify the local debug APK without installation.
Before activation, add `--agung-preflight --activity-route storage` to read the live deployment and official Storage interface.
This preflight needs `FIELDPROOF_PEAQ_PYTHON`. It reads no wallet and creates no machine.
The reviewed official EventRegistry binds a legacy identity system. Keep that failed compatibility diagnostic.
Use the explicit peaq Storage path below for this Tokenomics 2.0 identity. It retains the identity and settlement checks.
Do not replace the authority gate with a guessed registry or a different network.
After configuring the isolated SDK and activating the approved identity, add `--live-read-only` to verify Storage and identity reads.
The live flag remains read-only. It cannot fund or activate the machine.

If execution access is unclear, run `python3 scripts/check_execution_access.py` in the laptop's normal terminal.
The report checks socket creation, loopback binding, DNS prerequisites, device authorization and local tools.
It records wallet existence and file mode without reading the wallet.
It omits raw command errors, device IDs and tailnet addresses. Reports use owner-only files and preserve prior runs.
An exit code of zero establishes network prerequisites only. Browser, live RPC, BLE capture and funding remain separate checks.

## Prepare the public provider policy

Use the provisioned public key in `host/capmesh/protocol/receipt_keys.json`.
Use `python -m scripts.prepare_peaq_identity` to prepare the exact machine type, immutable subject, and DID inputs.
Select a public owner and controller before activation. Never place a private key in the policy.
The founder's local policy is `.local/competition/provider-policy.json`.
A [public example](competition/provider-policy.example.json) shows the exact schema and disposable testnet owner.
Cloned installations must use their own reviewed owner. This example does not establish an activated machine.
The activation review must include the current bond quote, allowance, gas cap, and exact calls.

The policy has these required fields:

| Field | Value |
|---|---|
| `schema` | `fieldproof-provider-policy-v1` |
| `chain_id` | `9990` |
| `deployment_id` | `agung-2026-08-28` |
| `machine_id` | Exact computed uint256 ID, as a decimal string |
| `provider`, `sensor` | Approved provider and installed `gpio9-contact` |
| `owner`, `controller` | Explicit nonzero public EVM addresses |
| `receipt_public_key` | Independently provisioned lowercase uncompressed P-256 SEC1 point |
| `verification_method_id` | `#receipt-key` |
| `service_id`, `service_type` | `#contact-observation`, `FieldProofBLEContactV1` |
| `service_endpoint` | `urn:fieldproof:ble-contact:PROVIDER:SENSOR:state.observe` |
| `pay_to` | Existing approved Solana merchant from `gateway/constants.js` |
| `max_identity_age_seconds` | `120` |

An EVM owner and a Solana recipient do not prove common wallet ownership.
The approved local configuration supplies that operator claim.
The registry key must match the independently provisioned receipt key.

Install `peaq-os-sdk==0.10.0` in an isolated environment.
Do not add its full dependency stack to the gateway or core host.
Set `FIELDPROOF_PEAQ_PYTHON` to that environment's Python executable.

## Resolve the identity without payment

```bash
"$FIELDPROOF_PEAQ_PYTHON" -m scripts.resolve_peaq_identity --policy .local/competition/provider-policy.json
node gateway/agent-job.js --policy .local/competition/provider-policy.json
```

The resolver pins reads to one finalized block and checks deployed contracts and InfoDesk peers.
It checks the computed ID, owner, controller, authenticated Multikey, service, active subscription, and availability.
A missing identity, changed key, paused machine, stale snapshot, or network error blocks the purchase.
No offline snapshot replaces a failed live identity lookup.

## Run an explicitly approved test purchase

Use a funded disposable Devnet buyer. Never use a mainnet wallet.
Key-file errors state the failure without logging file contents or local paths.
Start the existing local gateway with the same purchase database as the agent tool.

```bash
node gateway/live-demo.js /path/to/disposable-devnet.keypair.json --peaq-policy .local/competition/provider-policy.json
```

Open `http://127.0.0.1:4026/jobs`.
Select the payment button once. Each click pays at most 0.001 Devnet USDC.
The shared controller permits at most 100 operations and blocks unresolved operations.
At 0.001 Devnet USDC per check, its lifetime transfer budget is 0.100 test USDC.
It persists the purchase ID before payment leaves the process.

For a bounded agent command against the configured gateway:

```bash
node gateway/agent-job.js --policy .local/competition/provider-policy.json --execute \
  --keypair /path/to/disposable-devnet.keypair.json \
  --origin http://127.0.0.1:4021
```

The local browser controller and agent command share the signer-specific operation lock and budget directory.
Stop the browser controller before the separate CLI command uses that signer.
The gateway must use `.local/purchases.sqlite`, which is the tool's default database.
The agent cannot select payment terms through the requested observation.

The buyer checks the device evidence immediately after delivery.
It saves the accepted job before the independent Solana query.
Only a job with a verified payment can enter the event-submission state.
The gateway ledger remains the source of truth for settlement and delivery.

## Exact job and event evidence

The `fieldproof-job-v1` envelope contains the original request, unchanged signed receipt, approved identity snapshot, payment terms, and acceptance time.
Its receipt digest is SHA-256 of canonical receipt JSON.
Its raw event bytes are canonical UTF-8 job JSON with no trailing newline.
Canonical keys use ASCII letters, digits, and underscores. Integers must fit the JavaScript safe range.
Machine IDs and token amounts remain decimal strings. Strings must contain valid Unicode.

```bash
"$FIELDPROOF_PEAQ_PYTHON" -m scripts.prepare_peaq_event \
  --policy .local/competition/provider-policy.json --raw .local/job.raw.json
```

The event uses activity type `1`, value `1`, empty currency, and self-reported trust level `0`.
It commits Keccak-256 of the exact job bytes.
The complete Solana signature remains in those bytes. The EVM `sourceTxHash` remains zero.
Devnet USDC is test money. The ESP32 flash key does not establish tamper-resistant hardware evidence.
Offline event preparation validates structure and signatures. It does not query Solana settlement.

## Preview and activate an Agung identity

Run the preview from a session with Agung RPC access. It uses no private key.
The manufacturer address is an operator claim. It does not establish an ESP32 manufacturer endorsement.
Set the public address and reviewed bond ceiling before this command.
Do not use the historical 0.4-token bond read as a current quote.

```bash
"$FIELDPROOF_PEAQ_PYTHON" -m scripts.peaq_operator preview \
  --policy .local/competition/provider-policy.json --manufacturer "$FIELDPROOF_MANUFACTURER" \
  --max-net-base-units "$FIELDPROOF_BOND_CAP"
```

Review the exact identity, current quote, allowance, token address, contract addresses, and gas ceiling.
After explicit test-write approval, run the activation once:

```bash
"$FIELDPROOF_PEAQ_PYTHON" -m scripts.peaq_operator activate \
  --policy .local/competition/provider-policy.json --manufacturer "$FIELDPROOF_MANUFACTURER" \
  --max-net-base-units "$FIELDPROOF_BOND_CAP" --max-total-gas-wei "$FIELDPROOF_GAS_CAP" \
  --key-file .local/competition/agung-operator.secret --journal .local/peaq-journals/activation-001.jsonl \
  --execute-agung-test-write
```

The key file contains only `private_key_hex`. Its permissions must be owner-only.
The signer permits chain 9990, exact reviewed call data, zero native transaction value, and bounded aggregate gas.
The ERC-20 allowance also has an exact bounded amount. The native-token precompile supplies the subscription bond.
The private journal saves signed transaction bytes and their hash before broadcast.
Never publish this journal. An interrupted activation requires reconciliation before another write.
After activation, run the read-only identity resolver. Activation output alone does not replace this check.

## Record one saved job through peaq Storage

Use this route after genuine activation and a new identity-gated paid check.
Do not attach a new identity snapshot to an earlier Solana-only receipt.
Set `FIELDPROOF_PURCHASE_ID` to the new saved purchase ID.

```bash
node gateway/peaq-event.js --action storage-preview --purchase "$FIELDPROOF_PURCHASE_ID" \
  --policy .local/competition/provider-policy.json --gas-cap-wei 10000000000000000
```

The preview reads real identity authority at the original request block and verifies the original finalized Solana payment.
It resolves current authority, requires an absent job key, and simulates the exact storage call.
It estimates gas, checks the balance, and signs nothing.
The public record uses `fieldproof.job:JOB_ID` and commits the complete unchanged job hash.
The official storage precompile is `0x0000000000000000000000000000000000000801`.
The record is peaq Storage activity, not an EventRegistry event or Machine Credit Rating.

After explicit approval for that exact job and gas ceiling, run once:

```bash
node gateway/peaq-event.js --action storage-submit --purchase "$FIELDPROOF_PURCHASE_ID" \
  --policy .local/competition/provider-policy.json --gas-cap-wei 10000000000000000 \
  --key-file .local/competition/agung-operator.secret --execute-agung-test-write
```

The outbox and private journal preserve the claim and signed bytes before broadcast.
Independent inspection verifies the successful finalized transaction, storage bytes, and registered authority at both relevant blocks.
The storage owner can change or remove an entry. This route does not claim immutable current storage.
An unknown result blocks automatic retries. Preserve the database and private journal.

Inspect the original transaction without signing:

```bash
node gateway/peaq-event.js --action storage-inspect --purchase "$FIELDPROOF_PURCHASE_ID" \
  --policy .local/competition/provider-policy.json
```

If SQLite has no transaction reference, recover its hash from the private journal and add `--transaction`.
Do not execute another write to recover a missing response.
Use the manifest and judge-export procedures below after the readback succeeds.

## EventRegistry route: compatibility remains blocked

Use the same purchase database as the gateway. These commands run from the repository root.
List saved jobs and prepare one event without signing:

```bash
node gateway/peaq-event.js --action list
node gateway/peaq-event.js --action prepare --purchase "$FIELDPROOF_PURCHASE_ID" \
  --policy .local/competition/provider-policy.json
```

If the independent payment query failed after delivery, verify that existing transfer:

```bash
node gateway/peaq-event.js --action verify-payment --purchase "$FIELDPROOF_PURCHASE_ID" \
  --policy .local/competition/provider-policy.json
```

This command starts no purchase. A failed query leaves the saved job pending.
If the buyer operation still requires review, stop the buyer process and restore its saved result:

```bash
node gateway/peaq-event.js --action recover-buyer --purchase "$FIELDPROOF_PURCHASE_ID" \
  --operation "$FIELDPROOF_OPERATION_ID" --policy .local/competition/provider-policy.json
```

This command independently verifies the old payment and signed job. It acquires the existing buyer lock.
It restores only the matching delivered operation. It retains the operation count, original receipt, and capture time.
It never starts a payment or makes old evidence fresh. A running or stale lock blocks recovery.
After a process crash, inspect the lock's PID and every saved purchase before removing a confirmed stale lock.
Never remove a live lock or delete operation records to reset the budget.
Event submission repeats an independent finalized Solana check and rejects mismatched token balances or transfer instructions.

The SDK's Agung deployment omits an EventRegistry address.
Check the official guide's separately configured address without a signer:

```bash
"$FIELDPROOF_PEAQ_PYTHON" -m scripts.discover_peaq_event_registry
```

The diagnostic accepts the reviewed official address or a matching InfoDesk peer.
It still requires the registry's identity binding to match the approved MachineRegistry.
The published Agung address currently binds the legacy IdentityRegistry. It fails this compatibility check.
Do not submit the Tokenomics 2.0 identity to that registry. Do not substitute a mainnet address.
[Deployment evidence and the separate native-storage path](PEAQ_INTEGRATION.md#october-11-host-preflight).

After explicit test-write approval, run:

```bash
node gateway/peaq-event.js --action submit --purchase "$FIELDPROOF_PURCHASE_ID" \
  --policy .local/competition/provider-policy.json --registry "$FIELDPROOF_EVENT_REGISTRY" \
  --gas-cap-wei "$FIELDPROOF_GAS_CAP" --key-file .local/competition/agung-operator.secret \
  --execute-agung-test-write
```

The outbox permits one worker to claim the job. It saves this claim before signing.
The operator preserves a unique private journal. It broadcasts each signed phase once.
The workflow saves transaction references, reads the finalized event independently, and marks the job confirmed.
Any uncertain write blocks another submission. The workflow never retries payment or broadcasts automatically.

## Recover without another payment

Preserve the operation ID, purchase ID, database, job bytes, and every submitted transaction hash.
An uncertain payment blocks another operation. Inspect the existing [payment recovery procedure](DEMO.md).
An event outbox claim persists before signing or submission.
After interruption, reconcile its saved transaction or chain event before any new submission.
Never reset a submitted or uncertain event to pending automatically.

After stopping every event worker, mark interrupted claims for review:

```bash
node gateway/peaq-event.js --action recover --workers-stopped
```

For a saved submission reference, inspect without signing:

```bash
node gateway/peaq-event.js --action inspect --purchase "$FIELDPROOF_PURCHASE_ID" \
  --policy .local/competition/provider-policy.json
```

If no reference reached SQLite, recover the transaction hash from the private journal.
Recover the event index from its finalized receipt. Then add `--registry`, `--transaction`, and `--index` to the inspection command.
The inspector must verify the saved job before the outbox accepts these references.
If no transaction exists, inspect the account nonce and pending transaction state.
This prototype has no automatic reset command. Preserve the database and escalate the unresolved attempt.

Export a public evidence manifest after reviewing its contents:

```bash
node gateway/peaq-event.js --action manifest --purchase "$FIELDPROOF_PURCHASE_ID" \
  --policy .local/competition/provider-policy.json --output .local/competition/job-manifest.json
```

The command creates an owner-only file. An existing file blocks the write. Select a new name to preserve earlier evidence.
The manifest contains the signed receipt, identity snapshot, payment readback, and event state.
The workbench accepts this file. Importing it does not establish current chain state.

## Include the reviewed job in the judge export

Run this command with the isolated peaq SDK after the saved event has a matching finalized readback:

```bash
"$FIELDPROOF_PEAQ_PYTHON" -m scripts.export_judge_demo .local/competition/judge-final \
  --job-manifest .local/competition/job-manifest.json \
  --provider-policy .local/competition/provider-policy.json --require-peaq
```

The command builds a new local directory and ZIP. It does not publish or submit either artifact.
The release gate checks the original signature, canonical job hash, payment terms, event Keccak hash, and recorded authority bindings.
It rejects pending events, mismatched readbacks, private receipt fields, and a different installed device key.
It preserves the original job bytes. It removes the private journal reference from the public packet.
These checks do not query either chain. Imported readbacks remain recorded evidence.

Open `jobs.html` in the export. Select **Load reviewed job from this export**.
The inspector retains the original capture time. Expired evidence remains WAIT.
No payment starts on page load, file import, transfer inspection, or packet export.
An in-flight transfer query cannot apply its result to another imported ticket.
The browser refreshes the age decision every second. A verified transfer does not keep an expired answer usable.
The browser resumes that timer after a page-cache return. It does not repeat the transfer query.
If the optional published packet fails to load, the workbench reports the error. Manual file inspection remains available.

Independent event inspection requires an explicitly approved Agung EventRegistry address.
Do not reuse a mainnet address or the legacy registry.
The inspector must establish the registry's deployment binding and compare all event fields with the exact job.
The job workbench shows recorded identity and event state. An imported file is not a current registry read.

## Verify the software

```bash
uv run --project host pytest -q
npm --prefix gateway test
```

If the runtime restricts Node child processes, run the same suite without process isolation:

```bash
node --test --test-isolation=none gateway/test/*.test.js
```

Socket-dependent integration tests still require loopback access.
Do not report a live hardware, chain, or visual pass from offline tests.

The safe competition command includes a connected, controlled rehearsal.
It exercises the real Express handlers, x402 buyer signing, original receipt checks, SQLite restart, and event workflow.
Its physical reading and chain responses are fixtures. It cannot establish a live hardware or chain result.

For browser interaction and layout QA, use an installed Playwright package and browser:

```bash
node scripts/check_jobs_ui.cjs /path/to/installed/playwright .local/competition/judge-final
```

Set `FIELDPROOF_BROWSER_EXECUTABLE` if Playwright needs an existing Chromium executable.
The runner intercepts static and RPC requests locally. It sends no payment or live chain query.
Its screenshots carry a QA-only label. Keep them separate from demonstration evidence.

## Record and release

Demonstrate three consecutive paid checks, one altered receipt rejection, and one stale receipt rejection.
Show identity resolution before payment and independently readable peaq activity after delivery.
Record the actual device and browser. Keep simulated or historical evidence labeled.
Review every public file before export, publication, or account submission.
The local founder package supplies video scripts, entry drafts, a deck, and a claim ledger.
The [Seeker extension](../mobile/seeker-inspector/README.md) supplies a separately signed requested-photo prototype.
It does not join the paid provider path. Include it in the video only after actual installation and capture verification.
