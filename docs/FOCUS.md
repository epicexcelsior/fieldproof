# FieldProof: current status

Updated October 12, 2026. This page records product state. Internal recording priorities stay local.

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

## Remaining submission work

Final narrated pitch and physical-demo videos remain incomplete.
The current portal needs both video links and resolution of its team warning.
No submitted confirmations establish completed Colosseum, Germany, or peaq entries.

Customer demand, pricing, and distribution remain hypotheses.
One provider works today. Automatic discovery, reputation, and additional provider ports remain future work.

## Canonical references

- [Story](competition/STORY.md): product, buyer hypothesis, alternatives, and limits.
- [Rehearsal](competition/REHEARSAL.md): live hardware and payment commands.
- [Requirements](competition/REQUIREMENTS.md): official rules, dates, and fields.
- [Verification](VERIFICATION.md): executed checks and dated evidence.
- [peaq integration](PEAQ_INTEGRATION.md): actual deployment, identity, and work-record facts.
