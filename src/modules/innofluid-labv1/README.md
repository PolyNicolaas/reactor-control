# Innofluid LabV1-III — how this module is built

Dispensing peristaltic pump (EasyPump III head), flow in mL/min, on **RS-485 Modbus RTU** — on the same cable as
the ST-HandyPumps. **Read it for**: a second register map behind the same transport, a pump that converts mL/min to
rpm itself, and an init command that puts the pump in the one mode the app can follow.
Manual facts: [`docs/manuals/innofluid-labv1/notes.md`](../../../docs/manuals/innofluid-labv1/notes.md).

**Connecting the hardware:** [RS-485 adapter, wiring and first test](../shared/innofluid/RS485-ADAPTER.md).

| File | What it shows |
| --- | --- |
| [`module.ts`](module.ts) | The Lab V register map, `initCommands: ['W1020=0']`, flow setpoint, the pump's chosen speed read back |
| [`safety.ts`](safety.ts) | Shared pump rules plus *Transfer mode* |
| [`sim.ts`](sim.ts) | The Lab V register bank; flow and speed kept in step by a simulated calibration |
| [`innofluid-labv1.test.ts`](innofluid-labv1.test.ts) | Driver against the simulator (mode set on connect, busy pump), every rule |

## Choices, and why

- **Working mode Transferring on every connect** (`W1020=0`). In the pump's dispensing modes it starts, stops and
  pauses on its own, which Dispensed (rate × time) cannot follow. *Transfer mode* stops it if the mode is changed on
  the keypad while it runs.
- **Flow setpoint in mL/min** (1004). The pump uses its head, tubing and its own calibration (Test/CAL on the pump),
  so calibrate on the pump; the app reads back the speed it chose (1002).
- **Flow 0.01–645 mL/min** on the card (EasyPump III per the quote; the register sheet says 0.1 minimum — bench).
- **Dispensed errs high, never low**, as for the ST-HandyPump (`pumpVolume`, shared).
- **Running is read** (1008) every poll; *Run reading* stops the pump if that stays missing.
- **The pump answers "busy" in its menus**; the card shows *it only takes commands on its main screen*.
- **Not used yet:** direction and full-speed writes, dosing by volume on the pump (1015, would keep dosing safe if
  the Pi fails — a good next step), calibration registers 2001–2006.

## Safety rules

| Rule | Trips when | Default | Turns off |
| --- | --- | --- | --- |
| Run reading *(always on)* | no run report for 10 s while switched on | 10 s | the pump |
| Transfer mode | the pump is running in a dispensing mode (1020 ≠ 0) | on | the pump |
| Volume limit | Dispensed reaches the maximum | off (10 mL) | the pump |
| Dose only while stirring *(with stirrer)* | pumping while nothing on the page stirs, for N s | 5 s | the pump |

## Still to check on the bench

See [`notes.md`](../../../docs/manuals/innofluid-labv1/notes.md).
