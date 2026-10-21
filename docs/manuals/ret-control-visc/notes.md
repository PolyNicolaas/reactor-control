# RET control-visc — notes

**Manual:** `RET_control-visc_operating_instructions_20000004159.pdf` — IKA operating instructions 20000004159, RET control-visc, 04/2019, multilingual (DE p. 4, **EN p. 20–37**), 136 pages.
**Source:** https://assets.wolflabs.co.uk/AssetsStore/IKA_hotplates_RET-Control-Visc_manual.pdf
**SHA-256:** `1e1606aeb1921599d8b60672cba583c1bbe40f58ca44b63fa7744ff9d177219b`
**Driver:** [`src/devices/retControlVisc.ts`](../../../src/devices/retControlVisc.ts)

## Key facts

| Topic | Fact | Page |
| --- | --- | --- |
| Interfaces | RS 232 (9-pin) and USB; USB appears as a virtual COM port with the same commands | p. 30–31 |
| USB connector | Micro-USB on the unit; the box includes a USB A – Micro-B cable | retailer listing, p. 22 |
| Serial format | 9600 bit/s, 1 start, 7 data, even parity, 1 stop | p. 31 |
| Flow control | **RS 232: hardware handshake RTS/CTS** (pin 7). Matters only on the RS 232 route; the USB route ignores it | p. 31 |
| Line end | CR LF (hex 0D 0A) | p. 31 |
| RS 232 cable | PC 1.1 cable (9-pin to PC) | p. 32 |
| "Eurostar control" setting | Lets the RET talk directly to a EUROSTAR and stop heating if the EUROSTAR stops or its cable is lost. Keep it **off** when the app controls both units | p. 26 |

## Channel numbers (X in IN_PV_X, IN_SP_X, OUT_SP_X, START_X, STOP_X)

| X | Meaning | Page |
| --- | --- | --- |
| 1 | Medium temperature (external sensor) | p. 31 |
| 2 | Hot plate temperature | p. 31 |
| 3 | Hot plate safety temperature | p. 31 |
| 4 | Speed | p. 31 |
| 5 | Viscosity trend | p. 31 |
| 7 | Heat transfer medium temperature | p. 31 |
| 80 | pH value | p. 31 |
| 90 | Weight value | p. 31 |
| 54 | Error 5 response time, s (180–1200) | p. 31 |
| 55 | Intermittent mode cycle time, s (10–600) | p. 31 |
| 56 | Intermittent mode interruption, s (5–60) | p. 31 |

## Commands

| Command | Function (manual) | Used by app | Status |
| --- | --- | --- | --- |
| `IN_NAME` | Title request | Identify on connect | manual |
| `IN_SOFTWARE` | Software ID, date, version | Bench terminal | manual |
| `IN_TYPE` | Lab device identification | — | manual |
| `IN_PV_X` (1, 2, 3, 4, 5, 7, 80, 90) | Read current value | 1, 2, 3, 4, 5 polled | manual |
| `IN_SP_X` (1, 2, 3, 4, 7, 8, 12, 42, 54, 55, 56) | Read set value | 1 and 4 read back | manual |
| `OUT_SP_X n` (1, 2, 4, 7, 54, 55, 56) | Set target value | 1 (temperature), 4 (speed) | manual |
| `OUT_SP_12@n` | Watchdog safety temperature, echoes value | — (planned) | manual |
| `OUT_SP_42@n` | Watchdog safety speed, echoes value | — (planned) | manual |
| `OUT_WD1@m` | Watchdog mode 1: heating and stirring off (ER 2) if no command within m s (20–1500); echoes m | — (planned) | manual |
| `OUT_WD2@m` | Watchdog mode 2: fall back to safety temperature and speed; `OUT_WD2@0` resets | — (planned) | manual |
| `START_X` (1, 2, 4, 5, 7) | Switch function on (remote) | 1 heater, 4 stirrer | manual |
| `STOP_X` (1, 2, 4, 5, 7) | Switch function off; set values are kept | 1, 4; Stop all | manual |
| `RESET` | **Switches off the device function** | Sent when removed from the page | manual |
| `OUT_NAME name` | Set display name (max 6 characters, default IKARET) | — | manual |

The related RET control manual also lists on-device ramp commands (`RMP_*`) and `STATUS_X`. They are **not** in this control-visc manual's table; check on the bench before relying on them.

## Questions

- [ ] Reply format of `IN_PV_1` on our unit (value only, or value plus channel number?).
- [ ] Does `IN_PV_1` return a sentinel value when no external probe is plugged in?
- [ ] Does `OUT_WD1@m` echo on our firmware, and how long is the reply delay?
- [ ] Does the RET accept `OUT_SP_1` while the heater is off (the app sets first, then starts)?
- [ ] On the RS 232 route (PC 1.1 + adapter), is RTS/CTS flow control needed? The app opens ports with flow control off; the USB route should not care.
- [ ] What range and unit does the viscosity trend (`IN_PV_5`) report?

## Bench log

_Add dated entries: date, firmware (`IN_SOFTWARE` reply), command, exact reply, conclusion._
