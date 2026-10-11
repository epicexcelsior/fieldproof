# Explain FieldProof in plain language

Current story, October 11, 2026. This page owns the product explanation. [Start here](../start.html) owns the material index.

## Say these two sentences

**FieldProof lets software pay a device for a fresh physical check. The device signs its answer so the buyer can verify the source, request, and age.**

For the demonstration: a laptop buys a new contact reading from an ESP32. You change the physical input and show the answer.
The buyer accepts usable evidence, rejects changed evidence, and stops using an answer after ten seconds.

## What problem does this address?

Software cannot read an unconnected physical condition. A database answer can also be too old for the decision.
A fresh check can matter when someone currently makes a call, sends a person, or maintains a separate integration.

**Buyer hypothesis:** remote-operations software companies need repeated checks at sites that other operators manage.
An authorized device can supply the check through a common request, payment, and evidence interface.
The first product to test is paid remote inspection jobs. A customer and willingness to pay remain unvalidated.

We have not established a specific costly workflow that FieldProof improves. The entrance in the public replay illustrates a decision.
No entrance, warehouse, robot, or paying inspection customer connects to this prototype.
Do not present that illustration as customer research.

## Why can someone pay?

The check must change a real decision or replace a documented cost. Bytes and signatures do not create that value.
Ask an operator about the last physical check they paid someone to make. Record the workaround and cost before proposing FieldProof.

The demonstration charges 0.001 **Devnet test USDC**. This verifies payment behavior, not a commercial price.
At that price, one million checks total 1,000 token units before costs. A marketplace needs viable provider margins and actual demand.
Paid integration and support are an early revenue hypothesis. Per-check pricing requires a useful workflow and buyer validation.

## What happens in the working system?

1. The buyer selects a device, trusted public key, question, price, and ten-second age limit.
2. The gateway returns a machine-readable x402 payment quote.
3. Solana Devnet settles 0.001 test USDC to the operator wallet.
4. The ESP32 samples its input and signs the request and answer.
5. The buyer verifies the signature, request, sample agreement, and age.
6. The demo policy produces DISPATCH for fresh OPEN, or WAIT for CLOSED, expired, or rejected evidence.

DISPATCH and WAIT are software recommendations. They control no equipment.
An honest CLOSED answer still fulfills the purchased check. Payment buys an observation, not a preferred result.
Payment precedes measurement. No escrow, automatic refund, or payment-after-acceptance guarantee exists.

## Why is this more than a dashboard?

The buyer creates a new job. An actual transfer settles. The physical device measures after that payment and signs its answer.
The browser exposes that transaction and verifies evidence. The useful mechanism is the paid request and device response.
Showing only a historical result hides this mechanism. Film a new check beside the physical input.

## How is this different from existing products?

| Alternative | When it is enough | FieldProof's distinction or gap |
|---|---|---|
| Existing telemetry API | A trusted operator already supplies a current answer | Use that API. A lower integration burden across independent operators remains unproven |
| Sensor dashboard | The owner wants continuous monitoring | FieldProof commissions one new measurement with a buyer-specific request and age limit |
| Ordinary signed API | Buyer and provider already agree on payment and keys | Request binding and signatures alone are not unique. The common commerce interface is the hypothesis |
| Remote inspection service | A buyer needs reviewed photos, installation checks, or stronger capture assurance | This prototype supplies a signed contact claim. It does not replace a complete inspection product |
| Generic agent payments | Software needs a payment method | FieldProof couples payment with a requested physical measurement and explicit acceptance checks |

Verified remote inspections already form a product category. Truepic is a serious existing alternative.
That category does not establish demand for FieldProof contact readings.
[Truepic equipment inspections](https://www.truepic.com/vision/equipment-leasing-financing).

## Why Solana? Why peaq?

**Solana works now:** x402 settles the actual Devnet token transfer. No custom Solana program exists.

**peaq role under implementation:** the buyer resolves a registered provider identity and signing key before purchase.
A linked activity record attributes the completed paid check to that provider.
This can let an operator carry its identity and work history across applications.

No live FieldProof peaq identity or activity record exists. The adapters and recovery paths pass controlled software tests.
Agung readiness reads do not establish activation. The current paid route reports `peaq: not_used`.
The published Agung EventRegistry binds a legacy identity registry. The prepared path uses official native Storage for a linked job hash.
The buyer checks registered authority before purchase. Storage retains separate request-time and submission-time authority checks.
This record is operator-controlled. It is not a peaqOS event or a credit rating.
Testnet funding, activation, a new identity-gated purchase, and independent activity readback remain open.
[Integration facts and gates](../PEAQ_INTEGRATION.md).

The peaq bounty permits early prototypes. It also penalizes superficial integrations.
Live registered-key readback and a receipt-linked event remain the strongest sponsor-specific improvement.
[Official peaq criteria](https://superteam.fun/earn/listing/build-solutions-advancing-the-machine-economy-with-peaq).

## What does the signature prove?

The signature binds the provisioned key to its original request and reported measurement.
It does not prove truthful sensing, installation, calibration, independence, contents, safe passage, or completed work.
The ESP32 key resides in ordinary unencrypted storage. The prototype clock and request authorization also need production hardening.
A machine identity or paid-job count does not remove these trust limits.

## Is this worthy of submission?

**Yes as a technical prototype. No as an already validated business.**
The real payment, fresh signed hardware answer, independent verifier, and explicit failure behavior form a credible submission.
The peaq prototype criteria fit this mechanism. The missing live peaq integration weakens the sponsor entry.
Colosseum also judges business viability, user insight, and traction. Those remain material gaps.
No honest assessment can guarantee a win.

## What makes the next demonstration stronger?

Show your hand changing the real input. Keep the device and screen in one continuous shot.
Show a new paid check, its original answer, the actual transfer, and the phone's independent verification.
Then show expiry and one changed-answer rejection. Preserve the original receipt and capture time.
Use a tested door-contact fixture only after the BOOT baseline recording succeeds.
[Physical rehearsal](REHEARSAL.md) · [Hardware checklist](../HARDWARE_NEXT.md).

## What future is worth testing?

Independent device operators can offer useful inspection jobs to software buyers through one interface.
Repeated paid jobs can reveal which capabilities deserve deployment. That is a future hypothesis, not current traction.
First prove one recurring buyer need. Then test a second operator and compare integration effort.
Expand the network only after those tests justify it.

## Ask for feedback tonight

“Can you explain what the buyer paid for after one minute? What important claim does the evidence fail to prove?”

For an operator: “What was the last physical check you paid someone to make, and why did an existing API fail?”

Record actual answers with the [tester guide](TESTER_GUIDE.md). Feedback is not customer traction.
The [pilot questions](PILOT.md) define the next commercial test.
