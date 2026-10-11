# Founder recording scripts

Speak in your own voice. The time blocks are editing targets. Run the live demonstration first, then replace every bracketed cue with the actual verified screen or cut that line. Keep physical footage, browser state, transaction, and peaq readback legible. Do not show a private key or wallet file.
Payment goes to the configured operator wallet. Do not describe the ESP32 as controlling that wallet.
The bounded buyer is software callable by an AI agent. Explain that distinction if no AI tool call appears in the recording.
The [current requirements](REQUIREMENTS.md) own cutoff and form checks. The [pilot questions](PILOT.md) own the buyer hypothesis.

## peaq entry: two-minute transaction video

**0:00–0:15 — buyer and question.** Show the request screen and the enclosure contact stand-in. “An AI agent that manages equipment at another site needs a current answer before its next decision. FieldProof lets it buy one contact check from an approved device.”

Use this grounded alternative when no AI agent appears: “This software buyer pays a real device operator for one new contact reading.
It fixes the question, price, and useful age before purchase. The board answers that request with a signed observation.”
Do not imply a validated equipment operator or customer in this prototype.

**0:15–0:35 — identity.** Show the finalized peaq identity readback only if active. “The buyer checks this peaq machine identity, its public receipt key, and its offered service before it accepts the price.” **If pending, say instead:** “The peaq identity check is in integration. Today I can show the existing paid contact prototype.” Do not show a prepared identity draft as activation.

**0:35–1:05 — payment and capture.** Show the quoted terms, 0.001 Devnet USDC transfer, actual contact input, and fresh result in one legible sequence. “The x402 request settles on Solana Devnet before the ESP32 samples the contact. The board signs the request and result with its P-256 key.” If the footage uses simulation or a recorded purchase, say so on screen and in speech.

**1:05–1:30 — acceptance.** Show signature and age, then WAIT after expiry or on a changed answer. “The buyer accepts a matching signed answer only within its ten-second policy window. An authentic old answer is still too old for this decision.” Both OPEN and CLOSED can fulfill a paid check. The buyer policy controls the next action.

**1:30–1:50 — activity record.** Show the peaq event transaction and independent hash readback only if verified. “The completed job now has a peaq activity record linked to the payment and original device receipt.” **If pending, say instead:** “A linked peaq activity record is still pending. This recording proves the Solana payment and signed contact result only.”

**1:50–2:00 — boundary.** “This is a contact observation, not proof of safe equipment use. Next I will test the workflow with one authorized remote operator.”

## Colosseum entry: startup pitch, target 2:40

**0:00–0:25 — problem.** “An AI agent can pay online, but payment alone cannot tell it what is happening at equipment another operator owns. Its next decision needs a current, attributable physical answer.”

**0:25–0:55 — product.** “FieldProof lets the agent buy a fresh check. In this prototype, it requests an electrical contact observation from an ESP32. Solana Devnet x402 settles 0.001 Devnet USDC before capture. The device signs its answer. The buyer checks the selected key, question, samples, and age.”

**0:55–1:20 — proof.** Show the actual transaction and receipt, then the same answer after its ten-second window. “A past paid run produced a signed OPEN reading. The buyer accepted it while fresh and returned WAIT after expiry. Changing the answer invalidates its signature.” Label this as historical if it is recorded evidence.

**1:20–1:45 — why this matters.** “The buyer hypothesis is an AI builder that manages remote equipment. The first question is a contact state. A single contact does not prove what is inside an enclosure or whether operation is safe. This is a small transaction contract for a real observation, not a broad sensor catalog.”

**1:45–2:10 — business test.** “I want one authorized operator and one AI builder to try a repeated decision. I will compare this workflow with their existing API or manual check. I will measure useful answers, integration work, failures, and recovery. Paid integration and support are the initial business hypothesis. No customer revenue is established.”

**2:10–2:40 — roadmap and ask.** “peaq identity and job history can make the selected machine and its activity inspectable across operators. I will claim that integration only after live readback. The next step is a real pilot at one site, then a second site to test reuse. I am looking for an AI equipment builder and a site operator willing to define one useful physical question.”

## Colosseum entry: separate technical demo, target 2:30

**0:00–0:20.** Show `POST /requests`, provider, contact question, and age limit. “The buyer fixes the question, provider key, budget, and freshness policy before purchase.”

**0:20–0:45.** Show `402` and x402 offer. “The resource server quotes 1,000 base units, or 0.001 Devnet USDC, on Solana Devnet. The buyer pins the network, mint, recipient, and amount.”

**0:45–1:10.** Show real transaction and physical input. “The gateway settles payment before BLE capture. BOOT is the electrical-contact stand-in. The ESP32 takes five matching samples and signs the original receipt with P-256.”

**1:10–1:40.** Show receipt acceptance, then expiry and tamper test. “The buyer checks the key, challenge, signed result, sample agreement, and age. At eleven seconds, the same signed answer fails the ten-second age policy. A changed state fails signature verification.”

**1:40–2:05.** If verified, show finalized peaq identity and event readback. Explain the identity-to-key association and event hash. If still pending, say: “The peaq identity and event path is still in integration. This demo contains no peaq chain claim.”

**2:05–2:30.** Show repository and inspector. “A reviewer can inspect the recorded real payment and receipt without a wallet. The local simulator runs a complete no-funds purchase. The public inspector reads recorded evidence and cannot make a new physical check.”

The Colosseum pitch and technical demo are separate recordings. Verify current form length and upload rules before export. The existing captioned video has no founder narration.
