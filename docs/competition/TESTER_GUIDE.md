# Follow one check, then inspect the evidence

Start with [the two-minute reviewer path](TRY_IT.md) for the new peaq-linked job.

Open [the visual replay](https://epicexcelsior.github.io/fieldproof/) first. No wallet, key, or login is required.

1. Select **Show the request**.
2. Select **Show the payment**. The operator receives 0.001 Devnet test USDC in the recorded purchase.
3. Select **Show the device check**. The real recorded button input reads OPEN.
4. Select **Verify the answer**. The browser checks the original signature at capture time.
5. Select **Use this old answer now**. Expect an expired answer.
6. Select **Change the answer**. Expect signature rejection.
7. Select **Restore original**. The original timestamp stays unchanged.

Opening the replay creates no payment or measurement. The real device photo comes from earlier footage.
The recorded answer is expired today. The October 12 job now has verified Agung identity and native Storage readbacks.

Explain who pays, what the operator supplies, and why the buyer rejects an old answer.
If the reviewer cannot explain those three facts, record the confusing step before opening more materials.

Open **Evidence, limits, and reviewer questions** for the receipt inspector, original receipt, and deck.
Use [the founder material hub](../start.html) for recording and submission resources.

For a quick preview, watch the [58-second captioned feedback cut](../assets/fieldproof-paid-check-feedback.webm).
It contains the real October 11 test payment and signed ESP32 answer. It makes no new measurement or payment.
This earlier clip labels peaq integration pending. The October 12 job supersedes that status. The final narrated hardware video is linked from [the submitted materials](README.md).

Goal: determine whether the evidence supports a paid fresh contact check. No wallet, key, hardware, or login is needed for this public inspection. The public record is historical and expired.

The earlier detailed replay remains at `review.html`. Its entrance is an illustration.
Select **Replay the real check** to follow the October 11 request, payment, measurement, and example decision.
Historical acceptance uses the original capture time. It does not establish a fresh answer today.
Select **Try this old answer now**. Expect the example trip to stay on hold.
Select **Change the signed answer**. Expect rejection of the altered copy.
Select **Restore the replay**. The original timestamp remains unchanged.
The illustrated entrance is not connected. BOOT represents its contact. Buyer demand remains unvalidated.

Before opening transaction details, explain who buys the check and what decision depends on its answer.
Record confusion as feedback. Do not count a reviewer as a customer.

Select **Inspect evidence** to open the original receipt inspector.
Select **Show full page**, then **Verify buyer payment** for a read-only transfer query.
The instructions below also support the older public inspector.

1. Open the [public inspector](https://epicexcelsior.github.io/fieldproof/proof.html?record=20261011) in a private browser window.
2. Select **Verify original**. Expect a valid device signature and expired evidence. The decision remains WAIT.
3. Select **Flip contact state**. Expect signature rejection and WAIT.
4. Restore **Verify original**. Expect the original signature result to return.
5. Select **Verify recorded payment**. Expect a read-only Solana Devnet query for the recorded 0.001 Devnet USDC transfer.
6. Open the [guide](https://epicexcelsior.github.io/fieldproof/guide.html). Read its distinction between teaching models and recorded hardware evidence.

If the independent payment query fails, record the exact message and time. A temporary RPC failure does not change the recorded receipt's signature result. If a link fails, record its URL and browser. Do not infer a fresh measurement from a page reload.

For a local complete purchase without funds, run `python3 scripts/demo.py sim` from the repository root after its prerequisites. Open `http://127.0.0.1:4022`, request a quote, then run simulation. It exercises purchase behavior with a fake facilitator and does not move funds. See `README.md` for prerequisites.

## Review a new linked-job export

Use this route only when the coordinator supplies a reviewed export that includes `evidence/current-job.json`.

1. Open `jobs.html` in that export over localhost or HTTPS.
2. Select **Load reviewed job from this export**.
3. Verify the original signature, request terms, and capture age.
4. Read the machine identity and recorded peaq activity state. Check whether the route uses Storage or EventRegistry.
5. Select **Verify transfer on Devnet** for a separate read-only payment query.
6. Alter the contact state locally. Expect signature rejection and WAIT.
7. Restore the original. Expect the transfer button to reset.

The export contains recorded chain readbacks. It does not establish a current peaq registry read.
Payment verification cannot refresh an expired contact answer. Neither result establishes equipment safety.

## Coordinator acceptance before recording

Use the [paid-job runbook](../JOBS.md). Keep live evidence separate from controlled software checks.
For the Solana-only route, use the [rehearsal](REHEARSAL.md). The October 12 job contains verified identity and Storage readbacks. Other jobs require their own checks.

| Part | Acceptance result |
|---|---|
| Access | Read-only Agung preflight and usable board transport pass. If the phone extension appears, its connection passes |
| Identity | Finalized owner, controller, key and service match the approved policy before payment |
| Paid hardware | Three distinct jobs retain their original request, signed receipt and exact Devnet payment |
| Contact outcomes | Both OPEN and CLOSED can fulfill a job. The buyer decision remains separate |
| Evidence attacks | Changed state, changed challenge, wrong key and expired evidence produce rejection or WAIT |
| Recovery | Reload and repeated operation inspection create no second payment. The preserved operation ID remains available |
| Activity | Independent readback binds the exact original job hash, approved owner, and declared Storage or EventRegistry route. Reinspection creates no chain write |
| Public package | Original timestamps remain unchanged. No wallet, operator journal, private error or local database appears |
| Browser | Desktop and phone widths, file import, transfer-query failure, restore and history return pass |
| Seeker extension | If included, actual capture and independent verification pass. Its unpaid status and capture trust limit stay visible |
| Publication | Inspect the actual signed-out URLs. A source push to main does not update the separate gh-pages deployment |
| Submissions | Founder verifies forms, records narration and saves actual submitted confirmations |

Do not force a live payment or chain-write failure to demonstrate recovery.
Use controlled failure tests and inspect existing transaction references without another write.

## Feedback template

Copy the answers without names or private account data into the project feedback record.

| Prompt | Tester answer |
|---|---|
| What physical question did the buyer pay to ask? | |
| Who supplied the reading, and what did the signature establish? | |
| What did the Solana query establish? | |
| Why did the decision become WAIT after ten seconds? | |
| Which label or step was confusing? | |
| What existing method would you use for this answer? | |
| If you manage remote equipment, when is a fresh paid check useful? | |
| Would you test one authorized site? What decision and owner? | |

Record date, device, browser, link tested, whether the tester is external, and any follow-up commitment separately. A positive comment is feedback, not a customer or purchase commitment.
