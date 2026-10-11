# Configure one contact observer

**GPIO9 BOOT is deployed. External-input software exists, but the shared-budget paid paths still require GPIO9.**
Use [the current physical checklist](HARDWARE_NEXT.md) before any new fixture.
Audience: the operator who prepares the fixture and the buyer who selects its evidence.
Use this guide after the [board, sensor, and wiring checks](HARDWARE_NEXT.md#resolve-the-board-before-wiring).
On October 5, the attached board changed to GPIO20 for a prototype foil-contact check.
The application-only flash passed hash verification. The open check and a paid ABSENT proof passed. The first reported foil closure still read ABSENT.
A direct lead-contact check returned authenticated PRESENT and DISPATCH. The foil fixture and paid PRESENT request remain unverified.
The operator removed the added leads. The saved GPIO9 application is restored, with its flash hash verified.
New signed held/released browser checks passed CLOSED/WAIT and OPEN/DISPATCH with five matching samples.
The new OPEN answer expired to WAIT at eleven seconds.
Use BOOT for the recording. The archived receipts remain unchanged.

## Understand the four settings

| Setting | Source of truth | What it controls |
|---|---|---|
| Input GPIO | Firmware `CONFIG_FIELDPROOF_CONTACT_GPIO` | The physical input that the ESP32 samples |
| Provider ID | Intended board's USB startup log | The device that the buyer selects |
| Public receipt pin | Intended board's trusted USB `P256_PUBLIC_KEY=` line | The signing key that the buyer accepts |
| Sensor name | Buyer and gateway configuration | The exact signed input descriptor, such as `gpio18-contact` |

Changing a host setting does not change the firmware's input.
Discovering a device does not provision its key.
The buyer rejects a valid signature when its provider, sensor, challenge, or age fails the contract.
The gateway compares the buyer's public pin before it creates a quote.
It never treats a gateway response as authority to replace the buyer's pin.

## GPIO20 foil-contact candidate

The operator identified ESP32-C6 Super Mini and printed `20` and `GND` labels. The chip reports ESP32-C6FH4.
GPIO20 has no other firmware assignment. It is separate from USB and chip strapping pins.
[Espressif GPIO restrictions](https://docs.espressif.com/projects/esp-idf/en/stable/esp32c6/api-reference/peripherals/gpio.html).
The exact board manufacturer and revision remain unverified.

1. Disconnect USB before wiring.
2. Connect printed `20` to foil A with one insulated lead.
3. Connect printed `GND` to foil B with a separate insulated lead.
4. Secure the leads and keep exposed metal away from other board pins.
5. Keep the foil pieces apart, then reconnect USB.

The input uses its internal pull-up. Open contact reads `closed: false`. Contact to ground reads `closed: true`.
The explicit package-pickup policy maps these values to PACKAGE_ABSENT and PACKAGE_PRESENT.
Fresh, authenticated PRESENT evidence permits DISPATCH. ABSENT, stale, or invalid evidence keeps WAIT.
This fixture demonstrates contact closure. It cannot identify a package or distinguish absence from a broken wire.

The firmware profile is [package-contact.defaults](../firmware/esp32/package-contact.defaults).
Use it after `sdkconfig.defaults` in an isolated build. Keep the default GPIO9 configuration for the button fallback.
Flash only the application at `0x10000`. Preserve the partition table and NVS signing-key storage.
Restore the saved GPIO9 application at the same offset to return to BOOT. Disconnect the foil during restoration.

The standalone `buyer.js` supports `--package --sensor gpio20-contact` for the historical experiment.
The current `paid-checks.js`, `agent-contact.js`, and browser buyer remain GPIO9-only.
Do not use the standalone buyer to bypass the shared operation budget.
Before another paid GPIO20 take, add bounded profile support and mixed-profile ledger tests.
The gateway uses `FIELDPROOF_CONTACT_SENSOR=gpio20-contact` and `FIELDPROOF_BUYER_PURPOSE=package-pickup`.
The inspector uses `/proof?view=package&live=1&present=1`. It requires a new GPIO20 buyer output.
The package view never loads the older GPIO9 purchase as fallback evidence.
The signed wire labels remain `gate.closed` and `demo-gate`. The local buyer policy gives the contact its package meaning.
Payment, nonce generation, signature format, and cryptographic verification remain unchanged.
Do not describe this fixture as verified until both physical states and a new end-to-end request pass.

## Preserve the working demonstration

1. Wait until the overnight diagnostic ends before any scan, flash, reset, or wiring change.
2. Preserve the existing public GPIO9 evidence and signing pin.
3. Keep the bare LED disconnected until its resistor and wiring are verified.
4. Use only an unpowered dry contact for the external-input fixture.

The supported chip GPIOs are `0, 1, 2, 3, 6, 7, 9, 18, 19, 20, 21, 22, 23`.
This list does not establish availability on the actual board header.
GPIO9 remains the legacy BOOT demonstration. Select a different verified pin for a permanent fixture.
Other pins fail firmware compilation and buyer configuration validation.
No test drove GPIO20.

## Build an isolated GPIO18 candidate

Prerequisites: the actual schematic confirms GPIO18 availability, and the ESP-IDF 6.1 environment is active.
This command builds a candidate. It does not flash or test the connected circuit.
Start at the repository root.

```bash
fieldproof_root="$PWD"
mkdir -p .local
printf 'CONFIG_FIELDPROOF_CONTACT_GPIO=18\n' > .local/contact18.defaults
(cd firmware/esp32 && idf.py \
  -B "$fieldproof_root/.local/firmware-contact18" \
  -D "SDKCONFIG=$fieldproof_root/.local/contact18.sdkconfig" \
  -D "SDKCONFIG_DEFAULTS=$fieldproof_root/firmware/esp32/sdkconfig.defaults;$fieldproof_root/.local/contact18.defaults" \
  build)
```

The candidate samples GPIO18 as an input with an internal pull-up.
An input-to-ground contact reports CLOSED. An open circuit reports OPEN.
Its receipt signs `gpio18-contact` with the existing v3 format.
The default GPIO9 build and isolated GPIO18 build both passed. See [verification](VERIFICATION.md).
Flash only the reviewed application after the physical prerequisites pass and the diagnostic releases the device.
Preserve NVS. Follow the [identity and recovery procedure](RECEIPT_IDENTITY.md#provision-a-new-board).

## Provision a second device without replacing the first pin

1. Read the intended second board's provider ID through trusted USB.
2. Read its public signing key through the same trusted connection.
3. Copy `host/capmesh/protocol/receipt_keys.json` to `.local/contact-pins.json`.
4. Add the second provider and its public key under `providers`.
5. Preserve the first provider's entry.
6. Verify each board against its own pin.
7. Swap the pins in a test configuration and verify rejection.

The file contains `algorithm: "ecdsa-p256-sha256"` and a nonempty `providers` object.
Each provider ID uses 1–31 ASCII letters, digits, hyphens, or underscores.
Each pin contains a lowercase, uncompressed P-256 point. Invalid curve points fail before network or Bluetooth access.
Never put a private key in this file.
Two configured public keys passed software verification. No second physical board was tested.
The [pair policy and signed-fixture rehearsal](CORROBORATION.md) require both configured OPEN answers and reject conflicting or missing evidence.
The [unpaid BLE pair runner](CORROBORATION.md#collect-two-provisioned-ble-contacts-once) is ready after these prerequisites pass.
Its two-board physical verification and payment gates remain open.

## Select the physical profile

Prerequisites: the candidate firmware runs on the intended board, wiring passes, and its trusted pin file exists.
The commands below select the current board ID. For another board, use its USB-verified ID.
Start each block at the repository root. Keep other BLE consumers stopped.

First, run an unpaid observation:

```bash
uv run --project host capmesh observe-demo \
  --provider esp32-c6-96a2 --sensor gpio18-contact \
  --pins .local/contact-pins.json --ledger :memory:
```

Expect `pinned-device-p256`, the selected provider, `gpio18-contact`, and `attacks_passed: true`.
Verify fixture CLOSED and OPEN separately. Record instability, disconnect behavior, and expired WAIT.
The simple circuit reports a broken wire as OPEN. It has no fault detection and cannot authorize safe motion.

Then, rehearse with simulated payment and the real configured input:

```bash
FIELDPROOF_PROVIDER_ID=esp32-c6-96a2 \
FIELDPROOF_CONTACT_SENSOR=gpio18-contact \
FIELDPROOF_RECEIPT_PINS=.local/contact-pins.json \
npm --prefix gateway run demo -- --physical
```

The page identifies the configured input. Its payment label remains simulated.
Stop the simulator before starting the real Devnet gateway with the same three environment values.
The gateway validates the selected public pin before it offers payment.

The included paid buyer selects its own trusted profile:

```bash
node gateway/buyer.js /path/to/disposable.keypair.json \
  --provider esp32-c6-96a2 --sensor gpio18-contact --pins .local/contact-pins.json
```

This command spends test funds. The gateway must run in real Devnet mode first.
The buyer refuses changed provider, sensor, pin, location, freshness, or endpoint terms before payment.
Its public pin remains independent of the gateway response.

## Handle configuration changes

Every quote stores the contact profile and public pin in SQLite.
A gateway restart with different settings rejects the quote before a payment challenge or settlement.
Quotes from older ledgers have no stored profile. Create a fresh request after migration.
Delivered receipts remain retrievable with their original proof. Their original timestamp remains unchanged.
Expired cached evidence stays WAIT. A retry performs no new payment or measurement.

Restart the gateway after an operator pin-file change. It snapshots the configured pin at startup.
The bridge uses the stored quote pin. A later file edit cannot change a paid delivery's verification key.
This protects configuration consistency. It does not guarantee that the hardware remains available after settlement.
An incorrectly configured device or unavailable input can still cause paid delivery failure and manual refund review.

## Keep the peaq identity bound to the selected device

The read-only Agung diagnostic accepts `--provider` and `--pins` with the same trusted public file.
Its proposed identity binds the selected provider and key. It does not activate an identity or spend tokens.
Use the [peaq runbook](PEAQ_INTEGRATION.md#reproduce-the-read-only-result).

## Demonstrate the extension honestly

The current recorded inspector verifies the original board and GPIO9 evidence.
It does not switch to the live profile or verify a new installation automatically.
Record new signed fixture states before describing an external-contact demonstration as verified.
Use [the rehearsal](REHEARSAL.md) for the explanation and [the acceptance gates](HARDWARE_NEXT.md#acceptance-gates-for-each-upgrade) for claims.
