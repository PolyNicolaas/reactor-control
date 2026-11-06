# Innofluid LabV1-III — notes

**Protocol:** `Lab-V-Series-MODBUS-Protocol.pdf` — Innofluid / Baoding Shenchen, "Lab V Series MODBUS Protocol", English. Source: <https://darwin-microfluidics.com/content/pdfs/Lab-V-Series-MODBUS-Protocol.pdf> (read 2026-11-06 through the distributor's site; not downloaded, hash to add)
**Manual:** `LabV-Series-Manual.pdf` — LabV Series user manual. Source: <https://darwin-microfluidics.com/content/pdfs/LabV-Series-Manual.pdf> (read 2026-11-06; hash to add)
**Worked frames:** Darwin Microfluidics, "How to control a LabV pump using the Modbus protocol" — <https://blog.darwin-microfluidics.com/how-to-control-a-labv-pump-using-the-modbus-protocol/>
**Product page:** <https://darwin-microfluidics.com/products/labv1-iii-intelligent-flow-rate-peristaltic-pump>
**Module:** [`src/modules/innofluid-labv1/`](../../../src/modules/innofluid-labv1/)
**Wiring and adapter:** [`src/modules/shared/innofluid/RS485-ADAPTER.md`](../../../src/modules/shared/innofluid/RS485-ADAPTER.md)
**Our unit:** 1 × LabV1-EP3 (LabV1 dispensing pump with EasyPump III head, 0.0053–645 mL/min), Elexan quote 2611051v1 (2026-11-05). Not on the bench yet.

## Key facts

| Topic | Fact | Source |
| --- | --- | --- |
| Drive | 0.1–150 rpm; up to 4 heads per drive | product page |
| Head | EasyPump III: single channel, adjustable occlusion, 1.6 mm wall tubing (25# supplied) | product page |
| Flow | 0.0053–645 mL/min with EasyPump III (quote); drive spec 5.3 µL/min–775 mL/min | quote, product page |
| Interfaces | RS-232 and RS-485, both Modbus RTU; analog 0–5 V/0–10 V/4–20 mA; start/stop and direction inputs; open-collector **motor running** output (OUT1/OUT2) | manual, product page |
| Rear terminals, RS-485 | **A+**, **B−**, **GD1** (signal ground). Pin numbers not given | manual (external control), Darwin article |
| Settings | Communication screen: RS232 or RS485; baud 1200/2400/4800/9600; Slave No. 1–32; communication ON/OFF | manual, Darwin article |
| Main screen only | "The pump only receives communication control when in the main interface"; other screens ignore or answer busy | manual, protocol |
| Serial format | 8 data, 1 parity, 1 stop. The protocol does not name the parity; Darwin's code uses **even** | protocol, Darwin article |
| Function codes | 03, 06, 10 (and 02, 05 listed); "only one register per order" | protocol |
| Byte order | integers and floats most significant byte first | protocol |
| CRC | as the ST-HandyPump: 0xA001, init FFFF, low byte first | protocol |
| Exceptions | 01, 02, 03, 06 (busy) | protocol |
| Working modes | Flow rate mode, speed mode; Fixed volume; Fixed time and volume (dispensing); timer start/stop | manual |
| Calibration | On the pump: Test (default 60 s), enter actual volume, repeat ≥ 3×, CAL; Add/Dec fine tune; Reset | manual |
| Power | 100–240 V AC (110 V option), < 80 W for the -III drives; grounded outlet | manual |
| External plugs | Connect or disconnect external control plugs only with the pump off | manual |

## Registers

| Register (dec / hex) | Name | Values | Type | Used by app | Status |
| --- | --- | --- | --- | --- | --- |
| 1000 / 03E8 | Pump head | code (Chart 1) | uint16 | read every 10 polls, recorded | manual |
| 1001 / 03E9 | Tubing size | code (Chart 1) | uint16 | read every 10 polls, recorded; identify read on connect | manual |
| 1002 / 03EA | Motor speed | 0.1–600 rpm (drive 150) | float | read every 2 polls as **Pump speed** | manual |
| 1004 / 03EC | Flow rate | 0.1–99999 (mL/min per Darwin's example) | float | setpoint **Flow** (`WF1004=…`), read back (`RF1004`) | manual; units **check** |
| 1007 / 03EF | Back suction angle | 0–360° | uint16 | — | manual |
| 1008 / 03F0 | Start/stop | 1 start, 0 stop | uint16 | switch **Pump**, Stop all; read every poll as **running** | manual |
| 1009 / 03F1 | Direction | 1 CW, 0 CCW | uint16 | read every 10 polls, recorded; never written | manual |
| 1010 / 03F2 | Full speed run | 1 start, 0 stop | uint16 | — (priming; maybe later) | manual |
| 1015 / 03F7 | Set flow volume | 0–99999 mL | float | — (see Possible features) | manual |
| 1018 / 03FA | Working time | 0.1–9999 s | float | — | manual |
| 1020 / 03FC | Working mode | 0 transferring, 1 fixed volume, 2 fixed time and volume | uint16 | **set to 0 on connect**; read every 5 polls (*Transfer mode* rule) | manual |
| 1021 / 03FD | Pause time | 0.1–9999 s | float | — | manual |
| 1023 / 03FF | Copy numbers | 0–9999, 0 = infinite | uint16 | — | manual |
| 2001–2006 | Calibration: test time, start test, actual volume, restore defaults, micro adjust | | | — (calibrate on the pump) | manual |

Darwin's frames, reproduced by `src/test/modbus.test.ts`: start `01 06 03 F0 00 01 48 7D`, stop `01 06 03 F0 00 00 89 BD`,
CW `01 06 03 F1 00 01 19 BD`, flow 50.0 `01 10 03 EC 00 02 04 42 48 00 00 7D 2C`. Errors in that article: its speed
example `41 A0 00 07` is not 20.0 (that is `41 A0 00 00`), and its `set_flow_volume` writes 1011 instead of 1015.

## How the app drives it (why)

- **Transferring mode on connect** (`W1020=0`): Dispensed and the volume limit assume the pump runs until stopped.
  The *Transfer mode* rule stops the pump if the mode is changed on the keypad while it runs.
- **Flow in mL/min**; the pump turns it into rpm with its own head, tubing and calibration (calibrate on the pump).
  The speed it chose is read back so a run shows it.
- **Running is read** (1008) every poll; every rule uses it, and *Run reading* stops the pump if it stays missing.
- **Direction and full speed are not written.**

## Bench checks

- [ ] Rear connector type and pins for A+, B−, GD1; note here and in the adapter guide.
- [ ] Even parity; registers readable with 03 (`R1001`, `R1008`, `RF1004`, `RF1002`, `R1020`).
- [ ] Does writing 1004 work in the pump's speed mode, or must the pump be in flow-rate mode? Flow units mL/min?
- [ ] Lowest flow the register accepts (the sheet says 0.1; the head goes to 0.0053 mL/min). The card's minimum is 0.01.
- [ ] `R1008` turns `1`/`0` with the keypad; what it reads during a Fixed volume program's pause.
- [ ] Which head and tubing codes the EasyPump III and our tubing show in 1000/1001.
- [ ] Busy reply (06) when a menu is open; does the pump also refuse reads then?

## Possible features

| Feature | What it does | Source | Confidence |
| --- | --- | --- | --- |
| Dose by volume on the pump | 1020 = 1, 1015 = volume: the pump stops itself at the volume, even if the Pi fails (DESIGN §10 item 9) | protocol | manual |
| Full-speed prime | 1010 = 1 / 0 | protocol | manual |
| Calibration from the app | 2001–2006 | protocol | manual |
| Running output | OUT1/OUT2 open collector, hardware "motor running" signal | manual | manual |

## Bench log

_Add dated entries: date, firmware, command, exact reply, conclusion._
