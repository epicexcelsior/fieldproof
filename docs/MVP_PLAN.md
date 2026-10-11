> Historical initial MVP plan. Its logistics scenario is an example, not a validated buyer.
> Use [current status](FOCUS.md), [the story](competition/STORY.md), and [current requirements](competition/REQUIREMENTS.md).
> This file does not define the current submission or claim autonomous AI reasoning.

# FieldProof MVP plan

FieldProof lets an autonomous logistics agent buy fresh evidence before it dispatches a vehicle through a gate.
The implementation stays in this Git repository. The existing `capmesh` Python package and BLE UUIDs remain compatible.

## Decisions

- Use the attached ESP32-C6 as the physical observer.
- Sample GPIO9 as a contact input. The onboard BOOT button represents a closed gate in the demo.
- Call this a button/contact demonstration. Do not claim occupancy sensing, location attestation, or independent corroboration.
- Use one named location, `demo-gate`, and one metric, `gate.closed`.
- Use a fresh buyer challenge for each observation. Bind the location, device, result, nonce, and timestamps to its authenticator.
- Pin demo provider identity in buyer configuration. Never accept a manifest's own trust label.
- Show a cheaper stale software provider and explain its rejection.
- Use x402 V2 with Solana Devnet USDC. Keep settlement separate from device authorization.
- Keep a simulator available for judges without hardware. Label all simulated evidence and settlement.
- Store served and unmet demand locally. Do not publish, push, or contact anyone automatically.

## Acceptance criteria

| Requirement | Observable evidence |
|---|---|
| Real measurement | Flashed firmware samples an input GPIO after authorization. Live BLE test returns signed samples. |
| Visible physical change | Holding/releasing BOOT changes the reported contact state and dispatch decision. Manual verification is explicit. |
| Freshness | Buyer checks challenge, timestamp, age, location, device, and sample consistency. |
| Replay defense | Device rejects reused requests. Buyer rejects reused responses and responses for another challenge. |
| Tamper defense | Altering the state, location, nonce, samples, or time fails receipt verification. |
| Provider selection | Buyer rejects a cheaper stale provider and chooses fresh evidence within a budget. |
| Payment boundary | Unpaid and invalid requests never invoke the hardware. Verified settlement precedes paid measurement. |
| Recovery | Retrying a purchase cannot cause a second payment or measurement. Failures retain a reviewable purchase record. |
| Product view | Local web page displays observation, decision, rejected evidence, payment mode, and demand. |
| Tests | Deterministic protocol, selection, payment, socket tests, and opt-in real-board tests pass. |
| Documentation | README, protocol, architecture, demo runbook, overview Markdown/HTML, and evidence report match current code. |
| Repository | Coherent local commits include the pivot and tests. Secrets and build outputs stay excluded. |

## Build sequence

1. Preserve the existing authorization corrections and establish a passing software baseline.
2. Implement and test the observation contract, buyer verification, provider fixtures, and demand ledger.
3. Add GPIO contact sampling, flash the ESP32, and run live observation and attack tests.
4. Integrate the observation with an x402 gateway and test verification, settlement, retries, and delivery failure.
5. Add the local product view, automated simulator, and constrained payment client.
6. Update canonical documents, verify visual behavior, record results, and commit coherent changes.

## Track strategy

Carlo's direction prioritizes Superteam Germany's Colosseum and peaq machine-economy tracks.
The [submission draft](SUBMISSION.md) records verified requirements and deadlines from both complete rendered listings.
The real Devnet purchase and human contact-state checks now pass. The repository is public. Presentation, Colosseum, and contact details remain owner tasks.
Native peaq activation is not an explicit mandatory requirement. Current official Solana onboarding remains paused.

## Scope after the overnight MVP

Multiple independent observers, calibrated confidence, demand-funded installations, production device keys,
hardware attestation, and customer pilots are later work. A signed button measurement does not establish external physical truth.
The first buyer hypothesis is temporary operational state for mobile logistics and robotics.

## Starting evidence — October 1, 2026

The existing code offers LED actuation and an unpaid x402 challenge. It does not implement the requested observation product.
The software baseline command passes eight tests:

```bash
uv run --project host --with pytest --with pytest-asyncio pytest -q tests/test_security_contract.py tests/test_network_http.py
```

The installed `@x402/express` 2.27.0 middleware runs the route handler before default settlement.
The previous README's claim that it settles before BLE invocation is incorrect.
The observation gateway must enforce its own reviewed ordering and test that boundary.
