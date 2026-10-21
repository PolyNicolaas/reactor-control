# EUROSTAR 60 control — notes

**Manual:** `EUROSTAR_60-100_control_operating_instructions_20000003965c.pdf` — IKA operating instructions 20000003965c, EUROSTAR 60 control / 100 control, 03/2018, EN, 21 pages.
**Source:** https://cdn.abicart.com/shop/ws72/72372/art14/156950114-5574d5-20000003965c_EN_EUROSTAR_60_100_control_032018_web.pdf
**SHA-256:** `92d67aad98e480845f60ca9dcd26f13192530eb1bea18d26cc4e1b8cc4862d2d`
**Driver:** [`src/devices/eurostar60.ts`](../../../src/devices/eurostar60.ts)

## Key facts

| Topic | Fact | Page |
| --- | --- | --- |
| Speed range | 0 / 30–2000 rpm (EUROSTAR 60 control) | p. 3, 20 |
| Interfaces | RS 232 (9-pin SUB-D) and USB at the rear of the stirrer; the Wireless Controller (WiCo) also has a USB port on its right side that can be used for remote control | p. 17 |
| USB connector | USB micro B on the stirrer | p. 17 |
| In the box | USB cable A – micro B 2.0 (stirrer → PC/Pi) and USB cable micro A – micro B 2.0 | p. 6 |
| RS 232 cable | PC 1.1 cable (station to PC); pins 2 RxD, 3 TxD, 5 GND, 7 RTS, 8 CTS | p. 17 |
| Serial format | 9600 bit/s, 1 start, 7 data, even parity, 1 stop; no flow control | p. 17 |
| Line end | Commands and replies end with **blank CR LF** (hex 20 0D 20 0A); max 80 characters | p. 17 |
| Who talks | The stirrer only answers; it never sends errors on its own | p. 17 |
| Decimal | Dot | p. 17 |

## Commands

| Command | Function (manual) | Used by app | Status |
| --- | --- | --- | --- |
| `IN_NAME` | Read device name | Identify on connect | manual |
| `IN_PV_3` | Read PT1000 value | Probe reading | manual |
| `IN_PV_4` | Read current speed | Speed reading | manual |
| `IN_PV_5` | Read current torque | Torque reading | manual |
| `IN_SP_4` | Read rated (set) speed | Setpoint read-back | manual |
| `IN_SP_5` | Read torque limit | — | manual |
| `IN_SP_6` | Read speed limit | — | manual |
| `IN_SP_8` | Read safety speed | — | manual |
| `OUT_SP_4 n` | Set speed | Speed setpoint | manual |
| `OUT_SP_5 n` | Set torque limit | — | manual |
| `OUT_SP_6 n` | Set speed limit | — | manual |
| `OUT_SP_8 n` | Set safety speed | — | manual |
| `START_4` | Start motor | Motor switch | manual |
| `STOP_4` | Stop motor | Motor switch, Stop all | manual |
| `RESET` | Switch to normal operating mode | Sent when removed from the page | manual |
| `OUT_MODE_n` (n = 1, 2) | Change direction of rotation | — | manual |
| `IN_MODE` | Read direction of rotation | — | manual |

No watchdog command is listed for this model, so a crashed browser does not stop the motor on its own. The app should stop it explicitly, and a reaction program's end action should include `STOP_4`.

## Questions

- [ ] Does the unit accept plain CR LF as well as the documented blank CR LF? (The driver sends blank CR LF to match the manual.)
- [ ] Exact reply format of `IN_PV_4` and `IN_NAME` on our unit.
- [ ] Is the torque value (`IN_PV_5`) in Ncm, and is it a trend or absolute?
- [ ] Does `RESET` stop the motor, or only hand control back to the front panel?

## Bench log

_Add dated entries: date, firmware (`IN_SOFTWARE` reply), command, exact reply, conclusion._
