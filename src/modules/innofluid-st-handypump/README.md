# Innofluid ST-HandyPump — how this module is built

Single-channel peristaltic pump (HandyPump01 head), speed in rpm, on **RS-485 Modbus RTU**. **Read it for**: a
binary protocol (`core/modbus.ts`), several pumps sharing one cable (each card owns an address), and a flow the app
must compute because the pump only knows rpm.
Manual facts with pages: [`docs/manuals/innofluid-st-handypump/notes.md`](../../../docs/manuals/innofluid-st-handypump/notes.md).

**Connecting the hardware:** [RS-485 adapter, wiring and first test](../shared/innofluid/RS485-ADAPTER.md) —
covers both Innofluid modules: which adapter to buy or build, how to daisy-chain, pump settings, bench test.

| File | What it shows |
| --- | --- |
| [`module.ts`](module.ts) | `protocol: MODBUS`, registers as text commands (`R1000`, `WF1002=58.8`), `derive()` turning rpm into mL/min with a setting |
| [`safety.ts`](safety.ts) | The shared pump rules, with the calibration setting attached to the Volume limit |
| [`sim.ts`](sim.ts) | A register bank behind real Modbus frames (`../shared/innofluid/modbusSim.ts`) |
| [`innofluid-st-handypump.test.ts`](innofluid-st-handypump.test.ts) | The driver against the simulator, keypad starts and stops, every rule tripping and not tripping |
| [`../shared/innofluid/`](../shared/innofluid/) | Shared by both Innofluid modules: `modbusSim.ts`, `pumpSafety.ts`, `RS485-ADAPTER.md` |

## Choices, and why

- **RS-485 Modbus, not RS-232.** Innofluid's RS-232 "N series" commands toggle (`q`, `h`), are not acknowledged, push
  a status line every second and allow one pump per port. Modbus writes are echoed (the app checks the echo), the
  pump answers with an error code in words, and up to 32 pumps share one cable (D60).
- **The address is the card's, not the command's.** Commands carry no address (`W1000=1`); the card's transport adds
  it. Every card on the same cable shares one bus (one port, one frame on the wire at a time). Add device asks for
  the address; Auto-detect does not try Modbus (a Modbus pump has no name to report).
- **mL per revolution** (setting on *Volume limit*, default 1.22 = 25# tubing at its maximum): the sheet has no
  tubing or flow register. The default makes Dispensed read high, so the limit stops early until calibrated.
- **Dispensed errs high, never low** (`pumpVolume` in `../shared/innofluid/pumpSafety.ts`): a failed speed read uses
  the last speed; time is counted while the pump runs now or ran at the previous poll, across gaps with no replies;
  a "stopped" reply switches the card off only on two polls in a row while it is on (one poll can race a start).
- **Speed max 300 rpm** from the HandyPump datasheet (the generic sheet says 600).
- **Running is read** from register 1000 every poll. Whether the pump answers reads is not shown in the sheet —
  the first bench check. Without it, *Run reading* stops the pump after 10 s.
- **Direction is never written** (set it on the pump; a reversed pump pulls from the flask). It is read and recorded.
- **No broadcast.** The two Innofluid maps put start/stop in different registers, so each pump is stopped by its own
  address; Stop all does that for every card.
- **`provides: ['pump', 'dosing']`**.

## Safety rules

| Rule | Trips when | Default | Turns off |
| --- | --- | --- | --- |
| Run reading *(always on)* | the pump stops reporting whether it runs, for 10 s, while switched on | 10 s | the pump |
| Volume limit | Dispensed reaches the maximum. Holds **mL per revolution**, used for Flow and Dispensed | off (10 mL) | the pump |
| Dose only while stirring *(with stirrer)* | the pump runs (switch or keypad) while nothing on the page stirs, for N s | 5 s | the pump |

Rules are shared with the LabV1 module (`../shared/innofluid/pumpSafety.ts`). Resetting a volume trip sets Dispensed
back to 0 (`onReset`).

## Still to check on the bench

See the checklist in [`notes.md`](../../../docs/manuals/innofluid-st-handypump/notes.md): pins, reads with function
03, even parity, keypad start/stop seen in `R1000`, mL per revolution per tubing.
