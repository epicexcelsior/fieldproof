# Physical rehearsal: record one complete transaction

Outcome: a paid hardware check, one legible recording, and preserved evidence.
The Solana-only fallback remains available. The peaq-linked route now has a real activated Agung identity and work record.
Start from the repository root. Keep wallets, ledgers, and journals private.

## Show the feedback demo now

The October 11 check completed a real 0.001 Devnet USDC purchase and a fresh signed ESP32 OPEN observation.
Its independent payment query verified the exact transfer. The public copy contains only the whitelisted purchase fields.
Open `review.html` in the latest reviewed static export for the one-minute walkthrough.
It links the new receipt, the earlier video, and the actual transaction. Its evidence is recorded and expires normally.
The public review needs no wallet or hardware. Live peaq identity and activity remain pending.

## Diagnose a buyer lock without payment

```bash
node gateway/paid-checks.js --check-buyer
```

This command derives the wallet's public address. It reads local buyer metadata and process information.
It creates no lock, starts no device request, and makes no network request or payment.
The output names the owner PID and its recognized FieldProof role. Private process arguments remain excluded.
Run it in the normal host terminal. A sandbox's process namespace cannot establish host-process absence.

If `owner_state` is `alive`, use the running buyer or stop it from its original terminal after its purchase finishes.
Do not delete its lock. A graceful idle shutdown removes the lock.
If `owner_state` is `unknown`, preserve the lock and inspect its original process.
Use stale-lock recovery only when the normal host reports the original owner absent and all records are complete.

The October 11 host diagnosis identified PID 1824662 as the original idle browser buyer from October 5.
That active process caused the recovery refusal. It was not a missing key, board failure, or reused PID.
The coordinator verified its idle status and stopped it with SIGTERM. It removed its own lock.
The next real paid check passed. The founder authorized 100 operations. Eight completed operations leave 92 available. The original records remain intact.

## Check without payment

1. Run the focused software checks.

   ```bash
   python3 scripts/competition_check.py
   ```

   Expect gateway and Python success. Optional SDK skips remain explicit. This is not a live hardware test.

2. Check the bounded agent's public configuration.

   ```bash
   node gateway/agent-contact.js
   ```

   Expect `configuration_checked`, `spending: false`, fixed Devnet terms, and `peaq: not_used`.
   This command reads no wallet and makes no network or device request.

3. Run one real signed board observation. BOOT can remain released.

   ```bash
   node gateway/paid-checks.js --check-device
   ```

   Expect `transport: real-ble`, `receipt_identity: pinned-device-p256`, and a signed current contact reading.
   Close other BLE clients before this command. It reads no wallet and makes no payment.

The board samples its current input for every request. BOOT does not need a press to produce a fresh answer.
Three unchanged OPEN answers can contain three distinct fresh challenges and signed receipts.
They do not demonstrate a physical state change.

The founder is physically present now. Hold BOOT throughout the opposite-state check.

   ```bash
   python3 scripts/demo.py board --expect closed
   ```

   Expect device-signed CLOSED. Do not press Reset or change firmware for this rehearsal.

If a board check fails, preserve its printed log. Resolve that failure before spending test tokens.

<a id="run-three-real-paid-checks-without-a-button-press"></a>

## Run a real paid check without a button press

Prerequisites: successful signed board preflight, installed host and gateway dependencies, and a funded disposable Devnet buyer.
Stop other buyers and BLE clients. This command starts its own hardware gateway on loopback port 4027.
Keep the board powered. Run from the laptop's normal terminal if the agent access check reports runtime restrictions.

```bash
node gateway/paid-checks.js --execute \
  --count 1 \
  --recover-stale-lock
```

The default wallet is the existing ignored `.local/disposable-buyer.keypair.json` file.
The command generates a new private output directory and prints its path. It preserves earlier runs.
Use `--keypair` only to select another real Solana CLI keypair file. Never enter the example `/path/to/...` literally.
Use `--output-directory` only to select a new directory yourself. An existing directory remains protected.

This command costs at most 0.001 Devnet USDC. These are test tokens, not customer revenue.
Select one to three checks with `--count`, within the wallet's remaining limit.
The command saves each recovery ID before device work. It verifies one unpaid signed reading before reading the wallet.
It then verifies the wallet, the shared operation budget, the associated test-USDC balance, and gateway startup.
These are setup checks. Their failures report `buyer_setup_failed`, zero purchase attempts, and an actionable error.
The funds check counts the source associated token account that x402 actually uses. It does not count unrelated owned accounts.
No Solana mainnet RPC or asset enters this route.
It then purchases the requested readings in sequence and independently queries each Devnet transfer.
Each purchase uses the same per-wallet controller as the browser and agent. Its shared lifetime limit is 100 operations, totaling at most 0.100 Devnet USDC.
The hardware bridge uses installed Python dependencies without package downloads during delivery.
No manual gateway startup or BOOT press is required. The command never selects the simulator or drives a GPIO output.

The explicit `--recover-stale-lock` flag runs only after the board, wallet, funds, and gateway checks pass.
Run recovery in the normal host terminal that can see the original process IDs.
If the previous owner process still exists or its status is unknown, the command preserves the lock and stops.
If an operation is pending, damaged, or under review, the command preserves the lock and stops.
If all records are complete and the host reports the owner absent, it archives the old lock.
Recovery preserves every operation and its original receipt. It does not reset the shared spending limit.
The current ledger contains eight completed operations. Use `--count 1` for a take or `--count 3` for a useful batch.
An archived lock is local recovery evidence. It does not verify a new payment.

Expected files in the new output directory:

- `plan.json`: recovery IDs, maximum batch budget, and disabled automatic paid retries.
- `preflight.json`: the unpaid signed board reading.
- `buyer-preflight.json`: the read-only Devnet balance check, remaining operation count, and optional lock archive reference.
- `check-1.json` through the selected count: original paid receipts and independently verified payment results.
- `result.json`: completed count, transfer references, contact states, and purchase durations.

An unchanged contact state is valid. The summary states whether it observed a change.
The output also preserves the current freshness decision. A receipt can expire during the independent payment query.
An unavailable query, duplicate transfer, or uncertain purchase stops the next payment.
Preserve `review_operation_id` and all run files. Use the same ID with `agent-contact.js` for inspection.
Do not delete a failed run or unresolved controller record. A new directory does not clear the shared safety checks.
An existing output directory blocks execution before device or wallet work.

Import one `check-N.json` into `/jobs` on a separately started local gateway to inspect the original signed evidence.
The batch closes its gateway on completion. Review saved public addresses and evidence before publication.
This route declares `peaq: not_used`. It does not activate a peaq identity or submit an activity event.

If an earlier run failed with the placeholder keypair path, retain its files and use the corrected command above.
The founder's October 11 `run-001` failed before the buyer controller started. It made no payment and created no review operation.
Its signed board preflight passed. Its saved failure was `Buyer keypair file cannot be read`.
The later setup checks keep this known configuration failure separate from an uncertain payment outcome.

## Record the browser purchase

Prerequisites: working BLE input, a funded disposable Devnet buyer, and approval for the displayed test-token budget.
Each purchase costs at most 0.001 Devnet USDC. The shared controller permits at most 100 operations. Keep each take to one useful check.

1. Start the browser buyer with your local wallet path.

   ```bash
   node gateway/live-demo.js .local/disposable-buyer.keypair.json
   ```

2. Open `http://127.0.0.1:4026/proof?present=1`.
3. Select **Pay 0.001 USDC** once.
4. Preserve the purchase ID, operation ID, original receipt, and transfer reference.
5. Record the physical input and fresh answer together.
6. Wait eleven seconds. Record the unchanged receipt and WAIT decision.
7. Use the changed-state attack control. Record signature rejection.
8. Restore the original. Verify that the original signature result returns.

The shared cap permits 100 operations. Nine completed checks leave 91 available before the next take.
Record one paid check after the unpaid rehearsal. Recheck readiness before another purchase.
These are founder test jobs, not customer traction. Keep BOOT visible to show the physical input.
Stop on any unknown payment outcome. Do not click again to diagnose it.
The [demo runbook](../DEMO.md#pay-and-read-with-one-click) owns browser recovery.

## Run the headless agent route

Stop the browser buyer before the same signer runs this command. Both tools share its lock and operation budget.
Keep the gateway in a separate terminal. It uses the same purchase database and contains no browser signer.

1. Start the hardware gateway.

   ```bash
   node gateway/server.js
   ```

2. Create one recovery ID with `uuidgen`. Keep the literal value.
3. Run one explicitly approved agent purchase.

   ```bash
   node gateway/agent-contact.js --execute \
     --keypair /path/to/disposable-devnet.keypair.json \
     --operation REPLACE-WITH-UUID-V4 \
     --output .local/agent-contact-001.json
   ```

   The command prints the recovery ID before payment. It saves the accepted run before the independent Devnet query.
   The output contains `peaq: not_used`. It creates no peaq identity, activity event, or credit rating.
   The output file is reserved before signing. An existing file blocks execution and remains unchanged.

4. Reuse the operation ID for inspection. Omit `--output`, or select a new output filename.

   Expect the same receipt and transaction. No second payment or observation starts.
   An expired receipt remains WAIT, even after a successful payment query.
   A slow or unavailable payment query also produces WAIT.

Import the saved JSON into `/jobs` on the local gateway to inspect its original receipt without another purchase.
Review the file before publication. It contains the public payer address and original receipt, not a wallet or journal.

An unresolved operation blocks another purchase. Preserve its ID and private run directory.
Do not delete a lock, ledger, or review record to make another attempt pass.

## Finish the package

1. Follow the [recording scripts](VIDEO_SCRIPTS.md). State whether each scene is live, recorded, or simulated.
2. Export the [public inspector](../../README.md#inspect-the-recorded-physical-purchase) to a new local directory.
3. Test the actual hosted links through the [reviewer guide](TESTER_GUIDE.md).
4. Ask two external reviewers to explain what was bought and what the signature proves.
5. Record their actual answers. Fix the first confusing screen or sentence.
6. Verify the [current requirements](REQUIREMENTS.md) before completing the forms.

The source push to main does not update the separate gh-pages site.
Founder narration, public upload, account terms, and final submission remain owner actions.
New hardware is useful only if it makes the same contact question clearer and passes both board states.
