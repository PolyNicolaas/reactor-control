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
| Weighing | Range 10–5000 g; display up to 2000 g; accuracy ±(0.3 % + 2 g); resolution not stated. Only works while heating and stirring are off. 2- or 3-point calibration, 200–5000 g | p. 25, 35 |
| Plate vs probe control | With the external probe connected the RET regulates the **medium** (probe) temperature and drives the plate as hot as needed, up to the hot plate safety temperature (channel 3). A probe outside the medium therefore lets the plate run to the safety limit; the app's interlock (DESIGN D32) guards against this | p. 31 (channels 1–3); user report 2026-10-26 |
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
| `IN_PV_X` (1, 2, 3, 4, 5, 7, 80, 90) | Read current value | 1, 2, 3, 4, 5, 90 (mass) polled | 90: bench ✓ 2026-10-22 — only after the weighing key (G) is pressed and the balance settles; whole grams |
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

## Possible features

Feature review 2026-10-22. Found outside our manual; not used by the app yet. Confidence: **IKA doc** = in an IKA manual · **code** = used in an open-source driver that ran on hardware · **claim** = issue/forum report. "2007 manual" = IKAMAG RET control-visc C, RETCV_0107 (Reg.-No. 4343-01).

| Feature / command | What it does | Source | Confidence |
| --- | --- | --- | --- |
| Remote weighing / tare | **None exists.** No TARE, START_90 or OUT_SP_90 in any manual or driver. Weighing starts only with the G key; the app tares in software | 2019 manual p. 25; numat, Hein drivers | IKA doc |
| `START_X`/`STOP_X` with X = 80, 90 | The 2019 text for these is copied word for word from the 2007 `START_16` ("old watchdog") row. Probably a documentation leftover, not real pH/weight commands. Do not use | [2007 manual](https://www.artisantg.com/info/IKA_RET_ControlVisc_Manual.pdf) vs 2019 manual | IKA doc (our inference) |
| `RMP_START_X`, `RMP_STOP_X`, `RMP_PAUSE_X`, `RMP_CONT_X`, `RMP_RESET_X`, `RMP_IN_X`, `RMP_INX_y`, `RMP_OUT_X_yn` (end value, segment time hh:mm:ss), `RMP_LOOP_SET_X`, `RMP_LOOP_RESET_X` | On-device temperature (X=1) and speed (X=4) ramps; `RMP_START` needs `START_X` first. Would let the RET run ramps itself if the browser dies | 2007 manual | IKA doc (older model; untested on 2019 firmware) |
| `STATUS` | Mode (1S/2S/3S = A/B/C), run state (S0 manual, S1/S2 auto), or a negative error | 2007 manual | IKA doc (older model) |
| Error replies | -83 wrong parity · -84 unknown command · -85 wrong order · -86 invalid setpoint · -87 no memory. Useful: the app can treat -84 as "not supported" | 2007 manual | IKA doc |
| `STATUS_1`, `STATUS_2`, `STATUS_4` | Reply starting `11` = active, `12` = inactive; `STATUS_2` returns `-90 2` (unexplained). Could confirm heater/stirrer state instead of trusting the last command | [numat/ika](https://github.com/numat/ika) | code |
| Reply format | `value channel`, e.g. `25.3 1`; name/type replies as-is. Matches our parser | numat/ika, [Hein group ika](https://gitlab.com/heingroup/ika) | code |
| "Eurostar control" on | The RET then **sends `IN_PV_4` itself** out of the port, which confuses a PC driver. Keep it off (already in Key facts) | 2019 manual; numat/ika | IKA doc + code |
| `SET_MODE_n` (A, B, D) | Operating mode; listed for IKA Plate, C-MAG HS 7, RCT basic, **not** the RET | IKA Plate 11/2018, C-MAG HS 7 11/2018, RCT basic 05/2022 manuals | IKA doc (sibling models) |
| X = 50, 52, 53 (`IN_SP`/`OUT_SP`) | Sensor offsets ±3.0 K; `IN_PV_8`. Dropped from the 2019 table | 2007 manual | IKA doc (older model) |
| Viscosity trend reset | Front-panel Back key (F) only, resets to 100 %; trend needs a constant set speed. No remote command | 2019 manual | IKA doc |
| pH calibration | Menu only (2/3-point, temperature sensor plugged in). No remote command | 2019 manual | IKA doc |
| Watchdog practice | Set the watchdog time to ~20× the polling interval to avoid false Er 2; Er 2 shows only on the display, never over the interface; no documented way to cancel mode 1 | 2007 manual (labworldsoft tip); [labmcp-ika](https://pypi.org/project/labmcp-ika/) | IKA doc + simulator-only code |
| Framing | 2019 English says max "10 characters" (other IKA manuals: 80, likely a typo); 2019 says RTS/CTS on RS-232, RCT basic says none | 2019 manual, RCT basic | IKA doc |
| USB re-enumeration | An RCT digital (USB 0483:5740) dropped off USB and came back on a different port; the open handle had to be reopened | [GitHub issue](https://github.com/coport-uni/InnoCORESDL_Sungwoo/issues/41) | claim |

**To try on the bench:** `STATUS`, `STATUS_1`, `STATUS_4`, `RMP_IN_1`. A `-84` reply means not supported on our firmware.

### Other editions and related manuals

- Same 2019 edition: [pcgroup.ru](https://pcgroup.ru/files/catalog/RET-control-visc-rukovodstvo.pdf) (identical file), [manualsdir](https://www.manualsdir.com/manuals/551081/ika-ret-control-visc.html?page=31). [manualslib 1658326](https://www.manualslib.com/manual/1658326/Ika-Ret-Control-Visc.html) may be an 04/2018 edition.
- Older model: IKAMAG RET control-visc C, RETCV_0107 — [artisantg PDF](https://www.artisantg.com/info/IKA_RET_ControlVisc_Manual.pdf), [manualslib 1970851](https://www.manualslib.com/manual/1970851/Ika-Werke-Ikamag-Ret-Control-Visc.html).
- Sibling hotplates: [IKA Plate 20000015643, 11/2018](https://shop.textalk.se/shop/ws72/72372/art12/156948912-a58526-20000015643_20014388a_A2_IKA_Plate_112018_web.pdf) · [C-MAG HS 7 control 20000015641, 11/2018](https://shop.textalk.se/shop/ws72/72372/art16/156948916-cc53a2-20000015641_20014381a_A2_C-MAG_HS_7_control_112018_web.pdf) · [RCT basic 20000018613, 05/2022](https://www.scientificlabs.co.uk/handlers/libraryFiles.ashx?filename=Manuals_S_STI2211.pdf).
- IKA's official downloads page refused automated access; check it by hand: [ika.com RET control-visc downloads](https://www.ika.com/en/Products-LabEq/Magnetic-Stirrers-pg188/RET-control-visc-5020000/Downloads-cpdl.html).

## Questions

- [ ] Reply format of `IN_PV_1` on our unit (value only, or value plus channel number?).
- [ ] Does `IN_PV_1` return a sentinel value when no external probe is plugged in? (Matters for the interlock, DESIGN D32.)
- [ ] Normal heat-up: how far above setpoint does the plate go (small flask, big flask, oil bath)? Sets the interlock's "plate above setpoint" default.
- [ ] Does `OUT_WD1@m` echo on our firmware, and how long is the reply delay?
- [ ] Does the RET accept `OUT_SP_1` while the heater is off (the app sets first, then starts)?
- [ ] On the RS 232 route (PC 1.1 + adapter), is RTS/CTS flow control needed? The app opens ports with flow control off; the USB route should not care.
- [ ] What range and unit does the viscosity trend (`IN_PV_5`) report?
- [x] Weighing resolution: whole grams (no decimals). Bench 2026-10-22.
- [x] `IN_PV_90` needs weighing mode: no mass until G is pressed and the balance settles. Bench 2026-10-22.
- [x] `IN_TYPE` returns `1`; `IN_SOFTWARE` gives no reply. Neither identifies the unit. Bench 2026-10-22.
- [ ] Does `OUT_NAME IKARET` restore the name, and does it survive a power cycle?
- [x] `IN_PV_90` answers `0.0 90` outside weighing mode and the mass in weighing mode (`122.0 90` with a load, after G). The app treats exactly 0 as "not weighing". Bench 2026-10-22.
- [x] `IN_PV_80` = 7.55 was with **no pH electrode connected**: the RET returns a plausible-looking number without an electrode, so the value alone cannot show whether one is fitted. If pH is added to the app, the user must say an electrode is fitted. Bench 2026-10-22.
- [ ] Is there a device-side tare command? None is listed; the app tares in software (net = gross − stored tare).

## Bench log

_Add dated entries: date, firmware (`IN_SOFTWARE` reply), command, exact reply, conclusion._

- **2026-10-21** — First connection from a laptop over USB at 9600 7E1. `IN_NAME` came back as 7 unreadable characters (bytes outside ASCII). Likely causes: the parity bit leaking into bit 7 through the USB virtual COM port, or the USB side not using 7E1. The app now drops bit 7 of every received byte (NAMUR is 7-bit ASCII) and, if needed, also tries 8N1; the working setting is saved per unit. **Next:** reconnect and record which setting the app reports and the raw hex shown in the bench terminal.
- **2026-10-22** — Balance: `IN_PV_90` gives no mass until the weighing key (G) is pressed on the unit and the reading settles. Readings are whole grams. App: mass shows a "Press the weighing key (G)…" prompt until readings arrive, retries every 3 s without logging errors, shows "settling…" until 3 readings agree within 1 g, and only allows Tare once settled.
- **2026-10-22 (pm)** — Add device could not identify the RET. At every serial setting `IN_NAME` returned `ff ff ff ff ff ff ff 0d 0a`: correct CR LF framing, but seven 0xFF bytes for the name, i.e. the stored name is **blank (erased memory)**. Over USB the serial settings make no difference. Yesterday's "garbled name" was the same bytes. App now: recognises a blank name as a working NAMUR unit, also asks `IN_TYPE` and `IN_SOFTWARE`, and lets you connect by picking the model. Possible permanent fix: `OUT_NAME IKARET` (documented, max 6 characters, default IKARET) writes the name back; not done yet, the user decides.
- **2026-10-22 (pm)** — `IN_TYPE` → `1` (`31 0d 0a`); `IN_SOFTWARE` → no reply within 1.2 s. The unit has to be connected by picking its model (or after `OUT_NAME IKARET`).
- **2026-10-22 15:13** — Bench terminal, heater and stirrer off. Reply format `value channel` + CR LF confirmed. `IN_NAME` → `ff`×7 (blank). `IN_PV_5` → `0.0 5`. `IN_PV_80` → `7.55 80` (pH, **no electrode connected**). `IN_PV_90` → `0.0 90` (one decimal on the wire although the display shows whole grams; weighing mode state at the time not recorded). `IN_SP_1` → `0.0 1`, `IN_SP_4` → `0.0 4`. `IN_SOFTWARE` → no reply.
- **2026-10-22 15:15** — Load on the plate. Before G: `IN_PV_90` → `0.0 90`. After G and settling: `122.0 90` (`31 32 32 2e 30 20 39 30 0d 0a`). App changed: 0 = not weighing (prompt shown).
