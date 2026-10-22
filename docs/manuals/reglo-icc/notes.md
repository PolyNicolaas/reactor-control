# Ismatec Reglo ICC — notes

**Manual:** `Reglo_ICC_operating_manual_14-036-E_revC.pdf` — Cole-Parmer/Ismatec 14-036-E, rev. C, English, 36 pages.
**Source:** https://github.com/numat/ismatec/raw/master/doc/14-036-e-ismatec-reglo-icc-english-revc.pdf (copy kept by the numat `ismatec` Python driver)
**SHA-256:** `c54f492a7ffee366d98f4f8d3d25b989614ecc51ad89e59a1d207420d5719536`
**Driver:** [`src/devices/regloIcc.ts`](../../../src/devices/regloIcc.ts)
**Our unit:** 4 channels, 12 rollers, Fisher NC0916780 (Masterflex MFLX7800182).

## Key facts

| Topic | Fact | Page |
| --- | --- | --- |
| Interfaces | USB 2.0 Mini-B (virtual COM port), RS-232 in/out (DB9, daisy chain) | 6, 17 |
| Serial format | 9600 baud, 8 data bits, no parity, 1 stop bit, no flow control | 17 |
| Line end | Commands end with CR (CR LF also accepted) | 17 |
| Addressing | First character is the address. With channel addressing on (`~1`) it is the channel (1–4). Pump-wide commands ignore it but it must be present | 17, 21 |
| Danger | Without channel addressing on RS-232, `2H` starts **all** channels. The app sends `1~1` on every connect | 17 |
| Replies | `*` done, `#` refused (every command gets `#` while overloaded), `+`/`-` yes/no. One character, **no line end**. Data replies end CR LF | 20 |
| Rate format (set) | Volume Type 2: `mmmm±e`, decimal after the first digit. `1f1300-3` = 0.0013 mL/min | 28 |
| Rate format (read) | Volume Type 1: `mmmmE±e`. `3250E+1` = 32.5 mL/min | 19, 28 |
| Flow range | 0.0002–35 mL/min; max per tubing ID in the chart (3.17 mm → 35 mL/min, 1.02 mm → 6.3) | 15–16 |
| Overload | Power supply cuts out on excess current; check pressure before restarting | 13 |

## Commands

| Command | Function (manual) | Used by app | Status |
| --- | --- | --- | --- |
| `1#` | Model, software version, head code | identify | manual |
| `1~1` | Channel addressing on | connect | manual |
| `1xE0` | Event messages off | connect | manual |
| `nM` | Flow rate mode | connect | manual |
| `nf` / `nf<v2>` | Read / set flow (mL/min) | setpoint, poll | manual |
| `nH` / `nI` | Start / stop channel | switch, Stop all | manual |
| `1E` | Anything running? `+`/`-` | poll (catches keypad stops) | manual |
| `n+` | Tubing ID, reply `3.17 mm` | poll every 10 s | manual |
| `1A` | Control back to the pump keypad | remove from page | manual |
| `nxe` | Why a start was refused | bench terminal | manual |
| `n?` | Max flow with current tubing | bench terminal | manual |

Status: `manual` = documented, untested · `bench ✓ <date>, fw <version>` = tried on our unit · `differs` = behaves differently; explain.

## Questions

- [ ] Exact `1#` reply on our unit (driver matches "REGLO").
- [ ] Does `nM` stop a channel that is running from the keypad?
- [ ] Reply to a flow set: the manual shows the echoed value (`1300E-3`); the app accepts anything that is not `#`/`-`.
- [ ] Is "Run/Stop" on the keypad reported by `1E` straight away?
- [ ] Set direction per channel from the app (`nJ`/`nK`), or keep it a keypad setting?

## Bench log

_Add dated entries: date, firmware, command, exact reply, conclusion._
