# FieldProof: the story and the actual difference

Updated October 12, 2026. This page owns the explanation. [Follow one check visually](https://epicexcelsior.github.io/fieldproof/).

## The promise you can stand behind

**Software pays a device operator for a new physical check. The device signs its answer. The buyer verifies the source, request, and age.**

The prototype does this with an ESP32 and an actual Solana Devnet payment.
The device operator receives test tokens. A CLOSED answer fulfills the check just as an OPEN answer does.
The buyer pays for an observation, not a favorable result.

## Tell the story in your own words

Software needs a current physical answer before its next decision. That answer can sit at a site another operator controls.
An existing API can supply it. When that integration is absent, someone still needs to obtain the answer.

FieldProof tests a common way to commission the check. The buyer selects a device, fixes the price, and sets an age limit.
Payment settles. The device takes a new measurement and signs its answer for that request.
The buyer checks the answer before use.

**The important lesson: a payment can remain final while the physical answer becomes too old to use.**
A signature still passes after expiry. FieldProof applies the buyer's age policy to the original timestamp.
It rejects an altered answer and refuses to refresh an old answer through a page reload.

| What the buyer has | Just after the check | Later |
|---|---|---|
| Payment | Settled | Still settled |
| Signed answer | Authentic and within the age limit | Authentic but outside the age limit |
| Buyer freshness check | Passes the age policy | Requires a new check |

This creates a paid service from a connected device's sensing capability.
The larger hypothesis is that software can commission useful checks from independent operators through one interface.
The current prototype does not establish an open marketplace or independent customer demand.

## Who pays, and what value do they buy?

**First buyer hypothesis:** remote-inspection software companies that need repeated checks at sites another operator controls.
**Value to test:** replace a manual check or avoid an unnecessary visit when existing telemetry cannot supply a reliable current answer.

The customer buys a useful answer for a decision. The customer does not buy blockchain signatures for their own sake.
A contact reading is the smallest demonstration. It does not replace a complete equipment inspection or prove repair completion.

No recurring buyer problem, customer, or willingness to pay is validated.
The next commercial step is one authorized operator, one repeated question, and a comparison with its current method.
[Buyer and pilot questions](PILOT.md).

## What is differentiated today?

**The product focus is a commissioned physical check with one linked request, payment, device response, and acceptance policy.**
This is a working combination. It is not a new signature algorithm or a proven competitive moat.

| Alternative | FieldProof's focus and limit |
|---|---|
| Sensor dashboard | A buyer requests a new measurement for its own question and age limit. Continuous monitoring remains a different workflow |
| Generic payment API | The paid response comes from a real device measurement. Payment alone does not establish delivery or useful freshness |
| Signed sensor API | Request signing and freshness checks are not exclusive to FieldProof. FieldProof also connects the purchase and buyer acceptance |
| Existing trusted facility API | That API can be enough. Lower integration effort across independent operators remains unproven |

[x402 already enables payment for API access](https://docs.cdp.coinbase.com/x402/welcome).
FieldProof's contribution is its physical observation workflow, device-signed response, and buyer checks.
Do not claim that ordinary APIs cannot implement these features.

## Why Solana, and why peaq?

**Solana works now:** x402 settles the actual Devnet transfer before the ESP32 measurement. The chip signs evidence, not a Solana transaction.
The configured operator wallet receives payment. No custom Solana program exists.

**peaq role under implementation:** before purchase, the buyer checks a registered machine identity and its device key.
After delivery, a linked work record attributes the paid check to that provider.
This can make identity and work history inspectable across applications.

No FieldProof identity or work record exists on peaq yet. Live activation, a new identity-gated purchase, and readback await completion.
The prepared path uses official native Storage because the published Agung EventRegistry binds a different identity registry.
Storage is operator-controlled. It does not supply a peaqOS activity event or a Machine Credit Rating.
[Exact integration evidence and status](../PEAQ_INTEGRATION.md).

## What can become a business advantage?

Repeatable integrations, authorized providers, reliable capture, and a buyer workflow with measurable value can create an advantage.
Those assets remain hypotheses. Adding more device types does not establish demand.

The first revenue hypothesis is paid integration and support for one useful inspection workflow.
Per-check fees require real pricing and provider margins.
At the prototype price, one million checks total 1,000 test USDC before costs. That is arithmetic, not a business forecast.

## What the demonstration proves

- A real test-token transfer precedes a requested physical measurement.
- The ESP32 signs the original request and contact answer.
- The buyer verifies the configured key, request, samples, signature, and age.
- The Seeker independently verifies recorded evidence and the original transfer.
- Expired and changed answers fail the relevant buyer checks.

The BOOT button represents a contact. No door or customer operation connects to the prototype.
A signature authenticates the device's claim. It does not prove physical truth, calibration, safe passage, or completed work.
The buyer is bounded software callable by an AI agent. Autonomous AI reasoning is not demonstrated.
Payment precedes measurement. No escrow or automatic refund exists.

## Sell the competition entry honestly

The peaq entry demonstrates a device providing a paid physical service. Live registered identity and linked work remain the main sponsor gap.
The [peaq criteria](https://superteam.fun/earn/listing/build-solutions-advancing-the-machine-economy-with-peaq) welcome promising prototypes and emphasize a working economic mechanism.

Colosseum also evaluates insight, execution, communication, business viability, and traction.
The engineering supports execution. The customer and business evidence remain weaker.
[Official judging FAQ](https://colosseum.com/hackathon#h-faq-12).

You can believe in the demonstrated mechanism while testing the business hypothesis.
For this entry, explain the actual transaction, show the physical input, and name the next falsifiable customer test.
Do not claim a universal sensor marketplace, guaranteed honest sensing, customer revenue, or a guaranteed win.

[Video and speaking sequence](VIDEO_SCRIPTS.md) · [Physical recording procedure](REHEARSAL.md) · [Final priorities](../FOCUS.md).
