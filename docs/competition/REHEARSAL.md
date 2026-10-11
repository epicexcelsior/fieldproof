# Return to the laptop: record one complete transaction

Outcome: three distinct paid hardware checks, one legible recording, and preserved evidence.
Keep this route on Solana. Agung remains optional and pending.
Start from the repository root. Keep wallets, ledgers, and journals private.

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

When physical access returns, hold BOOT to test the opposite state.

   ```bash
   python3 scripts/demo.py board --expect closed
   ```

   Expect device-signed CLOSED. Do not press Reset or change firmware for this rehearsal.

If a board check fails, preserve its printed log. Resolve that failure before spending test tokens.

## Run three real paid checks without a button press

Prerequisites: successful signed board preflight, installed host and gateway dependencies, and a funded disposable Devnet buyer.
Stop other buyers and BLE clients. This command starts its own hardware gateway on loopback port 4027.
Keep the board powered. Run from the laptop's normal terminal if the agent access check reports runtime restrictions.

```bash
node gateway/paid-checks.js --execute \
  --keypair /path/to/disposable-devnet.keypair.json \
  --count 3 \
  --output-directory .local/paid-checks/run-001
```

The maximum batch cost is 0.003 Devnet USDC. These are test tokens, not customer revenue.
The command saves three recovery IDs before device work. It verifies one unpaid signed reading before reading the wallet.
It then purchases three distinct readings in sequence and independently queries each Devnet transfer.
Each purchase uses the same per-wallet controller as the browser and agent. Its shared lifetime limit remains ten operations.
The hardware bridge uses installed Python dependencies without package downloads during delivery.
No manual gateway startup or BOOT press is required. The command never selects the simulator or drives a GPIO output.

Expected files in the new output directory:

- `plan.json`: recovery IDs, maximum batch budget, and disabled automatic paid retries.
- `preflight.json`: the unpaid signed board reading.
- `check-1.json` through `check-3.json`: original paid receipts and independently verified payment results.
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

## Record the browser purchase

Prerequisites: working BLE input, a funded disposable Devnet buyer, and approval for the displayed test-token budget.
Each purchase costs at most 0.001 Devnet USDC. The shared controller permits at most ten operations.

1. Start the browser buyer with your local wallet path.

   ```bash
   node gateway/live-demo.js /path/to/disposable-devnet.keypair.json
   ```

2. Open `http://127.0.0.1:4026/proof?present=1`.
3. Select **Pay 0.001 USDC** once.
4. Preserve the purchase ID, operation ID, original receipt, and transfer reference.
5. Record the physical input and fresh answer together.
6. Wait eleven seconds. Record the unchanged receipt and WAIT decision.
7. Use the changed-state attack control. Record signature rejection.
8. Restore the original. Verify that the original signature result returns.

Complete three distinct paid checks. Test both contact states when physical access returns.
These are founder test jobs, not customer traction. BOOT actuation is an optional visual scene, not a purchase prerequisite.
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
