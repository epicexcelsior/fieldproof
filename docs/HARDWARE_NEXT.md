# Make the physical demo tangible

Current recommendation, October 11, 2026: **record the existing BOOT input first**.
The founder has the ESP32, Seeker, and a few unreliable leads. New parts are optional.

## Record tonight without new parts

1. Put the powered ESP32 beside the laptop.
2. Identify BOOT as the electrical contact stand-in.
3. Release BOOT and run the unpaid OPEN check.
4. Hold BOOT and run the unpaid CLOSED check.
5. Record one paid check with the input visible.
6. Show the same original answer in the phone verifier.

Use [the physical rehearsal](competition/REHEARSAL.md) for commands.
Do not press Reset while holding BOOT. Do not flash or change wiring during a purchase.
The board supplies a real input change. A cardboard enclosure alone supplies no measurement.

## Optional Maker Lab parts

Confirm access and available parts before traveling. The lab's current hours and stock remain unverified.
Borrow these items when possible:

| Part | Purpose |
|---|---|
| One passive two-wire magnetic door contact and its magnet | Turns opening a lid into a measured electrical change |
| Reliable insulated jumper wires | Connect the input and ground without intermittent contact |
| Small breadboard or terminal block | Holds connections securely |
| Multimeter | Verifies contact continuity before connection |
| Small hinged box or cardboard fixture | Makes the contact movement visible |

Request a dry-contact switch. It needs no power supply.
Do not buy an active alarm module, mains sensor, relay, motor, or camera for this deadline.
Confirm the switch state with a multimeter. Do not assume its open/closed behavior from packaging.

## Is this achievable in one day?

A door-contact fixture is a bounded upgrade when parts, board labels, and software support are ready.
It does not justify a day of sourcing. Limit assembly and verification to 60–90 minutes after recording the working baseline.
If any acceptance test fails, restore BOOT and use that footage.

The GPIO20 firmware candidate exists, but GPIO9 is deployed now.
The current shared-budget paid launchers and ledger validate GPIO9.
GPIO20 needs explicit bounded-buyer support and mixed-profile tests before paid recording.
The standalone configurable buyer is not a substitute for the shared operation guard.
[Contact configuration and historical experiment](CONTACT_SETUP.md).

## Resolve the board before wiring

The earlier operator identified an ESP32-C6 Super Mini with printed 20 and GND labels.
The exact manufacturer and revision remain unverified. Confirm those labels on this board before wiring.
GPIO20 is separate from the chip's USB and strapping pins. Board-level connections still require verification.
[Espressif ESP32-C6 GPIO restrictions](https://docs.espressif.com/projects/esp-idf/en/stable/esp32c6/api-reference/peripherals/gpio.html).

Disconnect USB before wiring. Use only an unpowered switch between the verified input and ground.
Never connect an unknown lead or external voltage to a GPIO.
Do not use GPIO9 as a permanent door-switch input because it is a boot strap.

## Acceptance gates for each upgrade

1. Verify continuity with the switch and magnet in both positions.
2. Verify the board labels and isolated GPIO20 build configuration.
3. Preserve the current signing-key storage and saved GPIO9 application.
4. Flash only the reviewed application region. Do not erase the board or NVS.
5. Verify both switch states with no-payment signed requests.
6. Verify the device key still matches the independent public pin.
7. Verify sensor, samples, request binding, freshness, and expected physical state.
8. Run the bounded paid route only after its profile support and tests pass.
9. Record the input, actual paid result, and independent verification together.
10. Restore GPIO9 if timing, wiring, or any verification fails.

A closed contact does not prove contents, identity of an item, repair completion, or safe operation.
Keep the specific claim visible: this device reports this electrical input now.

## Phone and camera scope

The Seeker can independently verify the laptop's receipt. It can also film the board in a separate take.
Its requested-photo app builds offline. Real capture and a paid phone provider remain unverified.
Hardware-backed signing alone does not prove camera origin or truthful pixels.
Do not make the phone app or a second paid provider a submission prerequisite.

The [earlier sourcing and hardware plan](https://github.com/epicexcelsior/fieldproof/blob/474b92e/docs/HARDWARE_NEXT.md) remains in Git.
It does not establish current lab stock, opening hours, or fixture reliability.
