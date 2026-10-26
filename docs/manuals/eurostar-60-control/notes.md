# EUROSTAR 60 control — notes

**Manual:** `EUROSTAR_60-100_control_operating_instructions_20000003965c.pdf` — IKA operating instructions 20000003965c, EUROSTAR 60 control / 100 control, 03/2018, EN, 21 pages.
**Source:** https://cdn.abicart.com/shop/ws72/72372/art14/156950114-5574d5-20000003965c_EN_EUROSTAR_60_100_control_032018_web.pdf
**SHA-256:** `92d67aad98e480845f60ca9dcd26f13192530eb1bea18d26cc4e1b8cc4862d2d`
**Module:** [`src/modules/eurostar-60-control/`](../../../src/modules/eurostar-60-control/)

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
| `IN_NAME` | Read device name | Identify on connect | bench ✓ 2026-10-21: replies `IKA ES 60` |
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

## Possible features

Feature review 2026-10-22. Every IKA EUROSTAR manual edition found (2014, 2018; 60/100, 200, 20 HS) has the same 17-command table as ours, so everything below comes from open-source drivers or IKA wording. Confidence: **IKA doc** · **code** = open-source driver that ran on hardware · **claim**.

| Feature / command | What it does | Source | Confidence |
| --- | --- | --- | --- |
| `STATUS_4` | Motor running? Reply starting `1` = running. Would let the app confirm the motor state instead of trusting the last command. Commented "undocumented in manual" | [numat/ika](https://github.com/numat/ika) (`driver.py`, tests expect `IKA ES 60`) | code (our model) |
| `START_4` / `STOP_4` echo | The ES 60 appears to reply with the command text; numat treats that as success. Our transport discards replies to write commands, which is fine | numat/ika `util.py` | code |
| Setpoint reset on start | On Microstar stirrers `START_4` resets the set speed to 0, so drivers resend `OUT_SP_4` after starting. **Test on the ES 60**; if it happens, the driver must resend the setpoint | [Hein group ika](https://gitlab.com/heingroup/ika), [PyLabware](https://github.com/croningp/pylabware) | code (Microstar, not ES) |
| `OUT_NAME name` | Sets the name `IN_NAME` returns (could label units "STIR1" etc. to tell identical units apart) | numat/ika (verified on Vacstar only); documented for the RET | code / IKA doc (RET) |
| `IN_MODE` reply | `IN_MODE_1` (clockwise) / `IN_MODE_2` (counter-clockwise). Two drivers say `IN_MODE`/`OUT_MODE` do not work on the Microstar C | PyLabware | code (Microstar 75) |
| Reply format | `value channel`, e.g. `25.3 2` — matches our parser | numat, PyLabware, Hein | code |
| Response delay | numat waits 1 s after each write before reading; our 1 s reply timeout covers it | numat/ika | code |
| Watchdog, ramps, `STATUS` flags | **Not for the EUROSTAR**: only the RET documents them; labmcp-ika blocks the watchdog on overhead stirrers | RET manual; [labmcp-ika](https://pypi.org/project/labmcp-ika/) | IKA doc (RET only) |
| Terminator | Manuals write hex `20 0d 20 0a` (space between CR and LF); every driver uses `\r\n` or `" \r\n"`, so it is likely a typo. Our unit answered with `\r\n` framing | 60/100, 200, 20 HS manuals | IKA doc (typo) |
| Error codes | Er 2 motor current sensor · 3 internal over-temperature · 4 blockage/overload · 8 speed sensor/overload · 21 safety relay. All stop the motor; not readable over the interface | [wolflabs manual PDF](https://www.wolflabs.co.uk/documents/IKA_overhead-stirrers_Eurostar-60-100-control_manual.pdf) | IKA doc |
| Controller-only features | Timer, interval mode, 5 speed–time programs, torque trend, safety time-out, torque calibration (over USB, no stirring tool fitted). No serial commands, so the app has to do ramps itself | 03/2018 manual | IKA doc |

**To try on the bench:** `STATUS_4` (motor off, then on), and whether `START_4` keeps the set speed (`IN_SP_4` before and after).

**User report 2026-10-26:** after Motor off, Motor on does not restart the motor until the speed is applied again. Still to check which: `IN_SP_4` reads 0 after `STOP_4`/`START_4`, or keeps the value with the motor not turning. The card shows either case (DESIGN D33); the simulator models it as `STOP_4` clearing the set speed.

### Other editions and related manuals

- Same 03/2018 edition (20000003965c): [wolflabs PDF](https://www.wolflabs.co.uk/documents/IKA_overhead-stirrers_Eurostar-60-100-control_manual.pdf).
- 09/2014 edition (20000003965): [manualsdir](https://www.manualsdir.com/manuals/551098/ika-eurostar-100-control-eurostar-60-control.html), table on p. 14 — same commands.
- 08/2012 edition: [manualslib 3052323](https://www.manualslib.com/manual/3052323/Ika-Eurostar-60-Control.html). Multi-model 06/2015 (20000003848): [manualslib 1937367](https://www.manualslib.com/manual/1937367/Ika-Eurostar-60.html).
- Sibling models, same table: [EUROSTAR 200 control 20000003996](https://www.manualsdir.com/manuals/551100/ika-eurostar-200-control-p4-eurostar-200-control.html) · [EUROSTAR 20 high speed control 20000003967](https://www.manualsdir.com/manuals/551097/ika-eurostar-20-high-speed-control.html).
- No newer edition (20000003965d) found. IKA's downloads page refused automated access; check it by hand.

## Questions

- [ ] Does the unit accept plain CR LF as well as the documented blank CR LF? (The driver sends blank CR LF to match the manual.)
- [ ] Exact reply format of `IN_PV_4` and `IN_NAME` on our unit.
- [ ] Is the torque value (`IN_PV_5`) in Ncm, and is it a trend or absolute?
- [ ] Does `RESET` stop the motor, or only hand control back to the front panel?
- [ ] Does `STATUS_4` work on our unit, and does `START_4` reset the set speed to 0?

## Bench log

_Add dated entries: date, firmware (`IN_SOFTWARE` reply), command, exact reply, conclusion._

- **2026-10-21** — First connection from a laptop over USB (Add device, Auto-detect). `IN_NAME` → `IKA ES 60`. The name does not contain "EUROSTAR", so the driver now also matches `ES 60` / `ES 100`.
