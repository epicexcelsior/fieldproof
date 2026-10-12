# Try FieldProof in two minutes

Open [the public interactive check](https://epicexcelsior.github.io/fieldproof/).
No wallet, login, or hardware is required.

1. Select **Show the request**. Follow Ask, Pay, Check, and Verify.
2. Select **Use this old answer now**. The original signature passes, but the answer is too old.
3. Select **Change the answer**. The browser rejects the changed copy.
4. Restore the original. Open **Verify payment and inspect the linked job** under the evidence disclosure.
5. Select **Load reviewed job from this export**, then **Verify transfer on Devnet**.

The page verifies the actual ESP32 signature against its separately provisioned public key.
The transfer button queries the original Solana Devnet transaction.
The job includes the machine identity and finalized peaq Storage readbacks.
The browser treats peaq readbacks as recorded evidence. It does not claim a current registry query.

**This is recorded evidence. It makes no new payment or physical measurement.**
The original timestamp stays unchanged. The device image comes from earlier hardware footage.
The contact is an electrical input. Its signature does not prove physical truth.

## Reproduce the live product

[The repository quick start](../../README.md#run-with-the-esp32) covers the real ESP32 and paid buyer.
[The paid-job runbook](../JOBS.md) covers the peaq identity gate and activity readback.
The simulation quick start needs no hardware and labels simulated payment and input.

The deployed hardware profile supports an ESP32-C6 with the provisioned device key.
Another operator must provision its own key and update the explicit buyer policy.
This is not an automatic installer for arbitrary devices.
Phones currently verify receipts. Phone and Pico providers remain future work.

## Independently inspect the peaq record

Use the isolated `peaq-os-sdk==0.10.0` environment described in [the runbook](../JOBS.md).
Download [the original job](../evidence/current-job.json).
Extract its unchanged canonical job into a local file:

```bash
python3 - <<'PY'
import json
from pathlib import Path
packet = json.loads(Path("docs/evidence/current-job.json").read_text())
Path("/tmp/fieldproof-reviewed-job.json").write_text(
    json.dumps(packet["job"], sort_keys=True, separators=(",", ":"), ensure_ascii=False)
)
PY
```

Run the read-only inspection with the reviewed public policy:

```bash
"$FIELDPROOF_PEAQ_PYTHON" -m scripts.peaq_storage_activity inspect \
  --policy docs/competition/provider-policy.example.json \
  --raw /tmp/fieldproof-reviewed-job.json \
  --transaction 0xe88e808f6089fbbf91e5eb5e0a8997ab3e25859f94ce807f8cf8b88a0cb99fad
```

Expect `verified: true`, the original job hash, and both machine-authority checks.
This command reads chain state. It signs no transaction and requires no wallet key.
Storage remains operator-controlled. The record is not an EventRegistry event or credit rating.
