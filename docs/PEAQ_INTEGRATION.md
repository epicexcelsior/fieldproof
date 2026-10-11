# peaq integration decision

**October 11, 2026: keep Solana settlement. The optional peaq-linked job and operator paths exist in code. Live activation and events remain pending.**
The [paid-job runbook](JOBS.md) owns execution commands, current policy, event bytes, and recovery.
This document records the SDK/deployment decision and historical readiness evidence.
In that optional path, the buyer connects the observer identity to its pinned key and service before payment.
This document owns peaq interfaces, readiness, and activation gates.
The [current requirements](competition/REQUIREMENTS.md) establish no general Agung transaction requirement.
Use the [Solana rehearsal](competition/REHEARSAL.md) while activation is pending.
That path claims no peaq identity or event. The Agung path must retain its strict live authority gate.

## October 11 host preflight

The official operator guide publishes Agung EventRegistry `0x2DAD8905380993940e340C5cE6d313d5c2780040`.
The revised diagnostic accepts that reviewed source without requiring an undocumented InfoDesk event peer.
At finalized block `11124093`, the address contains 170 bytes of proxy code.
Its `identityRegistryAddress()` returns legacy registry `0x9E9463a65c7B74623b3b6Cdc39F71be7274e5971`.
Our approved Tokenomics 2.0 MachineRegistry is `0x538da35489B1F0035799a8351E67835ae4ABb377`.
The live binding differs. Official publication alone does not authorize submission to that incompatible registry.
Both inspection and signing retain the machine-binding check. No registry transaction occurred.
[Official guide at the reviewed commit](https://github.com/peaqnetwork/peaq-os-skills/blob/d1f7e87db50f5f16c62527344673a470dcec3c39/skills/peaqos/GUIDE.md#network-reference)
and [exact chain diagnostic](evidence/peaq-agung-event-registry-20261011.json).

The founder approved one testnet activation with a 0.4 AGUNG bond and a 0.04 AGUNG combined gas ceiling.
The existing operator still needs faucet funding. The API request returned HTTP 403.
The official browser form then reported its 24-hour limit. Latest and finalized balances still read zero.
The founder must supply the faucet transaction link or an exact error to resolve this funding discrepancy.
The signer remains unused. Activation and finalized identity readback remain pending.

peaq native storage supplies a separate activity-anchor path through precompile `0x0000000000000000000000000000000000000801`.
That implemented path records a paid job hash under the current operator and verifies finalized storage and transaction data.
It checks actual registered authority at the buyer's identity block and the later storage transaction block.
It compares the registered key, owner, controller, block hash, and original block time.
It does not represent a peaqOS EventRegistry event or contribute a verified Machine Credit Rating.
Controlled tests cover this path. Live activation, a gated paid job, and activity readback remain pending.
The repeated finalized no-signing probe found the official precompile at block `11124299` and verified its exact missing-key response.
[Storage interface readback](evidence/peaq-agung-storage-readiness-20261011.json) establishes no activated identity or completed job.
The storage owner can update or remove an entry. The successful historical transaction remains independently inspectable.
The path requires explicit selection and separate write approval. One activity has a 0.01 AGUNG maximum gas ceiling.
[Official peaq storage operations](https://docs.peaq.xyz/peaqchain/sdk-reference/javascript/storage-operations).

### Earlier October 11 lookup

The latest no-signing audit reached finalized block `11123336` and found the proposed identity absent.
The existing testnet operator balance was zero. The full tier-0 bond remained 0.4 native test tokens, before gas.
The activity peer remained unset. No activation or event followed these reads.
The original project provenance gate required an InfoDesk event peer.
That unsupported requirement caused the first discovery blocker. The revised diagnostic now uses the reviewed official source.
The independent machine-binding check reveals a separate live compatibility blocker.

The founder supplied logs from the laptop's normal terminal. Gateway checks passed 43 tests. Core Python checks passed 40, with nine SDK skips.
Agung deployment reads passed at finalized block `11117566`, hash `0x94815e1969f93628682063b394361b3e368d584ae2fa37ba9c367071c2a21149`.
The seven published contracts contain bytecode, and their documented peers match. The proposed observer identity remains absent at this block.
The full tier-0 bond read remains `400000000000000000` base units. Operator credit, balance, allowance and gas still require preview.

The activity adapter queried `InfoDesk.peer(keccak256("EVENT_REGISTRY"))` and received a zero address.
This discovery convention was an unverified integration assumption. The SDK accepts a separately supplied EventRegistry address.
The failed lookup does not establish that every Agung activity route is unavailable.
The revised check uses the published address and preserves the incompatible-registry result above.
No SDK upgrade, activation or activity write followed this failure.
[Current SDK configuration and event routing](https://pypi.org/project/peaq-os-sdk/0.11.2/).

## Other peaq surfaces reviewed October 11

Agung identity and activity remain a prepared integration option. In that path, the buyer checks the registered device before spending.
The current SDK documentation explicitly skips Agung MCR integration because no approved paired rating endpoint exists.
Its Stream purchase surfaces remain in development. Its Verify surface supplies API reads and chip preflight, not phone camera attestation.
These surfaces do not supply a verified shortcut for the current contact demonstration.
[Current published SDK](https://pypi.org/project/peaq-os-sdk/).

The official peaq x402 example requires native peaq gas and USDC/USDT balances.
Retain the tested Solana Devnet settlement before adding a second payment path.
[Official x402-peaq example](https://github.com/peaqnetwork/x402-peaq).

A requested physical-check adapter remains the best bounded extension after live acceptance.
The bounty explicitly suggests new robotic.sh services. Verify the extension interface and hosted admission before implementing a listing.
No hosted FieldProof adapter or marketplace demand is established.
[Official bounty](https://superteam.fun/earn/listing/build-solutions-advancing-the-machine-economy-with-peaq).

## What the diagnostic establishes

[`check_peaq_readiness.py`](../scripts/check_peaq_readiness.py) reads the Agung testnet through the published RPC.
It uses the deployment snapshot and contract interfaces from `peaq-os-sdk==0.10.0`.
It requires no private key, account, platform API key, or physical board.
Its RPC transport permits only chain ID, block, bytecode, and contract reads. It refuses signing and transaction methods.

The [recorded readiness result](evidence/peaq-agung-readiness.json) reports:

| Read at finalized block 10,997,811 | Result |
|---|---|
| Connected chain | Agung, chain ID 9990 |
| Published deployment | `agung-2026-08-28` |
| Seven contract addresses | All contain bytecode |
| Six InfoDesk peer entries | All match the published snapshot |
| Proposed machine ownership | Decoded `MACHINE_NOT_FOUND` / `ERC721NonexistentToken`; no local token exists at this block |
| Subscription economic authority | `true` |
| Global and proposed-machine technical pause | Both `false` |
| Tier-0 full bond | `400000000000000000` base units |
| Payment token | Native-balance precompile `0x0000000000000000000000000000000000000809` |

The SDK identifies this precompile as the native balance used for the bond and gas.
The recorded bond equals 0.4 native test tokens at 18 decimals. Gas requires additional balance.
This is a full bond read, not an operator-specific quote. Voucher credit, allowance, gas, and operator funding remain unchecked.
These values can change before activation. The script reads every value again when it runs.
[Network configuration](https://docs.peaq.xyz/peaqchain/build/getting-started/connecting-to-peaq), [published Python SDK](https://pypi.org/project/peaq-os-sdk/0.10.0/).

Bytecode presence and peer agreement do not audit implementation code or establish the safety of contract upgrades.
This readiness result does not replace the SDK's full activation preflight.

## How the identity proposal connects to FieldProof

The proposed machine type is `FieldProofContactObserverV1`.
The credential subject contains a versioned schema, the ESP32 provider ID, and the existing public P-256 pin.
The diagnostic accepts an operator-selected provider and trusted public pin file for another observer.
Changing either value changes the proposed identity bytes. Missing or invalid pins fail before RPC access.
The script sends these exact public bytes to `MachineRegistry.computeTokenId` at the recorded block.
It preserves the resulting 256-bit identifier as a decimal string. JavaScript numbers cannot preserve every identifier of this size.

The proposed ID is:

```text
2044618828586167349407969644236800133676464971368659651643404080491769435145
```

The result means that the registry can derive an identity from these proposed bytes.
It does not mean that FieldProof owns an activated identity.
The diagnostic now reads ownership through the SDK's supported `TokenomicsReadContext` interface. It requires no signing account or full wallet client.
The RPC guard pins this lookup and all other contract reads to the same finalized block.
`registry_state.status: not_found_at_block` requires the SDK's decoded nonexistent-token error.
An RPC failure, rate limit, or undecoded revert fails visibly. A foreign home reports `homed_elsewhere` instead of absence.
The diagnostic's `activated: false` states that it performs no activation.
An absent ID is not reserved. Another actor can register it after this snapshot.
An owner lookup does not establish key possession or the intended operator's right to that identity.

Before activation, define the operator, controller, manufacturer field, verification method, and service endpoint.
Use the approved SDK activation flow with explicit spending bounds and receipt reconciliation.
The current full client also requires legacy contract constructor arguments. Do not fill them with invented addresses to make initialization pass.

## Prepare public key and service inputs offline

[`prepare_peaq_identity.py`](../scripts/prepare_peaq_identity.py) prepares a public input draft without a wallet, client, or network connection.
Run from the repository root:

```bash
uv run --project host python -m scripts.prepare_peaq_identity
```

The draft preserves the exact credential-subject bytes used by the readiness diagnostic.
It compresses the pinned P-256 public point and encodes a `Multikey` verification method.
The encoding uses the `p256-pub` multicodec prefix and base58btc multibase.
[W3C ECDSA public-key encoding](https://www.w3.org/TR/vc-di-ecdsa/#multikey).

The service URI is `urn:fieldproof:ble-contact:esp32-c6-96a2:gpio9-contact:state.observe`.
This URI labels a local BLE observation capability. It is not an Internet gateway endpoint or an implemented registry-discovery path.
Add `--provider`, `--sensor`, and `--pins` to select another public configuration.
Selecting GPIO18 does not verify its wiring or installation.
The sensor belongs to the service description, not the immutable identity subject.

The default draft leaves controller, manufacturer, and spending bound unset.
It reports `sdk_validation: not_run` and `activated: false`.
No owner wallet exists in the draft. The eventual signer owns the identity and pays the bond.

For local SDK validation, supply all three explicit inputs:

- `--controller`: the selected public EVM controller address.
- `--manufacturer`: the recorded public manufacturer address. The registry does not verify this claim.
- `--max-net-base-units`: the reviewed maximum net bond. This excludes gas and does not authorize spending.

Use the isolated SDK command below with these arguments and `--sdk-validate`:

```bash
DO_NOT_TRACK=1 PEAQOS_TELEMETRY=0 uv run --no-project --with peaq-os-sdk==0.10.0 python -m scripts.prepare_peaq_identity --help
```

The optional validation uses the published SDK's local input validator and DID struct encoder.
It creates no SDK client, account, signing request, transaction, or full activation preview.
The struct's empty `id` follows the SDK. The registry derives the DID from the permanent token ID when it reads the record.
The remaining gates include owner selection, current ownership, full preflight, funding, explicit bond/gas approval, activation, and readback.
An encoded draft does not establish device key possession, physical truth, service availability, or site permission.

## Complete the integration after the write gates

The intended completed flow is:

1. Activate an observer identity with an explicit operator and public verification method.
2. Read its owner, controller, verification method, and observation endpoint back from peaq.
3. Compare the registered key with the independently provisioned buyer pin.
4. Complete a Solana Devnet observation purchase through the existing gateway.
5. Verify the delivered device receipt independently.
6. Record a permitted activity event with the observation evidence hash.

Steps 1–6 have software adapters and offline contract tests. Their connected live execution remains unverified.
The existing Solana purchase has historical physical evidence.
The Agung EventRegistry address and its InfoDesk and MachineRegistry relationships still require live verification.
Do not represent a test-token payment as revenue in a machine history.
Do not publish private location or customer data as event metadata.

Registry registration records an operator claim. It does not establish device key possession, installation, physical truth, or site permission.
The public identity inputs also require an ownership and reservation review before activation. An identifier alone is not an authorization mechanism.

## Why native Solana onboarding is not a drop-in replacement

The current 0.11.2 SDK describes native Solana activation through selected mainnet deployments and a cross-chain peaq link.
It does not establish a Solana Devnet-only replacement for this demonstration.
The flow includes wallets, bonds, network fees, and external validation. No activation occurred here.
Keep the tested Solana payment instead of making mainnet onboarding a recording dependency.
Agung readiness does not establish native Solana activation.
[Current native-chain SDK documentation](https://pypi.org/project/peaq-os-sdk/0.11.2/).
[Solana onboarding guide](https://docs.peaq.xyz/peaqos/guides/onboard-on-solana).

The inspected Python release supports selected Tokenomics identity and event surfaces.
It also rejects unsupported identity-dependent Machine Markets operations before network work.
No public generic registration endpoint for a FieldProof provider was established through the inspected robotic.sh service example.
Do not claim that catalog access activates a FieldProof observer.
[Python SDK interface status](https://pypi.org/project/peaq-os-sdk/0.10.0/), [robotic.sh service example](https://www.robotic.sh/services/acurast).

## Reproduce the read-only result

Run from the repository root. This command uses an isolated SDK environment and leaves MVP dependencies unchanged.
The explicit environment values disable SDK telemetry.

```bash
DO_NOT_TRACK=1 PEAQOS_TELEMETRY=0 uv run --no-project --with peaq-os-sdk==0.10.0 python scripts/check_peaq_readiness.py
```

Expect `chain_id: 9990`, `peers_match: true`, both pause flags `false`, and a proposed machine ID.
Read `registry_state` separately. A registered owner, an absent token, and a foreign home represent different states.
Add `--provider` and `--pins` after the script path to select a provisioned second observer.
Pin-file paths resolve from the repository root. No second physical observer or activated identity is claimed.
An unavailable RPC, changed peer, missing contract, wrong chain, or active pause produces a visible error and exits unsuccessfully.
Contract reads at another block and state-override parameters also fail before network access.
The script does not silently switch endpoints or deployments.

The inspected wheel SHA256 is `508808bb565ec3bf088759e047cba12e70678aa3f9d0ef335c88c34ab90e0e3e`.
The readiness run used that wheel in an isolated environment. The command above resolves the same version through PyPI.

## Decision required before a write

The founder authorized a new disposable Agung operator wallet. Its private key stays in ignored local state.
Wallet creation authorizes no funding, bond, gas, activation, or event submission.
Review exact public identity inputs and the current bounded bond and gas cost first.
Activation creates permanent public state. The SDK describes no deactivation or bond refund.
No mainnet funds or activation belong in this competition prototype's critical path.
[SDK activation and integration limits](https://pypi.org/project/peaq-os-sdk/0.10.0/).
