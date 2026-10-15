# Demonstrate fresh physical evidence

Use the local simulator for reviewers without hardware. Use BLE when the ESP32 is attached.
Run commands from the repository root unless a step changes directories.
Start with the [short rehearsal and explanation questions](REHEARSAL.md).

## Pay and read with one click

Use this optional local server for an actual Devnet purchase. Use a disposable wallet with test USDC.
The provisioned ESP32 must be connected. Stop other Bluetooth tests before the purchase.

```bash
node gateway/live-demo.js /path/to/disposable-devnet.keypair.json
```

1. Open `http://127.0.0.1:4026/proof?present=1`.
2. Hold BOOT for CLOSED, or release BOOT for OPEN.
3. Select **Pay 0.001 USDC** once.
4. Keep the input unchanged until the signed reading appears.
5. Verify **VERIFIED TRANSFER**, **VALID**, and the reading's age.
6. Leave a fresh OPEN reading alone until **EXPIRED** and **WAIT** appear.
7. Open **Transaction ↗** to see the actual transfer.

The laptop signs the Solana payment with the local test wallet. No Phantom approval or browser key is required.
x402 quotes the price, settles payment, then authorizes the ESP32 observation.
The ESP32 signs its observation. The browser independently verifies that signature and the transfer.
BOOT changes only the input. Each click purchases a new reading. Reloading restores the last result without payment.
The displayed duration measures purchase through receipt delivery. It is not Solana confirmation latency alone.

Practice without funds at `http://127.0.0.1:4023/?present=1` after `python3 scripts/demo.py physical`.
That separate page uses the same physical input with simulated payment.

The signing server accepts only loopback requests with its exact origin and session token.
It fixes the recipient, Devnet mint, and price limit. It allows 100 shared purchases, totaling at most 0.100 test USDC.
It preserves operation records in ignored `.local/live-buyer/<public-address>/`. A directory lock prevents a second signer process.
Failures and unresolved records block another purchase. No automatic paid retry or refund exists.
If an operation fails, preserve its operation ID, purchase ID, local log, and ledger. Review the chain before recovery.
Do not delete a pending record or lock to bypass review. Normal shutdown removes the lock only when no purchase runs.

The ordinary inspector and standalone inspector remain read-only. Their servers contain no buyer-signing endpoint or private wallet.
`CAPMESH_GATEWAY_PORT` selects another free port for this explicit signing-server command.

### Use a private Helius Devnet RPC

Store the Helius API key in ignored `.local/competition/helius-devnet.secret`. Set file permissions to `0600`.
The local CLI tools load this file automatically. `HELIUS_API_KEY` or `FIELDPROOF_HELIUS_KEY_FILE` can supply another private configuration.
The endpoint remains fixed to `https://devnet.helius-rpc.com/`. Startup prints the provider hostname, never the key or complete URL.
The buyer, payment queries, and peaq operator's Solana checks use this configuration.
The local job inspector queries a server proxy for the selected purchase's stored transaction.
The browser independently checks the returned transfer data. It receives no RPC key and cannot select another RPC method.
Public static inspectors retain the public Devnet endpoint. They contain no private credential.

The external x402 facilitator controls its own RPC. Its pending response does not prove that a payment failed.
If it reports `settlement_pending`, the gateway independently queries the exact transaction through the configured RPC.
It checks the token transfer and original signed-message hash before measurement. It signs or broadcasts no replacement payment.
An unavailable or mismatched query preserves `settlement_unknown` and blocks another payment.

For a board with a known Bluetooth MAC address, add `--ble-address AA:BB:CC:DD:EE:FF`.
Use the actual address from trusted local setup. This path uses one connection for its manifest and observation.
The trusted signing key still authenticates the answer. The buyer still verifies its challenge, samples, and age.
An unavailable board or different provider causes failure. The ordinary discovery path remains the default.
The compact screen shows Quote → Pay → Read → Verify and a timestamped event log.
The settlement event comes from the gateway ledger. Transfer verification comes from the browser's separate Devnet query.
Dots follow actual progress. Age animation follows the signed time and current browser clock.
Select **Details** for addresses, the full receipt, and a manual transfer-query retry.

## Use the rehearsal launcher

Run commands from the repository root. The launcher never pays, flashes firmware, or drives a GPIO output.

| Command | Result | Radio and funds |
|---|---|---|
| `python3 scripts/demo.py check` | Check installed Node/SQLite, gateway dependencies, and host CLI | No radio or funds |
| `python3 scripts/demo.py guide` | Serve the illustrated guide on localhost port 8788 | No radio or funds |
| `python3 scripts/demo.py sim` | Start the no-hardware purchase rehearsal on port 4022 | Simulated contact and payment |
| `python3 scripts/demo.py board --expect open` | Record one bounded input from the existing GPIO9 board | Real BLE, no payment |
| `python3 scripts/demo.py board --expect closed` | Verify held BOOT and fail if the action differs | Real BLE, no payment |
| `python3 scripts/demo.py physical` | Start the browser's real-input rehearsal on port 4023 | Real BLE, simulated payment |
| `python3 scripts/demo.py cases` | Execute eight two-observer software scenarios | Signed fixtures, no hardware or payment |

Hold BOOT before the CLOSED check. Keep it held until the result appears. Do not press Reset.
The board command writes a new ignored JSONL log. It preserves failures and performs no automatic retry.
The bounded worker's timeout and cleanup remain those of the diagnostic below.
Stop a server with Ctrl+C in its own terminal. An occupied port causes refusal. Select another `--port` when needed.
The [HTML guide](HOW_IT_WORKS.html#run) owns the beginner procedure. The commands below remain the advanced paths.

## Record scheduled input checks

Use this diagnostic to measure delivery reliability. It reads BOOT and verifies each device signature, challenge, sample count, and age.
It never invokes payment, resets the board, or drives a GPIO output.

Prerequisites: host setup, POSIX process groups, the attached provisioned board, and no other active BLE tests or scans.
Keep the current firmware and pin configuration unchanged during the run.

```bash
uv run --project host python scripts/soak_observations.py --count 120 --interval 120 --output .local/soak/oct02-overnight.jsonl
```

Each scheduled sample uses a new challenge. A failure remains a failure in the log.
The runner stops after three consecutive failures. It does not retry or replace a failed observation.
The worker has a 45-second output deadline. Termination gets two seconds for SIGTERM and two seconds for SIGKILL.
The runner stops immediately if the worker cannot be reaped. It never starts another sample beside that worker.
Press Ctrl+C to stop the run and record an interruption.

The interval starts after each completed sample. The command runs for approximately four hours with normal delivery times.
Raw JSONL logs contain public receipts and local diagnostic errors. They remain inside ignored `.local` state.
An existing log causes refusal. Select a new filename for another run.
The start record stores the source revision, dirty-state flag, file hashes, and interpreter/dependency versions.
Use the final summary and actual completed count. An interrupted run does not establish an overnight pass.
These checks establish neither external-gate accuracy nor a service-level guarantee.

## Recorded demonstration

Use the [2:30 signed-receipt walkthrough](assets/fieldproof-signed-receipt.webm) for the current technical demonstration.
It inspects a recorded public Devnet purchase and executes browser verification and attacks. It has captions and no audio.
The October 4 version separates its simulated unpaid quote from the earlier actual Devnet purchase.
Its focused receipt scene shows all four buyer checks and the selected experiment. Current-time expiry remains active.

To reproduce the current walkthrough, start the local simulator with `npm --prefix gateway run demo`.
Use an installed Playwright package and its Chromium browser. Select a new ignored output directory.

```bash
node scripts/record_identity_demo.cjs /path/to/installed/playwright .local/identity-recording-new http://127.0.0.1:4022
```

The recorder creates one unpaid quote. It never pays or invokes hardware.
It labels the gateway mode, verifies each browser experiment, and saves the final file only after every scene passes.
It refuses an existing final recording. Inspect the video before replacing the submission artifact.

### Record a short visual proof companion

Export the [standalone inspector](../README.md#inspect-the-recorded-physical-purchase), then serve its directory on localhost.
Use an installed Playwright package and Chromium. Select a new ignored recording directory.

```bash
node scripts/record_receipt_story.cjs /path/to/installed/playwright .local/receipt-story-new http://127.0.0.1:8787/
```

The directory URL must end in `/`. The recorder accepts no URL credentials, query, or fragment.
It records the flow picture, actual read-only Devnet payment check, receipt attacks, recorded input pair, and next buyer test.
It permits static GET requests and one Devnet `getTransaction` query. It never pays or invokes hardware.
A failed query or browser error prevents the completed video. The output includes `recording.json` with the observed transfer.
The final October 5 local capture lasts 75.64 seconds, with captions and no audio.
Use this short companion to understand the proof. Retain the 2:30 technical walkthrough for a required longer video.
Review public viewing links and video-length requirements before human submission. The recorder publishes nothing.

The older recordings below preserve historical simulator and HMAC demonstrations.

[Watch the 69-second screen recording](assets/fieldproof-demo.webm). It shows simulated payment and simulated contact evidence.
The final scene includes results from the executed CLI adversarial loop. The recording has no audio.

To reproduce it, start open and closed simulators on ports 4022 and 4024.
Run `node scripts/record_demo.cjs /path/to/installed/playwright` from the repository root.
Playwright requires its installed Chromium browser.

The MVP track requires a 2–3 minute video. The [2:30 presentation](assets/fieldproof-walkthrough.webm) meets that length.
It combines unchanged simulator footage with explanatory title cards. It has no audio.
Run `python3 scripts/build_walkthrough.py` to reproduce it with ffmpeg, ffprobe, and the system Lato fonts.
The build checks the source hash and duration. It replaces the local artifact only after those checks pass.
The [video scripts](competition/VIDEO_SCRIPTS.md) contain the scene sequence. [Submission status](SUBMISSION.md) records completed and unverified entries.

The extended recorder expects gateways on ports 4021, 4022, 4023, and 4024.
Port 4023 uses real BLE contact with simulated settlement. Port 4024 simulates a closed contact.
Run `node scripts/record_demo.cjs /path/to/installed/playwright docs/assets --submission`.
The recorder preserves the final artifact only after every scene passes. The [2:30 live walkthrough](assets/fieldproof-submission.webm) passed all scenes.
It includes a real BLE observation with simulated payment. It predates the verified public payment and human state-change checks.
The current script uses an updated quote caption. Add the newer evidence before uploading a final submission video.

## Short rehearsal script

1. Open the dispatch desk at `http://127.0.0.1:4022` after `npm run demo` in `gateway`.
2. Explain the question: an autonomous vehicle needs fresh gate state before it moves.
3. Select **Get payment quote**. Show 0.001 Devnet USDC and the 402 response.
4. Select **Run simulation**. Show the labeled payment mode, receipt, and DISPATCH decision.
5. Wait eleven seconds. Show WAIT after evidence expires.
6. Run `uv run --project host capmesh observe-demo --simulated` in another terminal.
7. Show the cheaper stale provider's rejection and the fresh provider's selection.
8. Show the rejected response replay, changed challenge, changed state, and request replay.
9. Explain the demand ledger and the path toward independent observers.

No funds move in this script. Do not describe fake facilitator settlement as an on-chain payment.
For closed-contact rehearsal, restart the simulator with `npm run demo -- --closed`.

## Inspect the recorded signed purchase

Open `/proof#payment` to see buyer → 0.001 Devnet USDC → merchant.
Select **Verify recorded payment** for a read-only current check. The recorded receipt remains expired WAIT.
Use [the flow picture](assets/fieldproof-payment-to-observation.svg) as a ten-second visual introduction before the technical scenes.
It explains the Solana transfer and the separate Bluetooth request and device signature. It executes neither flow.

1. Open `/proof` on the running local gateway.
2. Check VALID signature, MATCHES challenge, 5/5 AGREE, and expired WAIT.
3. Select **Flip contact state** and check REJECTED signature.
4. Select **Change challenge** and check REJECTED binding.
5. Select **Use another key** and check REJECTED signature.
6. Select **Verify original** and check VALID with expired WAIT.
7. Select **Verify recorded payment**.
8. Check the confirmed slot, expected mint, payer −1000, and merchant +1000 base units.
9. Check that the evidence remains expired WAIT.
10. Check VERIFIED INPUT PAIR and both recorded BOOT states below the payment section.

The signature tests run locally in Web Crypto. The payment check needs internet access to the public Devnet RPC.
An unavailable or rate-limited RPC produces NOT VERIFIED. The button permits a manual retry and leaves receipt verification intact.
The inspector never sends funds or measures hardware.
The input pair contains two separate unpaid checks. Its signed CLOSED and OPEN observations are both expired.
The [README export steps](../README.md#inspect-the-recorded-physical-purchase) create a static package for judge review.
The [founder explanation](HOW_IT_WORKS.html#understand) connects the demonstration to the buyer workflow and its limits.

## Real hardware

1. Stop other BLE scans.
2. Run `uv run --project host capmesh observe-demo`.
3. Check `evidence_mode: physical-contact-demo` and `sample_agreement: 5/5`.
4. Run `npm run demo -- --physical` in `gateway` for a browser purchase with real evidence.
5. Hold BOOT while you select **Run simulation**.
6. Check CLOSED and WAIT.
7. Release BOOT, create another quote, and run another observation.
8. Check OPEN and DISPATCH.

Do not press Reset while you hold BOOT. This combination can enter the ROM download mode.
The P-256 human press/release sequence passed on October 2, 2026. [Both device-signed receipts](evidence/device-signed-contact-states.json) record it.
The older [October 1 checks](evidence/contact-states.json) retain historical HMAC receipts.

## Public-facilitator payment

1. Run `npm start` in `gateway`.
2. Fund a disposable buyer with Devnet USDC.
3. Run `node buyer.js /path/to/disposable.keypair.json` from `gateway`.
4. Preserve the purchase ID, settlement transaction, authenticated receipt, and buyer decision.
5. Check the transaction on Devnet before you claim an on-chain integration result.

If the connection or evidence delivery fails, keep the purchase ID from the buyer error. Review it before another payment.
The keypair stays outside the repository. The client accepts only loopback endpoints and 0.001 USDC on the configured Devnet mint.
This successful payment gate passed on October 1, 2026. The user funded the disposable buyer through the supported faucet interface.
Independent Devnet RPC checks confirmed the exact mint, recipient, and 1,000-unit transfer. [Paid P-256 evidence](evidence/device-signed-purchase.json) records the October 1 signed purchase.

The [October 5 buyer output](evidence/device-signed-purchase-20261005.json) records another actual paid physical observation.
The laptop and Seeker independently verified its transfer at slot 507676124 and its fresh OPEN receipt.
Both changed from DISPATCH to WAIT after the useful-time window expired. No browser clock override or RPC fixture occurred.

## Show one new paid buyer run

For an unattended three-check batch, use the [real paid batch](competition/REHEARSAL.md#run-three-real-paid-checks-without-a-button-press).
It starts its own gateway and verifies the board before reading the wallet. BOOT needs no press for fresh measurements.
Repeated input states are valid. Record an actual state change separately when physical access returns.

This path spends 0.001 Devnet test USDC. It requires explicit approval, a funded disposable buyer, and the provisioned ESP32.
Run commands from the repository root. Keep other BLE scans closed. Release BOOT for the OPEN demonstration.
Port 4021 must be free for a new gateway. If it is occupied, stop only your own server or select a free `PORT`.
Use that port and the same new output path in the gateway, browser, buyer, and USB forwarding.

1. Select a new result filename for this purchase. Preserve existing files.
2. Start the gateway in its own terminal:

```bash
FIELDPROOF_BUYER_RUN_FILE=.local/demo-run-001.json node gateway/server.js
```

3. Open `http://127.0.0.1:4021/proof?live=1&present=1`.
4. Verify the waiting scene shows WAIT and no usable answer.
5. In another terminal, run the approved purchase with the same output path:

```bash
node gateway/buyer.js /path/to/disposable.keypair.json http://127.0.0.1:4021 --output .local/demo-run-001.json
```

6. Preserve the terminal result, output file, purchase ID, and transaction signature.
7. Verify the browser shows the selected run, device checks, and actual chain result.
8. If every check passes within ten seconds, verify OPEN and DISPATCH.
9. Wait until the measurement is eleven seconds old. Verify EXPIRED and WAIT.
10. Select the Explorer link to inspect the actual test-USDC transfer.

The browser monitors for two minutes and makes one automatic read-only chain query after it accepts a supported output.
The monitor substitutes no recorded purchase. The output's trusted provenance remains the independent buyer and its local file.
The browser uses its installed public pin. It ignores supplied keys and claimed decisions.
It does not establish that the receipt directly signs the transaction. The ledger supplies that association.
A loaded run requires both acceptable evidence and a successful chain query for the combined demo decision.
A slow or failed query can outlast freshness. WAIT remains the correct result.

The buyer reserves its output with mode 0600 before HTTP or payment. An existing path causes refusal.
A failed action records a failure file. The endpoint rejects failure, partial, oversized, unsupported, or wallet-array output.
The public endpoint selects supported fields. It exposes no wallet, error details, or local path.
If delivery fails after payment, preserve the purchase ID and review the chain before another purchase.
Automatic retries and refunds do not exist. Never delete the output to disguise a failed attempt.

For manual inspection, open the full page and expand **Inspect a new paid buyer run**.
Select only the result JSON. Never select a wallet keypair.
Select **Verify buyer payment**. An old valid receipt remains expired.
The standalone static package supports manual file inspection. Live monitoring requires the configured repository gateway.
The package includes the October 5 buyer output for manual inspection. Its original signed times remain unchanged.

### Use the Seeker as a portable verifier

Prerequisites: authorized USB debugging, Android Platform Tools, Chrome, and the local gateway.
The October 5 Seeker test verified the real recorded transfer and rejected all three receipt attacks.
The phone supplies no sensor data, signs no payment, and makes no BLE request in this path.

1. Run `adb devices -l`.
2. Identify the attached phone's authorized serial.
3. Replace `PHONE_SERIAL` in these commands:

```bash
adb -s PHONE_SERIAL reverse tcp:4021 tcp:4021
adb -s PHONE_SERIAL shell am start -a android.intent.action.VIEW -d 'http://127.0.0.1:4021/proof?present=1' -p com.android.chrome
```

4. Verify VALID signature, EXPIRED, and WAIT for the recorded receipt.
5. Select **Verify recorded payment**. Verify the actual transfer or state the query failure.
6. For a new approved purchase, open `http://127.0.0.1:4021/proof?live=1&present=1` before the CLI command.

USB reverse forwards the phone's localhost port to the laptop's localhost port. It exposes no public gateway.
The phone runs Web Crypto and its read-only Devnet RPC query independently. The public key still comes from the installed buyer configuration.
If you disconnect USB, the forwarded gateway becomes unavailable. Use the standalone inspector as the recorded fallback.
After reconnecting USB, run `adb -s PHONE_SERIAL reverse tcp:4021 tcp:4021` again, then reload the phone tab.
Run `adb -s PHONE_SERIAL reverse --list` to verify the mapping before recording.
An empty list and a reachable laptop gateway explain the phone's connection-refused error. Reconnection does not restore the mapping automatically.
Remove the forwarding when you finish:

```bash
adb -s PHONE_SERIAL reverse --remove tcp:4021
```

## Failure review

- `settling` after a crash: check the facilitator or chain before you repeat any payment.
- `settlement_unknown`: preserve the purchase ID and review the chain outcome.
- `measuring` after a crash: preserve settlement and inspect device logs. Do not settle again.
- `delivery_failed`: use the preserved settlement for refund review. Automatic refunds do not exist.
- `NONCE_CACHE_FULL`: wait for outstanding authorizations to expire. Do not evict replay protection.
- `AUTH_EXPIRED`: create a new challenge. A reboot also resets the prototype time anchor and replay table.

Back up `.local/purchases.sqlite` before a manual repair. Keep its WAL files with the database during an active process.
Never edit a purchase record to make an unresolved settlement appear successful.

### Resolve a returned test payment

A failed delivery remains a failed delivery. A verified refund can resolve its buyer review without fulfilling the job.
The operator must first return exactly 0.001 Devnet USDC to the original payer in a separate transaction.
Include this exact memo, replacing the placeholders with the preserved purchase ID and original payment signature:

```text
fieldproof:refund:PURCHASE_ID:ORIGINAL_PAYMENT_SIGNATURE
```

This is a manual operator action. No refund service or escrow exists.
Preserve the refund signature before broadcast. An unknown outcome must not start another transfer.
After the return transaction confirms, stop the idle buyer with Ctrl+C in its original terminal.
Run this read-only chain reconciliation from the repository root:

```bash
node gateway/reconcile-refund.js \
  --operation ORIGINAL_OPERATION_UUID \
  --purchase ORIGINAL_PURCHASE_ID \
  --transaction REFUND_TRANSACTION_SIGNATURE \
  --record
```

The command independently verifies the original transfer, reverse transfer, amount, mint, payer, and purchase-bound memo.
It signs no transaction and makes no payment. A running buyer lock blocks reconciliation.
It preserves the original review backup and records `refunded` in the buyer journal.
The purchase database retains its original failed state and no receipt. The operation still counts toward the spending limit.
An unavailable query or mismatched refund retains the review block. Restart the buyer only after reconciliation passes.

A pending facilitator response can also enter refund review after independent proof of its actual transfer.
If its original buyer process is absent, add `--recover-stale-lock` to the reconciliation command.
The command verifies both transfers before it archives the dead owner's lock. It preserves every operation and the remaining budget.
An active or unknown owner blocks this recovery. Do not delete its lock.

### Device authorization expires

`PROVIDER_ERROR: AUTH_EXPIRED` is an unsigned device error report, not accepted measurement evidence.
The prototype uses a temporary clock anchor from its first accepted request after startup.
If the laptop clock changes or the board clock diverges, the device can reject later requests.
Release BOOT, press Reset once, then run the unpaid device check. Keep the board powered.
The restart clears the temporary clock anchor and volatile replay cache. It retains the stored device signing key.
Use a new request after restart. Do not widen authorization expiry or reuse an earlier paid receipt.
Verify the original public key and a fresh signed observation before another payment.
This recovery does not establish the cause of clock divergence. The prototype has no independent trusted clock service.

## Wi-Fi route conflict

A VPN can advertise the same subnet as the ESP32 access point.
On this machine, Tailscale selected its tunnel for `192.168.4.1` even after Wi-Fi joined the board.
Use `--http-interface YOUR_WIFI_INTERFACE` to bind device HTTP to Wi-Fi on Linux.
The option does not change VPN routes or global proxy configuration.

```bash
uv run --project host capmesh observe-demo --http-url http://192.168.4.1 --http-interface wlp2s0
uv run --project host python scripts/check_wifi_observation.py --interface wlp2s0
```

Replace `wlp2s0` with your Wi-Fi interface name. Connect to the board access point first.
