FieldProof: follow one actual recorded paid check

1. Serve this directory on localhost or HTTPS.
   python3 -m http.server 8787 --bind 127.0.0.1
   Open http://127.0.0.1:8787/start.html for the story and submission materials.
   Open http://127.0.0.1:8787/feedback.html for the short sponsor review.
   Open http://127.0.0.1:8787/review.html for the one-minute feedback walkthrough.
2. Open http://127.0.0.1:8787/guide.html for the story, radio explanation, and rehearsal.
   Open http://127.0.0.1:8787 for the guided visual replay.
   Open http://127.0.0.1:8787/proof.html?record=20261011 for actual receipt verification.
3. Verify the original receipt, then alter its state, challenge, or public key.
4. Select Verify recorded payment for a read-only Solana Devnet RPC query.
5. Inspect the separately signed BOOT held/released input pair. Those checks moved no funds.
6. Watch assets/fieldproof-paid-check-feedback.webm for the 58-second captioned feedback cut.
   The longer technical walkthrough is assets/fieldproof-signed-receipt.webm.

Open jobs.html for the job workbench. Import a reviewed saved job or evidence manifest.
Imported peaq snapshots remain recorded evidence, not a live registry query.

For the October 5 real purchase, open Inspect a new paid buyer run.
Select evidence/device-signed-purchase-20261005.json, then Verify buyer payment.
The later one-click purchase is evidence/device-signed-purchase-click-20261005.json.
The faster one-click purchase is evidence/device-signed-purchase-fast-20261005.json.
Its authentic evidence is expired now. No new payment occurs.

This package contains recorded evidence, public verification keys, and browser code.
It contains no wallet, backend, private key, physical gateway, or payment endpoint.
It never charges funds or measures hardware. Authentic expired evidence remains WAIT.
The optional RPC check needs internet access and trusts api.devnet.solana.com.
The installed code and public pin are the buyer configuration trust root.
Use the repository README for the complete live MVP and simulated purchase rehearsal.

A reviewed job is included at evidence/current-job.json.
Open jobs.html and select Load reviewed job from this export.
The saved readbacks are recorded evidence. This export made no live chain query.
The original capture timestamp remains unchanged. Old evidence remains expired.
