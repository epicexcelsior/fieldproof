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

3. Release BOOT and run one board observation.

   ```bash
   python3 scripts/demo.py board --expect open
   ```

   Expect device-signed OPEN. Close other BLE scans before this command.

4. Hold BOOT and run the opposite state.

   ```bash
   python3 scripts/demo.py board --expect closed
   ```

   Expect device-signed CLOSED. Do not press Reset or change firmware for this rehearsal.

If a board check fails, preserve its printed log. Resolve that failure before spending test tokens.

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

Complete three distinct jobs across both contact states. These are founder test jobs, not customer traction.
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
