# Ismatec Reglo ICC — notes

**Manual:** `Reglo_ICC_operating_manual_14-036-E_revC.pdf` — Cole-Parmer/Ismatec 14-036-E, rev. C, English, 36 pages.
**Source:** https://github.com/numat/ismatec/raw/master/doc/14-036-e-ismatec-reglo-icc-english-revc.pdf (copy kept by the numat `ismatec` Python driver)
**SHA-256:** `c54f492a7ffee366d98f4f8d3d25b989614ecc51ad89e59a1d207420d5719536`
**Module:** [`src/modules/reglo-icc/`](../../../src/modules/reglo-icc/)
**Our unit:** 4 channels, 12 rollers, Fisher NC0916780 (Masterflex MFLX7800182). Ordered; not yet on the bench.
**Manual reviewed in full:** 2026-10-28 (every page; protocol p. 17–33 command by command against the module).

## Key facts

| Topic | Fact | Page |
| --- | --- | --- |
| Interfaces | USB 2.0 Mini-B (virtual COM port), RS-232 in/out (DB9, daisy chain) | 6, 17 |
| Serial format | 9600 baud, 8 data bits, no parity, 1 stop bit, no flow control | 17 |
| Line end | Commands end with CR (CR LF also accepted) | 17 |
| Addressing, USB | The address character is always the **channel** (1–4). Per-pump commands ignore it but it must be there; the manual recommends `0` as the placeholder | 18, 21 |
| Addressing, RS-232 | By default the address is the **pump** address (1–8, default 1) and `1H` starts channel 1 **on every pump in the chain**; `2H` "all channels start" in the example after channel control is turned off. `<pump>~1` turns on per-channel control, after which the address is the channel. The app sends `1~1` on every connect | 17 |
| Replies | `*` done, `#` not done, `+`/`-` yes/no (meaning depends on the command). One character, **no line end**. Data replies: values separated by spaces, end CR LF | 20 |
| Event messages | Unrequested lines starting `^` (caret, 0x5E — the manual misprints it as 0x53), fields separated by `\|`. Off by default (`0xE` → `0`, p. 27); the app sends `1xE0` | 25–27, 33 |
| Rate format (set) | Volume Type 2: `mmmm±e`, decimal point after the first digit, no `E`. `1f1300-3` = 0.0013 mL/min = 1.3 µL/min. The pump echoes the value as Volume Type 1 | 22, 28 |
| Rate format (read) | Volume Type 1: `mmmmE±e`. `4f` → `3250E+1` = 32.5 mL/min | 19, 28 |
| Flow range | 0.0002–35 mL/min, 0.1–100 rpm in 0.01 rpm steps (p. 15). p. 6 says "up to 43 mL/min": the manual disagrees with itself | 6, 15 |
| Tubing chart | Max flow per tubing ID at 100 rpm — **for an 8-roller head** (3.17 mm → 35 mL/min, 1.02 mm → 6.3). **Ours has 12 rollers**, which moves less per turn, so these maxima are too high for us; read the real one per channel with `n?` | 16 |
| Tubing ID | The pump converts mL/min to rpm with the tubing ID set per channel (keypad or `n+`). A wrong setting makes every flow wrong by roughly (actual ID / set ID)² | 11, 23, 29 |
| Keypad Run/Stop | Starts or stops **all channels** at once; in a timed or repeating mode it pauses instead | 8 |
| Remote mode | The screen shows "Remote Mode" while a PC controls the pump over USB. Whether the keypad still works then is not stated | 13 |
| Over-temperature | Pump stops itself ("Temperature Alarm"); switch off, find the cause, let it cool | 13 |
| Overload | The power supply cuts out on excess current: the pump powers down (the USB link goes with it). Check pressure before restarting | 6, 13 |
| Pressure | Max 1.0 bar differential, continuous | 13, 15 |
| Safety | Not for use with flammable gases or fumes present, nor in explosion-proof enclosures; tubing can burst — use a collecting basin for corrosive media; switch off before changing tubing | 5 |
| Cassette material | POM-C: organic solvents and strong bases, not strong acids/oxidisers. PVDF: acids, aliphatic/aromatic/chlorinated solvents, not esters, ketones, amines, strong bases | 14 |

## Commands

What the module sends, checked against the manual on 2026-10-28.

| Command | Function (manual, ref #) | Reply | Used by app | Status |
| --- | --- | --- | --- | --- |
| `1#` | Model, software version, pump head code (6.22) | `<model text> <version> <head code>`; head code = channels (2 digits) + rollers (2 digits) | identify (matches "REGLO") | manual |
| `1~1` | Per-channel control on (1.2) | `*` | connect, first | manual |
| `1xE0` | Event messages off (1.4) | `*` | connect | manual |
| `nM` | Flow rate mode (3.3) | `*` | connect, each channel | manual |
| `nf<v2>` | Set flow rate, mL/min, Volume Type 2 (3.14) | echo, Volume Type 1 | setpoint | manual |
| `nf` | Get flow rate setting, mL/min (3.13) | Volume Type 1 | read-back each poll | manual |
| `nH` | Start channel (2.1) | `*`, or `-` = settings not achievable | Pump switch on | manual |
| `nI` | Stop channel (2.2) | `*` | switch off, Stop all, safety stop | manual |
| `1E` | Is the pump running (6.21) | `+` / `-` | poll; two `-` in a row mark every channel off | manual — **per pump or per channel? (Q1)** |
| `n+` | Tubing ID (4.1) | `3.17 mm` | poll every 10 s | manual |
| `n?` | Max flow achievable with current settings, mL/min (3.23) | "Text" — format not shown | poll every 10 s; caps the flow setpoint (added 2026-10-28) | manual — **check the reply (Q3)** |
| `nxD` | Get direction (2.4) | `J` (CW) or `K` (CCW) | poll every 10 s, recorded (added 2026-10-28) | manual |
| `1A` | Control back to the pump keypad (6.17) | `*` | remove from page | manual |
| `nxe` | Why a start got `-` (2.7) | `C` cycle count 0 · `R <max>` flow 0 or above max · `V <max>` volume above max | bench terminal | manual |

Status: `manual` = documented, untested · `bench ✓ <date>, fw <version>` = tried on our unit · `differs` = behaves differently; explain.

### Checked and correct
- Serial settings, CR line end, one-character status replies without a line end, data replies with CR LF (p. 17, 20).
- Volume Type 2 writer and Volume Type 1 reader match every example in the manual (p. 28, 30).
- `n+` reply `3.17 mm` parses as 3.17 (p. 29).
- `nH` → `-` is reported with the manual's meaning and points to `nxe` (p. 22).
- `1A` hands control back (p. 24). `1B` (disable the pump's own keys) is **deliberately not used**: it may also disable the Run/Stop key, the only stop at the pump.

### Corrected on 2026-10-28
- **Max flow.** The setpoint maximum was a fixed 35 mL/min from the 8-roller chart. The pump's own maximum per channel (`n?`) now caps it when known.
- **Earlier notes said "every command gets `#` while overloaded".** The manual does not say that: an overload powers the pump down (p. 13). Removed.
- **Direction** is now read and recorded per channel (it was never read). A reversed channel pulls reaction mixture back into the reagent bottle.
- **Simulator** answers `1#` with a 4-channel 12-roller head code (`0412`) and `nxB` with 12.

## Questions (answer on the bench — plan below)

- [ ] **Q1 `1E` scope.** With per-channel control on, does `1E` report the whole pump or only channel 1? If only channel 1, the app would mark a running channel 2 as off after two polls: Flow and Dispensed would stop counting and *Dose only while stirring* would stop guarding it. **Most important question.**
- [ ] **Q2 Identify.** Exact `1#` reply on our unit (model text, version, head code `0412`?).
- [ ] **Q3 `n?` reply.** Exact text (e.g. `22.17 ml/min`?) and value per tubing on our 12-roller head; does it follow `n+` at once? Does `n!` (with calibration) differ?
- [ ] **Q4 Flow above max.** `nf` above the tubing's maximum: refused (`#`), clamped (echo shows the clamped value), or accepted (then `nH` → `-`)?
- [ ] **Q5 Keypad in remote mode.** After the app connects, do the pump's keys still work? Is Run/Stop seen by `1E` within one poll?
- [ ] **Q6 `nM` while running.** Does setting flow mode stop a channel already running from the keypad?
- [ ] **Q7 RS-232 vs USB.** We plan USB. Does `1~1` on USB reply `*`? (On USB it should not be needed.)
- [ ] **Q8 Address 0.** Do per-pump commands work with address `0` (`0#`, `0E`) as the manual recommends? Do any of them depend on the address?
- [ ] **Q9 Release.** After `1A`, does the screen leave "Remote Mode" and the keypad work?
- [ ] **Q10 Direction from the app.** Keep direction a keypad setting (today), or set it per channel with `nJ` / `nK`?

## Possible features

Found in this manual, not used yet. Confidence: all are documented here (`Ismatec doc`) but untested.

| Feature | Commands | Why it matters | Confidence |
| --- | --- | --- | --- |
| **Pump's own dispensed volume** | `n:` (6.40): total since last reset, decimals + units (µL/mL/L); `nxG` (6.15): whole mL only | Uses the pump's calibration; would replace the app's rate × time estimate (Dispensed = reading now − reading at connect). Reset only from the keypad (STATUS → Total volume) | Ismatec doc (6.40 per channel? check) |
| **Per-channel status events** | `1xE1`, then `^U<ch>\|<A pumping, B paused, C stopped…>\|<time left s>\|<µL dispensed>\|<cycles>` periodically | Per-channel running state (answers Q1 for good), keypad starts, dispensed µL in a timed/volume run | Ismatec doc. Needs the transport to route `^` lines away from replies; a `^` line arriving right after a `*` would otherwise be read as part of the reply |
| **Why a channel stopped** | `^X<ch>\|<cause>`: A done, B calibration done, 1 Stop key, 2 over-temperature, 3 over-current | Log "stopped on the pump (Stop key)" vs "over-temperature" | Ismatec doc (same caveat) |
| **Dose in Volume mode** | `nO` (volume at rate), `nv<v2>` volume, `nf<v2>` rate, `nH`; ends by itself with `^X<ch>\|A` | The pump stops at the volume even if the Pi or browser dies (DESIGN §11, method decision D54) | Ismatec doc |
| **Calibration from the app** | `nxU` target volume, `nxW` time, `nxY` start, `nxV` measured volume, `nxX` time since calibration, `nr` roller step volume | Guided calibration per channel; record calibration age in the run | Ismatec doc |
| **Roller count** | `nxB` (get), `)` head code | Check the 12-roller head is configured (it decides mL per turn) | Ismatec doc |
| **Firmware / serial number** | `0(` (e.g. `0114` = 1.14), `0xS` | Device identity in the reaction package (DESIGN §3 Planned) | Ismatec doc |
| **Display name** | `0xN<text>` (< 17 chars) | Show "Reactor Control" or the station name on the pump while remote | Ismatec doc |
| **Backsteps** | `n%` | Drip-free stop at the end of a dose | Ismatec doc |

## Bench plan (when the pump arrives)

Use the app's **bench terminal** (card menu ⋯ → Bench terminal) with the pump connected over USB. Fill tubing with water, outlets into a beaker. Write each exact reply in the bench log below.

1. **Identify:** `1#`, `0(`, `1xA`, `1xB`, `1~`, `0xE`. Expect a REGLO model text, the firmware, 4 channels, 12 rollers, `1`, `0`. (Q2, Q7)
2. **Tubing and maximum:** for each channel `n+` and `n?`; change the tubing ID on the keypad and repeat `n?`; try `n!`. (Q3)
3. **Q1, the important one.** Set ch 2 to 1 mL/min, start **only ch 2** (`2f1000+0`, `2H`). Send `1E`, `2E`, `0E`. Then stop ch 2 and start only ch 1; repeat. If `1E` says `-` with only ch 2 running, the driver must change before any real dosing (see DESIGN §14).
4. **Keypad:** with the app connected, press Run/Stop on the pump. Does it act? Within how many polls does the card show it off? Start from the keypad: does *Dose only while stirring* see it (stirrer on the page, stirrer off)? (Q5)
5. **Above max:** on the thinnest tubing, `nf` with twice `n?`. Note the reply; then `nH` and `nxe`. (Q4)
6. **Mode change while running:** start ch 1 from the keypad, then send `1M`. Still running? (Q6)
7. **Direction:** `1xD`; change it on the keypad; `1xD` again (J/K). (Q10)
8. **Flow accuracy:** ch 1 at 2 mL/min for 5 min into a tared beaker on a balance; compare with the card's Dispensed. Calibrate on the keypad (p. 11), repeat. Note the error before and after.
9. **Pump's own volume:** `1:` and `1xG` before and after step 8. Does `1:` give the volume with decimals and units? Per channel? (feature list)
10. **Release:** remove the pump from the page; does the screen leave Remote Mode, does the keypad work? (Q9)
11. **Unplug USB while pumping:** the pump keeps pumping (documented in DESIGN §4) — confirm, and note what the card shows.
12. **Address 0:** `0#`, `0E`, `0A`. (Q8)

After the bench session: set each command's Status above, answer the questions, and update the module (README, simulator replies, MAX_FLOW) in the same commit.

## Bench log

_Add dated entries: date, firmware, command, exact reply, conclusion._
