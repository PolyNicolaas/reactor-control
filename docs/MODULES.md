# Modules

Devices Reactor Control supports or plans to. **Generated from [modules.json](modules.json)** by `node scripts/manuals.mjs index`; edit the JSON, not this file.

| Module | Kind | Status | Driver | Notes | Manual | Connection | Buy | Last feature review |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| IKA EUROSTAR 60 control | Overhead stirrer | supported | [module.ts](../src/modules/eurostar-60-control/module.ts) | [notes](../docs/manuals/eurostar-60-control/notes.md) | 20000003965c (03/2018), 21 p., interface p. 17 | USB micro-B (cable in the box) or RS-232 via IKA PC 1.1 | IKA / Fisher | 2026-10-22 |
| IKA RET control-visc | Hotplate stirrer with balance | supported | [module.ts](../src/modules/ret-control-visc/module.ts) | [notes](../docs/manuals/ret-control-visc/notes.md) | 20000004159 (04/2019), 136 p., interface p. 31-33 | USB micro-B (cable in the box) or RS-232 via IKA PC 1.1 | IKA / Fisher | 2026-10-22 |
| Ismatec Reglo ICC (4-channel, 12-roller) | Peristaltic pump | driver-ready | [module.ts](../src/modules/reglo-icc/module.ts) | [notes](../docs/manuals/reglo-icc/notes.md) | 14-036-E rev. C (rev. C), 36 p., interface p. 17-33 (whole manual reviewed 2026-10-28) | USB Mini-B or RS-232 (DB9, daisy chain) | Fisher NC0916780 (Masterflex MFLX7800182); 3-stop tubing from Fisher, material per chemistry | 2026-10-28 |
| Innofluid ST-HandyPump (HandyPump01 head) | Peristaltic pump | driver-ready | [module.ts](../src/modules/innofluid-st-handypump/module.ts) | [notes](../docs/manuals/innofluid-st-handypump/notes.md) |  (undated), 5 p., interface p. 1-5<br> (undated), 1 p., interface p. 1 | RS-485 Modbus RTU (9600 8E1, address 1–32, several pumps per cable) via USB–RS-485 adapter; RS-232 not used | Elexan Scientific (quote 2611051v1: 2 × ST-HandyPump); adapter and cable: Darwin Microfluidics SE-USB-RS232/485, SE-WK-G02 | 2026-11-06 |
| Innofluid LabV1-III (EasyPump III head) | Peristaltic pump (dispensing) | driver-ready | [module.ts](../src/modules/innofluid-labv1/module.ts) | [notes](../docs/manuals/innofluid-labv1/notes.md) |  (), 0 p., interface p. all<br> (), 0 p., interface p. external control, communication settings | RS-485 Modbus RTU (9600 8E1, address 1–32, shares the cable with the ST-HandyPumps) via USB–RS-485 adapter | Elexan Scientific (quote 2611051v1: LabV1-EP3) | 2026-11-06 |
| USB camera (UVC webcam) | Camera | driver-ready | [camera.ts](../src/camera/camera.ts) | [notes](../docs/manuals/usb-camera/notes.md) |  | USB; browser camera API (getUserMedia), not Web Serial | Model not chosen (Logitech C920 class or Arducam UVC; see DESIGN §9) | 2026-10-22 |

**Status:** supported = driver in the app and bench-tested · driver-ready = driver in the app, not yet tested on hardware · planned = decided, no driver yet · candidate = being considered.

## Keeping manuals and features current

- `node scripts/manuals.mjs fetch` puts every manual in `docs/manuals/<module>/` (PDFs are not committed).
- `node scripts/manuals.mjs check` re-downloads each manual and reports **CHANGED** (new edition) or **DEAD LINK**, and flags modules whose feature review is over 90 days old.
- A **feature review** means searching the sources in the module's `watch` list (manufacturer pages, other manuals of the same family, open-source drivers) for commands the manual does not list. Findings go in the module's `notes.md` under *Possible features* with source and confidence; then update `lastFeatureReview`.
- A new edition: save it, update `docNo`, `edition`, `url`, `sha256`, `retrieved` in modules.json, and re-check the page references in notes.md.
