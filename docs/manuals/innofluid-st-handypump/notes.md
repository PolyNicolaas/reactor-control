# Innofluid ST-HandyPump — notes

**Protocol sheet:** `Standard_RS485_Modbus_Communication_Protocol.pdf` — Innofluid Co., Ltd., "Standard MODBUS Communication Protocol", English, 5 pages, undated. Supplied by Nicolaas with the pump enquiry (2026-11-06); **check** with Elexan that this is the sheet for the ST-HandyPump (it names no model).
**SHA-256:** `eea37ad839130bec1e9e3ab2cbe0f899da79cba1fde3d78bdcbc8796414b7643`
**Datasheet:** ST-HandyPump, Drifton A/S, 2023 — <https://www.drifton.eu/shop/8-basic-peristaltic-pumps/2569-st-handypump-peristaltic-pump/> (the PDF has no text layer; specs below are from the product page)
**Also received, not used:** `RS232_Communication_Command_Instruction_for_N_series.pdf` (Innofluid N series RS-232 character commands), SHA-256 `20d9ce53da34e6af7fe92e3a1c5e2ca24fdfd29d6c4006669f7a08450dceec48`. Not used: toggle commands (`q`, `h`), no acknowledgements, a status line pushed every second, one pump per port. The module uses RS-485 Modbus instead (D60).
**Module:** [`src/modules/innofluid-st-handypump/`](../../../src/modules/innofluid-st-handypump/)
**Wiring and adapter:** [`src/modules/shared/innofluid/RS485-ADAPTER.md`](../../../src/modules/shared/innofluid/RS485-ADAPTER.md)
**Our units:** 2 × ST-HandyPump with HandyPump01 heads, Elexan Scientific quote 2611051v1 (2026-11-05), lead time 3–4 weeks. Not on the bench yet.

## Key facts

| Topic | Fact | Source |
| --- | --- | --- |
| Drive | 57 closed-loop stepper; 0.1–300 rpm, 0.1 rpm steps (the product page's meta text says 350) | datasheet |
| Head | HandyPump01: 1 channel, 3 or 6 rollers | datasheet |
| Flow | 0.0033–365.69 mL/min per channel (water); 13# tubing 0.0033–10.03, 25# 0.1219–365.69 mL/min | datasheet, quote |
| Power | 100–240 V AC in, 24 V / 1.25 A adapter, < 75 W | datasheet |
| Interfaces | RS-485 and RS-232; analog 0–5 V / 4–20 mA (0–10 V option) | datasheet |
| Protocol | Modbus RTU | sheet p. 1 |
| Serial format | 9600 baud; 1 start, 8 data, 1 **even** parity, 1 stop bit; LSB first | sheet p. 1 |
| Address | 1–32; 0 = broadcast | sheet p. 1 |
| Function codes | 03 read holding registers, 06 write one register, 10 write a long/float (two registers) | sheet p. 1 |
| CRC | CRC-16, polynomial X¹⁶+X¹⁵+X²+1 (0xA001 reflected), init FFFF, low byte sent first | sheet p. 1, 4–5 |
| Integers | high byte first (1234H → 12 34) | sheet p. 1–2 |
| Floats | IEEE 754, **most significant byte first**: 8.9 → 41 0E 66 66; 58.8 → 42 6B 33 33. The float table on p. 3 labels the bytes "L1 L2 H1 H2", but both worked examples are big-endian; the module follows the examples | sheet p. 2, 3–4 |
| Framing | ≥ 3.5 character times of silence between frames; > 1.5 character gap inside a frame = frame discarded | sheet p. 2 |
| Bad address / bad CRC | No reply at all; the master needs a timeout | sheet p. 2 |
| Exceptions | function + 80H, then 01 illegal function, 02 illegal data address, 03 illegal data value, 06 pump busy | sheet p. 2–3 |
| Pump-side pins | Not documented. **check** on arrival (adapter guide, "The pump end") | — |

## Registers

| Register (dec / hex) | Name | Values | Type | Used by app | Status |
| --- | --- | --- | --- | --- | --- |
| 1000 / 03E8 | Start/stop | 1 start, 0 stop | uint16 | switch **Pump** (`W1000=1`/`=0`), Stop all; read every poll as **running** (`R1000`) | write: manual; **read: not in the sheet — check** |
| 1001 / 03E9 | Direction | 1 clockwise, 0 counter-clockwise | uint16 | read every 10 polls (`R1001`), recorded; identify read on connect; **never written** | read: **check** |
| 1002 / 03EA | Run speed | 0.1–600 rpm (drive: 300) | float | setpoint **Speed** (`WF1002=…`), read back (`RF1002`) | write: manual; read: **check** |

Worked examples (p. 3–4), all reproduced by `src/test/modbus.test.ts`: start `01 06 03 E8 00 01 C8 7A`; stop
`01 06 03 E8 00 00 09 BA`; clockwise `01 06 03 E9 00 01 99 BA`; 58.8 rpm `01 10 03 EA 00 02 04 42 6B 33 33 58 29`, echo
`01 10 03 EA 00 02 60 78`.

## How the app drives it (why)

- **No tubing or flow registers** in this sheet, so the pump only knows rpm. The app shows Flow = speed × **mL per
  revolution**, a setting on the *Volume limit* rule (default 1.22 mL/rev = 25# tubing at its datasheet maximum, so
  Dispensed reads high on smaller tubing and the limit stops early). Calibrate per tubing: 60 s at 100 rpm, weigh,
  mL ÷ 100.
- **Running is read, not assumed.** Every rule uses register 1000's reply as well as the card's switch. If the pump
  cannot be read (the sheet only shows writes), *Run reading* stops the pump after 10 s with it switched on —
  i.e. the module is not usable until the reads work. This is the first bench check.
- **Direction is never written**: set it on the pump so the reagent goes into the reactor.

## Bench checks

- [ ] Pump-side connector, pins for A+, B−, ground; note them here and in the adapter guide.
- [ ] Settings menu: RS485/RS232 choice, baud, Slave No., communication on — and whether the pump only answers on its main screen (the LabV does).
- [ ] `R1001`, `R1000`, `RF1002` answer (function 03 on these registers). **If not, the module needs another way to see "running" (D60).**
- [ ] Even parity works; if nothing answers with correct wiring, try 8N1 and note it.
- [ ] `R1000` turns `1` after Start on the keypad and `0` after Stop; how fast.
- [ ] Speed written above 300 rpm: exception 03 or clamped?
- [ ] Do address and speed survive a power cycle?
- [ ] Does broadcast (address 0) `W1000=0` stop both HandyPumps? (Not used by the app; useful to know.)
- [ ] mL per revolution for the tubing we fit, each pump.

## Questions

- [ ] Is the "Standard MODBUS" sheet really the ST-HandyPump's map, or does the HandyPump use the Lab V map (start at 1008)? Ask Elexan; the bench `R1008` answers it too (exception 02 = no such register).

## Bench log

_Add dated entries: date, firmware, command, exact reply, conclusion._
