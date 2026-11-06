# Innofluid pumps on one RS-485 cable — adapter, wiring and first test

How to connect the Innofluid pumps (ST-HandyPump, LabV1-III) to the station Pi, all on **one USB port**.
Used by both modules: [`innofluid-st-handypump`](../../innofluid-st-handypump/) and [`innofluid-labv1`](../../innofluid-labv1/).

**Status:** written before the pumps arrived (ordered 2026-11-05, 3–4 weeks). Everything marked **check** must be
confirmed on the bench and this file corrected. Facts come from the manuals in
[`docs/manuals/innofluid-st-handypump/notes.md`](../../../../docs/manuals/innofluid-st-handypump/notes.md) and
[`docs/manuals/innofluid-labv1/notes.md`](../../../../docs/manuals/innofluid-labv1/notes.md).

## Can the pumps be daisy-chained?

**Yes.** RS-485 is a bus: one pair of wires (A, B) plus a ground runs past every pump, and the computer talks to
one pump at a time by its **address** (Slave No. 1–32, set on each pump). Both Innofluid models speak the same
Modbus RTU at the same settings (9600 baud, 8 data bits, even parity, 1 stop bit), so the two ST-HandyPumps and the
LabV1 can share one cable and one USB adapter. In the app each pump is its own card; you pick the same port for each
and give each its own address.

What daisy-chaining does **not** do: there is no "group" command for mixed models. The ST-HandyPump starts with
register 1000, the LabV with 1008, so a broadcast to address 0 would mean different things to each. The app
addresses each pump on its own; **Stop all** sends each pump its own stop.

## What you need

| Item | Notes |
| --- | --- |
| USB–RS-485 adapter | One for the whole chain. Either Innofluid's own (route A) or any adapter that meets the list in route B. |
| A cable from each pump to the bus | Innofluid's "Pump to PC RS-485 cable" (route A), or your own (route B). |
| Twisted-pair cable for the bus | Any Cat5e/Cat6 patch cable works: one twisted pair for A/B, one wire of another pair for ground. |
| A way to join wires | Lever terminal blocks (e.g. WAGO 221) or a screw terminal strip. |
| 120 Ω resistor, ¼ W | One or two, for termination (see below). Often built into the adapter. |
| Small screwdriver, wire stripper, multimeter | The multimeter is only needed if the pump's pins are not labelled. |

### Route A — buy Innofluid's parts (simplest)

Innofluid's distributor (Darwin Microfluidics) sells both pieces:

- **RS-232 & RS-485 to USB adapter for Innofluid pumps** — SKU `SE-USB-RS232/485`, about $22:
  <https://us.darwin-microfluidics.com/products/rs-232-rs-485-to-usb-adapter-for-innofluid-pumps/>
- **Pump to PC RS-485 cable for Innofluid pumps** — SKU `SE-WK-G02`, 2 m, about $8 — one per pump:
  <https://us.darwin-microfluidics.com/products/pump-to-pc-rs-485-cable-for-innofluid-pumps/>

**Check** before ordering: the listing does not name the pump models, connector or pinout, and its pictures refer to
Shenchen pumps. Ask Elexan (who quoted the pumps, quote 2611051v1) whether these fit the **ST-HandyPump** and the
**LabV1-III**, or order the cables with the pumps. Each cable is pump-to-PC; to chain three pumps, cut or break out
the PC end of each and join them on a terminal block (wiring below).

### Route B — build your own adapter

Any USB–RS-485 adapter works with the app if it has:

1. **A chip the Pi and Chrome know without drivers:** FTDI FT232R/FT232RNL (best), CH340/CH343 or CP2102.
   On the Pi it shows up as `/dev/ttyUSB0`; in the app's port picker as "USB Serial" or the chip name.
2. **Even parity at 9600 baud** — all of the chips above do it.
3. **Automatic direction control** (the adapter switches between sending and listening by itself). RS-485 is
   half-duplex; Web Serial cannot toggle a direction pin. Adapters sold as "USB to RS485 converter" do this.
4. **Screw terminals marked A (or D+, A+) and B (or D−, B−) and GND.** An adapter without a GND terminal still
   works on a short bench run, but connect ground if you can.
5. Nice to have: a **built-in 120 Ω termination** jumper or switch, and TVS protection.

Good choices are the common FT232-based industrial dongles with A/B/GND screw terminals (Waveshare, DSD TECH and
others sell them for about $10–20). Avoid bare "MAX485 module" boards: they need a microcontroller to drive the
direction pin.

## The pump end

| Pump | RS-485 terminals | Where | Source |
| --- | --- | --- | --- |
| LabV1-III | **A+**, **B−**, **GD1** (RS-485 signal ground) | external control port, rear of the pump | LabV Series manual, external control section; Darwin LabV Modbus article |
| ST-HandyPump | RS-485 is listed; terminals not documented | **check**: rear panel label and the user manual in the box | Drifton/Innofluid datasheet |

The manuals give terminal **names**, not pin numbers on the connector. **Check** on arrival, in this order:

1. The label or print next to the connector on the pump, and the manual in the box.
2. The pin-out of Innofluid's own RS-485 cable if you bought it (route A): open the plug or ask Elexan.
3. If neither tells you: ask Elexan for the external-control pin table for each model. Do not guess pins on the
   external-control connector — it also carries analog inputs and a +5 V output (LabV manual).

Write what you find in the pin table below and in each module's `notes.md`, then delete this paragraph.

| Pump | Connector type | Pin for A+ | Pin for B− | Pin for ground |
| --- | --- | --- | --- | --- |
| LabV1-III | **check** | **check** | **check** | **check** |
| ST-HandyPump | **check** | **check** | **check** | **check** |

> **Unplug and replug the external-control cable only with the pump switched off** (LabV manual).

## Wiring the chain

```
 Pi (Chromium) ── USB ──[ USB–RS-485 adapter ]
                          A   B   GND        (120 Ω across A–B here if the adapter has it)
                          │   │    │
              ┌───────────┴───┴────┴───────────── twisted pair (A/B) + ground, one line ──────────┐
              │                                                                                    │
        [ terminal block 1 ]                    [ terminal block 2 ]                    [ terminal block 3 ]
         │      │      │                         │      │      │                         │      │      │
        A+     B−    GND                        A+     B−    GND                        A+     B−    GND
     ST-HandyPump A (address 1)              ST-HandyPump B (address 2)              LabV1-III (address 3)
                                                                                     120 Ω across A–B at the last pump
```

Rules of thumb (RS-485 at 9600 baud is forgiving; these keep it boring):

- **One line, not a star.** Run the pair from the adapter past each pump in turn. The short pieces from the line to
  each pump (stubs) should be short — under 30 cm is plenty at this speed. On a bench where everything is within
  2 m, three pump cables meeting at one terminal block also works.
- **A to A, B to B, ground to ground** on every pump. Use one twisted pair for A and B.
- **Termination:** a 120 Ω resistor across A and B at each **end** of the line (the adapter and the last pump).
  Under a few metres at 9600 baud it is often not needed; add it if you see checksum errors or missed replies. Never
  more than two on the bus.
- **Ground:** connect the adapter's GND to every pump's RS-485 ground (GD1 on the LabV). It keeps the pumps' and
  the Pi's grounds from drifting apart; it is not a shield — do not connect it to mains earth.
- **Swapped A and B does no harm**: nothing answers. If a pump stays silent, swap its A and B and try again.
  Adapters disagree on naming (some print D+/D−, some swap A/B relative to the pumps), so this is normal.

## Setting up each pump

On each pump's communication settings screen (LabV manual; **check** the HandyPump's menu):

1. Interface: **RS485** (not RS232).
2. Baud rate: **9600**.
3. **Slave No.**: a different number on every pump. Suggested: HandyPump A = **1**, HandyPump B = **2**,
   LabV1-III = **3**. Write it on a label on the pump.
4. Communication: **ON**.
5. Go back to the **main screen**. The LabV only takes commands on its main screen; in a menu it answers "busy"
   (the app shows: *pump busy, it only takes commands on its main screen*).

Parity is not settable on these pumps; the Innofluid sheet and Darwin's example code use **even** parity, which the
app uses. **Check**: if no pump answers at all with correct A/B, note it in `notes.md` — the app would need an
8N1/8N2 fallback.

## Connecting in the app

1. Plug the adapter into the Pi. In the app: **Add device** → model **Innofluid ST-HandyPump** (or **LabV1-III**).
2. Enter the pump's **address** (its Slave No.), a name (e.g. "Reagent A"), **Choose port and connect**, and pick
   the adapter in the browser's list.
3. Repeat for each pump, picking **the same port** each time with that pump's address. The app refuses the same
   address twice on one cable.
4. Each card connects by reading register 1001; "No pump answered at address N" means the address, the pump's
   settings, or A/B (above).

## First bench test (with the bench terminal)

Open each pump's card → **Bench terminal**. The address is added for you. Before anything else is connected:

| Send | Expect | Proves |
| --- | --- | --- |
| `R1001` | a number (HandyPump: direction 0/1; LabV: tubing code) | wiring, address, parity |
| HandyPump `RF1002` / LabV `RF1004` | the speed / flow shown on the pump | float byte order |
| HandyPump `R1000` / LabV `R1008` | `0` | the run register can be **read** (the rules need this) |
| HandyPump `WF1002=10` / LabV `WF1004=1` | `OK`, and the pump's display changes | writes |
| HandyPump `W1000=1` then `W1000=0` / LabV `W1008=1` then `W1008=0` | pump starts, stops | start/stop |
| Press Start on the pump, then `R1000` / `R1008` | `1` | keypad starts are seen |

Then record what happened in each module's `notes.md` (the bench checks listed there).

## Troubleshooting

| What you see | Likely cause |
| --- | --- |
| No pump answers at any address | A/B swapped; pump not on RS485 or communication OFF; wrong baud; adapter needs a driver (check `ls /dev/ttyUSB*` on the Pi) |
| One pump answers, another does not | Its address, its A/B, or its settings; two pumps with the same address answer at once and garble each other |
| "Bad checksum" now and then | Add termination; shorten stubs; connect ground; keep the bus away from the hotplate's mains lead |
| "pump busy" | The pump is in a menu: go back to its main screen |
| "no such register" on `R1000` | The pump does not use the register map the module expects — note the model and firmware in `notes.md` |
| The port is in use | Another tab or app has it open; close it (only one program can own the port) |
