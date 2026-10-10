# FieldProof submission preparation

Status: verified technical prototype, incomplete human submission.
The public repository contains actual Devnet settlement and ESP32-signed evidence.
Public inspector, guide, and technical-video links are available. Eligibility confirmation, founder narration, Colosseum registration, project page, and contact details remain unverified.
Use [one 150-second recording route](REHEARSAL.md#record-one-150-second-walkthrough), then complete the fields below.
The [bounty execution plan](BOUNTY_PLAN.md) owns deadlines and acceptance gates.

## Current entries: October 10

Prioritize the peaq Germany entry, then the Germany Colosseum track and main Colosseum entry.
The story is paid physical checks for AI agents. The [job runbook](JOBS.md) owns the connected software path.
Live peaq activation and event readback remain pending. Do not claim either from an offline test.
The phone photo app is an operator-assisted extension. It supplies no paid-provider demonstration yet.

The Germany Colosseum track requires a Solana project, both portal submissions, and Germany country selection when eligible.
This differs from the historical Germany MVP listing below.
[Current Germany track](https://superteam.fun/earn/listing/colosseum-crypto-worlds-fair-hackathon-superteam-germany-track/).

Prepare three separate recordings: a two-minute peaq transaction, a founder pitch, and a technical walkthrough.
Verify actual form time limits before exporting. The supporting deck contains five slides.
Every finished video must distinguish historical evidence, live capture, simulation, and planned work.
The internal submission target is Monday, October 12, 18:00 CEST.
Use [the editable deck, recording scripts, tester guide, and tailored form drafts](competition/README.md).

## Requirements and deadlines recorded October 4–5

Requirements and deadlines were checked again from both complete public `__NEXT_DATA__` listing payloads on October 4, 2026.
Both listings specify Germany regional eligibility and `agentAccess: HUMAN_ONLY`. The founder must complete human submission.
The earlier text-only retrieval omitted these details. This record supersedes that gap.
The Germany listing details and official Colosseum FAQ were reread on October 5. Their video and Solana requirements match this plan.

| Track | Deadline in UTC | Deadline in Europe/Berlin |
|---|---|---|
| Germany MVP | October 5, 2026, 21:59:59 | October 5, 2026, 23:59:59 CEST |
| peaq Germany | October 13, 2026, 06:59:00 | October 13, 2026, 08:59:00 CEST |

The Germany MVP track requires a working Solana integration on Devnet or Mainnet.
An existing SDK or protocol qualifies. A custom Solana program is optional.
The form requires product details, a test link, a public GitHub repository, deployment evidence, and a 2–3 minute video.
It also requires a Colosseum project and a team contact. Register under Germany. [Germany MVP listing](https://superteam.fun/earn/listing/road-to-colosseum-hackathon-build-your-mvp)

The peaq track accepts a working demo or a promising prototype in English.
The form requires a description, GitHub link, presentation link, and a truthful answer about Colosseum submission.
Website and social links are optional.
Judges assess the machine-economy mechanism, implementation, usefulness, originality, and explanation.
Native peaq activation is not an explicit mandatory requirement.
The listing warns against superficial peaq additions and fragmented features. [peaq Germany listing](https://superteam.fun/earn/listing/build-solutions-advancing-the-machine-economy-with-peaq)

Winner announcements are separate: October 12 for the MVP track and October 27 for peaq.
Verify both deadlines again before submission. Eligibility and acceptance remain organizer decisions.

## Project name and tagline

**FieldProof**

Paid physical checks for AI agents.

## One-line description

FieldProof lets an AI agent buy a fresh physical check on Solana and verify the device's signed answer before using it.
The new software checks peaq identity before payment and prepares attributable activity after delivery.
Its live chain integration remains pending.

## The point to demonstrate

An agent needs a current physical answer from a selected device.
It needs evidence for this question, within its useful-time limit.
The demo shows a confirmed payment and valid device signature alongside expired evidence and WAIT.
The ten-second limit is buyer policy, not a property of Solana or a guarantee that the gate remains open.
The signature authenticates the device's claim. The gateway ledger associates its signed challenge with the purchase.

## Problem and buyer

The first buyer hypothesis is an AI builder who operates equipment at another location.
Test one repeated decision that its current telemetry cannot answer reliably.
The implemented first step purchases a current contact observation with an explicit age limit and budget.
Access rights, actuation, reservations, and completed-service verification remain future work.
Existing facility APIs and Open-RMF integrations remain alternatives. Customer demand and avoided costs remain unvalidated.

## Working product

The MVP asks one question at `demo-gate`: is the contact closed?
A flashed ESP32-C6 samples its GPIO9 input five times after authorization.
Its BOOT button represents a gate contact.
The buyer checks its pinned device key, configured location label, nonce, signature, sample agreement, and freshness.
Fresh open evidence produces `DISPATCH`. Closed or expired evidence produces `WAIT`.

The CLI rejects a cheaper stale provider before selecting fresh evidence.
It records served and unmet demand.
Executed attack checks reject repeated requests, repeated responses, changed challenges, and changed results.
BLE and Wi-Fi measurements passed on the attached board.
Human press/release verification passed: held BOOT produced CLOSED/WAIT, and released BOOT produced OPEN/DISPATCH.
[Device-signed physical state evidence](evidence/device-signed-contact-states.json) preserves both October 2 P-256 receipts.
The older HMAC state checks remain historical evidence.

## Solana integration

FieldProof uses the x402 V2 SDK and Solana Kit to purchase one observation with Devnet USDC.
The gateway pins the network, mint, recipient, and a price of 1,000 base units, equivalent to 0.001 USDC.
The real resource-server SDK verifies payment and settles it before authorizing measurement.
SQLite reserves each transaction proof once and preserves its purchase state and original receipt.

A public-facilitator purchase settled 0.001 Devnet USDC and then returned a real authenticated GPIO9 observation.
Independent RPC checks confirmed the successful transaction, configured mint, buyer debit, and merchant credit.
[October 1 P-256 evidence](evidence/device-signed-purchase.json) records the first device-signed purchase.
[October 5 buyer output](evidence/device-signed-purchase-20261005.json) records the purchase both laptop and Seeker verified. The public gateway also returns the expected 402 offer.
Tests execute verification, settlement, retries, and failures through the real SDK with a simulated facilitator.
The signing test creates and cryptographically verifies an Ed25519 buyer signature against a local RPC fixture.
The live purchase establishes the chain integration separately from these unit tests.

Solana supplies the payment rail for small autonomous purchases.
The physical observation and buyer policy supply the decision value.
There is no custom on-chain program in this MVP.

## Machine-economy contribution

The observer offers a priced observation. The buyer controls spending and evidence age before it derives a demo recommendation.
The longer-term hypothesis connects approved buyers to physical services from separate operators.
Start with paid enterprise integration and support. Test recurring software fees before relying on machine-service transaction volume.
A second independent facility tests integration reuse. Pricing, income, demand, and network effects remain unvalidated.
The local demand ledger includes test requests. It establishes no monthly revenue opportunity or case for new hardware investment.

No peaq identity or revenue event is activated.
The current [Solana onboarding guide](https://docs.peaq.xyz/peaqos/guides/onboard-on-solana) reports paused onboarding and a mainnet-only flow.
The read-only Agung registry check now verifies deployment peers and activation flags and derives a proposed observer ID from the public key.
No machine activation or activity event exists. The [peaq integration decision](PEAQ_INTEGRATION.md) records the bounded native testnet path and remaining inputs.
The software now includes identity resolution, bounded activation, activity submission, and independent inspection.
Their live results remain unverified. Follow [the job runbook](JOBS.md) after current preview and explicit bond/gas approval.
The public command HMAC key does not provide private authorization. Physical receipts use buyer-pinned P-256 identity with unencrypted device storage.
Simulated payments and Devnet tokens do not establish real revenue.

## Judging walkthrough

Record one narrated 2–3 minute MVP walkthrough. Use the [recording route](REHEARSAL.md#record-one-150-second-walkthrough) in your own words.
The [recording script](RECORDING_SCRIPT.md) provides four separate clips, editable spoken text, and exact screen and hardware actions.
Show the problem, actual purchase, expiry, one attack, and the next pilot.
The [one-click paid demo](DEMO.md#pay-and-read-with-one-click) now shows an actual payment and fresh ESP32 reading together.
Its [October 5 click output](evidence/device-signed-purchase-click-20261005.json) preserves the original signed answer.
One actual click completed payment and receipt delivery in 15.288 seconds. The browser accepted the fresh answer, then rejected its age.
The local start page links the script and a ten-second excerpt of the October 5 paid capture.
The excerpt preserves the continuous fresh-to-expired transition at original speed. The complete 32.8-second capture remains available.
Its public buyer output is [committed here](evidence/device-signed-purchase-20261005.json). The same saved answer is expired today.
The Seeker is an independent browser verifier. It supplies no sensor data and signs no payment.

The [captioned 2:30 technical walkthrough](assets/fieldproof-signed-receipt.webm) remains the reproducible technical fallback. It has no audio.
Its simulated quote and recorded real purchase are labeled separately. It passed decoding and visual review.
The exported package includes the founder guide and recorded inspector. The guide's examples are teaching models.
The simulator remains a complete no-funds purchase rehearsal. The inspector verifies recorded hardware evidence and reads payment data.
The [guide](HOW_IT_WORKS.html) explains the loop. The [strategy](STRATEGY.md) explains the buyer and commercial hypothesis.

Colosseum separately requests a 2–3 minute presentation and a product demo of at most three minutes.
Keep the buyer, alternatives, business test, and founder motivation in that presentation. [Colosseum submission guidance](https://colosseum.com/hackathon?year=fall2026)
Write final application answers yourself. Supply accurate development history and contact details.
Older videos and local intermediate captures remain historical material. Use the current recording route instead of reviewing every version.

## Ready-to-use visual materials

Use one consistent visual direction: paper background, dark ink, blue labels, teal acceptance, and amber expiry.

| Material | Use |
|---|---|
| [Video cover, 1280 × 720 PNG](assets/fieldproof-video-cover.png) | Upload as the walkthrough thumbnail. It illustrates the policy, not a new measurement. |
| [Project graphic, 1024 × 1024 PNG](assets/fieldproof-project.png) | Use in the project page's logo or graphic field. |
| [Payment and radio diagram](assets/fieldproof-payment-to-observation.svg) | Explain where Solana payment and Bluetooth communication occur. |
| [Evidence-age diagram](assets/fieldproof-evidence-window.svg) | Explain why the buyer waits after an authentic observation expires. |

Editable sources: [video cover SVG](assets/fieldproof-video-cover.svg) and [project graphic SVG](assets/fieldproof-project.svg).
The local start page groups these downloads with the current inspector package and recording route.
Keep the video focused on one transaction. A separate slide deck is optional for this MVP walkthrough.

Before submission, verify the final video once with sound and once while signed out.
Verify the public test link, repository, and exact Devnet transaction from a signed-out browser.
State which test path uses simulation and which path inspects recorded physical evidence.
Complete the human form. Save its receipt or confirmation page.

<a id="required-fields-that-remain-incomplete"></a>

## Submission fields and remaining actions

| Field | Current state | Required next action |
|---|---|---|
| Germany eligibility | Founder reports an Earn location-change cooldown. No organizer exception is confirmed. | Confirm eligibility and any late-submission route with the organizer |
| Public repository | Public at `https://github.com/epicexcelsior/fieldproof` | Paste the link into the submission form |
| Test access | [Public recorded inspector](https://epicexcelsior.github.io/fieldproof/?submission=20261005) and [interactive guide](https://epicexcelsior.github.io/fieldproof/guide.html). Verified without sign-in on October 5. | Paste the inspector link. Label recorded evidence and teaching models accurately |
| Presentation link | [Public captioned 2:30 technical fallback](https://epicexcelsior.github.io/fieldproof/assets/fieldproof-signed-receipt.webm). Founder video remains a separate task. | Use the final founder video when available and verify its public link |
| Payment evidence | Verified Devnet transaction and real GPIO9 receipt | Link the committed evidence and include it in the final walkthrough |
| Colosseum project | No verified project page | Register under Germany and provide the project link |
| Team contact | No submission contact selected | Supply the contact directly in the submission form |
| peaq submission answer | No submission confirmation exists in this repository | Answer accurately at submission time |

The remaining project and contact details have no verified values. No placeholder is a valid submission value.
Video upload, account registration, and submission require explicit authorization.

## Owner publication steps

The origin is `https://github.com/epicexcelsior/fieldproof.git`. `main` is pushed and the repository visibility is Public. Keep every later change pushed before submission.

1. Check that `origin` still points to the repository judges will review.
2. Run `git push -u origin main` after every accepted change.
3. Confirm the repository visibility stays Public.
4. Check the public README, simulator setup, verification record, and `docs/evidence/` files.
5. Review the current signed-receipt walkthrough and record the founder presentation.
6. Upload both videos and check their public viewing links.
7. Paste the presentation, test-access, Colosseum project, and contact values into the submission form.

Keep `.local/`, keypair files, databases, environment files, and build outputs excluded.
The existing recording script requires an installed Playwright package and Chromium. See the [demo runbook](DEMO.md).
Video upload, registration, and submission remain owner tasks. A hosted public gateway requires separate access controls and deployment work.

## Source reproduction

Open each listing in a browser. Read its details section.
Read `JSON.parse(document.querySelector('#__NEXT_DATA__').textContent).props.pageProps.listing` in the browser console.
Inspect only `deadline`, `region`, `description`, and `eligibility` for this requirements check.
The deadline fields were `2026-10-05T21:59:59.000Z` and `2026-10-13T06:59:00.000Z`.
Convert those UTC values with the `Europe/Berlin` time zone.

The [verification record](VERIFICATION.md) identifies tested behavior and remaining gaps.
