# Five-minute signed-out reviewer test

Goal: determine whether the evidence supports a paid fresh contact check. No wallet, key, hardware, or login is needed for this public inspection. The public record is historical and expired.

1. Open the [public inspector](https://epicexcelsior.github.io/fieldproof/) in a private browser window.
2. Select **Verify original**. Expect a valid device signature and expired evidence. The decision remains WAIT.
3. Select **Flip contact state**. Expect signature rejection and WAIT.
4. Restore **Verify original**. Expect the original signature result to return.
5. Select **Verify recorded payment**. Expect a read-only Solana Devnet query for the recorded 0.001 Devnet USDC transfer.
6. Open the [guide](https://epicexcelsior.github.io/fieldproof/guide.html). Read its distinction between teaching models and recorded hardware evidence.

If the independent payment query fails, record the exact message and time. A temporary RPC failure does not change the recorded receipt's signature result. If a link fails, record its URL and browser. Do not infer a fresh measurement from a page reload.

For a local complete purchase without funds, run `python3 scripts/demo.py sim` from the repository root after its prerequisites. Open `http://127.0.0.1:4022`, request a quote, then run simulation. It exercises purchase behavior with a fake facilitator and does not move funds. See `README.md` for prerequisites.

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
