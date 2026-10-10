# FieldProof bounty execution plan

**Current status: October 10, 2026.** Build one peaq-linked paid physical check for an AI agent.
The [current focus](FOCUS.md) owns the frozen scope. The [paid-job runbook](JOBS.md) owns execution and recovery.
Live Agung activation, registry binding, event submission, and fresh device tests remain pending.

The internal submission target is October 12, 18:00 CEST.
Record the core on Sunday. Freeze features Monday at 12:00 CEST.
The main Colosseum rules specify October 12, 23:59 Pacific, which equals October 13, 08:59 CEST.
The recorded peaq cutoff is October 13, 08:59 CEST. Verify each authenticated form before submission.
The Germany Colosseum track requires separate Earn and Colosseum submissions and Germany country selection when eligible.
[peaq listing](https://superteam.fun/earn/listing/build-solutions-advancing-the-machine-economy-with-peaq),
[Germany Colosseum listing](https://superteam.fun/earn/listing/colosseum-crypto-worlds-fair-hackathon-superteam-germany-track/),
[Colosseum rules, section 5](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf).

## Historical October 2–5 preparation

The requirements and dates below preserve the October 2–5 preparation. They do not define the current implementation scope.
The [adversarial research](research/2026-10-02-fieldproof.md) supports this bounded build and records commercial uncertainty.
The October 4 [product story](STRATEGY.md#the-story-to-explain) connects this observation purchase to cross-operator physical services.
Keep the implemented purchase scope explicit. Access, reservations, actuation, and completed-service verification remain future work.

## Fixed scope

One observation: `gate.closed` at `demo-gate`. One supplier: the existing ESP32-C6 contact demonstration.
One demonstrated payment rail: Solana Devnet USDC through x402 V2.
One buyer recommendation: DISPATCH or WAIT after independent receipt checks.
Keep the simulator for reviewers without hardware. Label it clearly.

No training-data pivot, new token, multi-chain settlement, custom Solana program, open marketplace, or new hardware fleet before October 5.
Build only to remove a failed acceptance gate or serve an identified buyer workflow.
The founder authorized the [bounded contact-fixture extension](HARDWARE_NEXT.md) on October 2.
It keeps this question, receipt format, payment rail, and recorded fallback. Unverified hardware must not replace the working entry.

## Finish the package

| Order | Deliverable | Acceptance criterion | Current state |
|---|---|---|---|
| 1 | Human eligibility and registration | Germany selected, World's Fair joined, FieldProof project page available | Owner will handle it. Completion and project URL are not yet verified. |
| 2 | Judge test path | A fresh checkout runs both CLI contact states and browser simulation without hardware or wallet funding | Fresh checkout passed CLI states, browser simulation, expiry, receipt attacks, and video access. |
| 3 | Current technical walkthrough | 2–3 minutes, playable, states what is recorded and what is simulated | October 4 signed-receipt video is 149.88 seconds. Full decode and visual inspection passed. Captioned, no audio. |
| 4 | Review links | Judges can open test instructions, repository, presentation, and technical evidence without private credentials | Whitelisted inspector ZIP, public-key verification, live chain query, and video pass locally. Public inspector, guide, and technical-video links are recorded in submission preparation. |
| 5 | Human MVP submission | Every required field is complete and receipt retained before October 5, 23:59:59 CEST | No submission confirmation exists in this repository. |
| 6 | Buyer test | One real decision, current alternative, useful-time window, operator permission, and price/budget evidence | Not completed. Start alongside packaging before adding endpoint types. |
| 7 | Final hackathon presentation | Founder explains buyer, alternatives, evidence, hypothesis, and next test in 2–3 minutes | Prepare after the MVP package. It does not block using the technical walkthrough for Germany MVP. |
| 8 | peaq integration decision | One useful adapter flow or an explicit activation limitation | Read-only Agung registry readiness passed. Prepare exact identity/key/service inputs in isolation. Activation and activity events remain unimplemented. |
| 9 | Human final submissions | peaq and Colosseum submissions complete before October 13, 08:59 CEST | No submission confirmation exists in this repository. |

The October 4 package now includes an illustrated founder guide and a bounded rehearsal launcher.
Founder narration, registration, and submission confirmation remain open.
Aim to finish final Colosseum and peaq materials by October 11 at 18:00 CEST.

Bound the next peaq preparation session to 60 minutes of engineering work.
Keep the MVP gateway, firmware, payment rail, and buyer trust root stable during that session.
Record a concrete blocker instead of extending the attempt indefinitely.
Permanent activation needs reviewed public inputs, an operator wallet, and explicit bond and gas authorization.
Keep this gate outside the October 5 critical path.

## Match each competition to its evidence

Germany MVP needs a working, understandable product with meaningful Solana integration and accessible review links.
The existing Devnet payment and signed contact observation provide the technical seed.
The October 4 listing check confirmed these requirements. A custom Solana program remains optional.
[Germany MVP criteria](https://superteam.fun/earn/listing/road-to-colosseum-hackathon-build-your-mvp).

The peaq entry must explain a machine-economy mechanism, rather than a logo addition or disconnected features.
Operator/key/service registration is the intended peaq contribution. Read-only readiness alone does not complete that flow.
The listing accepts promising prototypes and identifies machine-to-machine commerce as relevant.
[peaq scope and criteria](https://superteam.fun/earn/listing/build-solutions-advancing-the-machine-economy-with-peaq).

Colosseum also assesses the startup: demand validation, distribution, founder insight, viability, and traction.
The founder must explain the actual learning and next buyer test alongside the technical demo.
No customer or revenue exists today. More code cannot supply those facts.
[Colosseum submission and judging guidance](https://colosseum.com/hackathon?year=fall2026).

## Judge rehearsal

From a fresh checkout, follow the README prerequisites and commands.

1. Run `uv sync --project host`.
2. Run `uv run --project host capmesh observe-demo --simulated`.
3. Check DISPATCH, stale-provider rejection, and `attacks_passed: true`.
4. Run `uv run --project host capmesh observe-demo --simulated --closed`.
5. Check WAIT and `attacks_passed: true`.
6. In `gateway`, run `npm ci`.
7. Run `npm run demo`.
8. Open `http://127.0.0.1:4022`.
9. Select **Get payment quote**, then **Run simulation**.
10. Check the simulation label and DISPATCH.
11. Wait eleven seconds and check WAIT.
12. Open `/proof` and test the changed state, changed challenge, and wrong key.
13. Check that the authentic recorded receipt remains expired.
14. Open the signed-receipt walkthrough and the public evidence files.
15. Select **Verify recorded payment** on `/proof`.
16. Check the exact transfer result and the unchanged expired WAIT decision.

This path moves no funds and invokes no physical device.
A recorded public Devnet transfer establishes the real integration separately.
A deployed simulator must not expose the physical gateway, private keys, device authorization, or private ledgers.
Publication requires a concrete review and owner authorization.

The [README export instructions](../README.md#inspect-the-recorded-physical-purchase) create a separate static inspector ZIP.
Its `guide.html` explains the story, radio paths, commands, and current limits. Its `index.html` executes recorded-receipt verification.
It includes no wallet, backend, private key, device authorization, or local ledger.
Use the complete simulator rehearsal to demonstrate a purchase. Use the inspector to examine recorded physical and chain evidence.

For the founder explanation, read [Understand the product](HOW_IT_WORKS.html#understand).
For the peaq path, read the [integration decision](PEAQ_INTEGRATION.md).

## Public test package

The recorded inspector, guide, and technical video have published links in [submission preparation](SUBMISSION.md).
The static site lives on `gh-pages`. Source lives on `main`.
A source push does not update the static site. Export and review a new package before a separately authorized site update.
Use [the README export instructions](../README.md#inspect-the-recorded-physical-purchase) to reproduce the package locally.
Keep wallets, ledgers, environment files, and hardware control outside the public export.
Registration and contest terms remain human actions. Technical rehearsal does not establish submission.

## Founder presentation outline

Use your own words. These are topics, not submission-field text.

- 0:00–0:20: one immediate buyer decision and the fact missing from its current workflow.
- 0:20–1:10: quote, payment evidence, measured contact, and independently checked receipt.
- 1:10–1:40: expiry and attacks. Explain why authentic evidence can still be unusable.
- 1:40–2:10: existing alternatives and the specific cross-organization workflow hypothesis.
- 2:10–2:40: what works, what remains unvalidated, and the next buyer test.

State that BOOT represents a contact. Show actual device footage if available.
Do not imply live payment during a recorded-evidence scene.
Do not describe the demo price as revenue, a signature as physical truth, or DISPATCH as permission to move.

## Evidence and disclosure

Use the [signed receipt](evidence/device-signed-purchase.json), [identity checks](evidence/receipt-identity-checks.json), and [device-signed contact states](evidence/device-signed-contact-states.json).
The October 2 state checks verify both BOOT states with the same provisioned P-256 pin.
The older contact-state evidence uses the historical HMAC format. Do not relabel it as P-256 evidence.

Inspect Git history before completing the prior-development field.
The initial checked repository commit dates to September 24, inside the September 14 event window.
The original concept and other relevant work can predate that commit. A commit date alone cannot establish when all development began.
The founder must disclose earlier concept/code history accurately and distinguish it from work inside the event window.

Registration, acceptance of contest terms, public uploads, external outreach, spending, and final submission remain separate owner actions.
Local work, documentation, verification, commits, and the requested repository push are authorized in this task.
