# FieldProof: current status

Updated October 15, 2026. This page records product state. Private planning stays local.

## Working prototype

Software buys a new physical contact check. The operator receives test tokens.
The ESP32 signs the answer. The buyer verifies its source, request, signature, samples, and age.

| Component | Verified behavior | Limit |
|---|---|---|
| ESP32-C6 | Real GPIO9 reading and P-256 signature | BOOT represents a contact. No customer equipment is connected |
| Solana Devnet | Actual 0.001 test-USDC settlement before capture | Test tokens, not commercial revenue |
| peaq Agung | Registered device key before purchase. Finalized Storage record linked to the unchanged job | Operator-controlled storage. No EventRegistry event or credit rating |
| Seeker | Independent browser signature, expiry, tamper, and transfer checks on earlier recorded evidence | No paid camera provider |
| Public review | Recorded evidence, browser verification, and no-wallet access | No new hardware check or payment |

[Original October 12 job and recorded readbacks](evidence/current-job.json).
[Try the prototype in two minutes](competition/TRY_IT.md).

## After submission

[Product demo, 1:37](https://youtu.be/eDuEJVad3oY) and [founder pitch, 1:38](https://www.youtube.com/watch?v=LToCUlqJuao) are uploaded.
Anonymous video metadata access passed. Both durations fit the current portal limits.
Colosseum reports FieldProof as submitted. The owner account confirmed this on October 15.
The separate Germany and peaq Earn entries remain unverified.

The next product gate is one recurring buyer decision with a measurable cost and an authorized pilot operator.
Use [the pilot questions](competition/PILOT.md) and [the short task list](../TODO.md).

Customer demand, pricing, and distribution remain hypotheses.
One provider works today. Automatic discovery, reputation, and additional provider ports remain future work.

## Canonical references

- [Story](competition/STORY.md): product, buyer hypothesis, alternatives, and limits.
- [Rehearsal](competition/REHEARSAL.md): live hardware and payment commands.
- [Requirements](competition/REQUIREMENTS.md): official rules, dates, and fields.
- [Verification](VERIFICATION.md): executed checks and dated evidence.
- [peaq integration](PEAQ_INTEGRATION.md): actual deployment, identity, and work-record facts.
