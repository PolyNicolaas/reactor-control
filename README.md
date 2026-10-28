# Reactor Control

A browser control page for lab reactor equipment over Web Serial, run in Chromium on a Raspberry Pi next to the equipment. One screen to control the units, a live chart, and a record of what happened.

**Live app:** https://polynicolaas.github.io/reactor-control/ (static site on GitHub Pages; no server needed today)

| Supported now | Kind | Status |
| --- | --- | --- |
| IKA EUROSTAR 60 control | Overhead stirrer | Bench-tested |
| IKA RET control-visc | Hotplate stirrer with balance | Bench-tested |
| Ismatec Reglo ICC (4 channels) | Peristaltic pump | Driver ready, not yet bench-tested |
| USB camera (any UVC webcam) | Camera | Trial: time-lapse and change clips |

Full list and status: [docs/MODULES.md](docs/MODULES.md).

## Documents

| Document | What it is |
| --- | --- |
| [docs/DESIGN.md](docs/DESIGN.md) | **Start here.** How the app is used, what is recorded and saved, decisions, roadmap, ideas, open questions. A living document: updated with every code change |
| [docs/method-format.md](docs/method-format.md) | Reaction methods: editor and run decisions, file format 0.2 (roles, steps), control variables to consider |
| [docs/MODULES.md](docs/MODULES.md) | Supported and planned devices (generated from `docs/modules.json`) |
| [docs/manuals/](docs/manuals/README.md) | One folder per device: manual (downloaded, not committed) and annotated `notes.md` |
| [examples/methods/](examples/methods/) | Example method file (format 0.2; the 0.1 lane draft kept for reference) |
| [CLAUDE.md](CLAUDE.md) | Rules for changing the code (keep the design doc current) |

## What works now

- Add, remove and reorder units on the control page (real units over USB, or simulated units for testing). The page is saved in the browser and restored on reload.
- One full-width card per unit, built from its module, with **one row per function** (Heating, Stirring, Weighing; each pump channel): each row has its live readings, setpoint with read-back from the unit ("Set · actual"), on/off switch (clearly ON or OFF), its **safety rules** live with on/off and settings, and *Watched by* when another unit's rules depend on it. Pump channels can be named.
- **STOP ALL** stops every unit. Removing a unit stops it before handing it back to local control.
- Live chart: one lane per unit on a shared time axis; time range, lane and channel filters.
- Recording with notes; download as CSV (samples and events), or one zip including camera media. See [what is recorded](docs/DESIGN.md#3-what-is-recorded-and-saved).
- RET balance with software tare. Per-setpoint user limits; confirmation before heating or large temperature jumps.
- **Cameras** (Add camera): live view; a clip from 60 s before to 60 s after every change — setpoint or switch changes, stirring starting or stopping (also from the unit's own controls), setpoints changed on the unit — and the first change starts a recording by itself; a 720p time-lapse frame every 10 s while recording; snapshots; focus/exposure lock where supported. Media downloads with the recording as one zip.
- Bench terminal per unit for raw commands (IKA NAMUR or Ismatec), with replies in text and hex.

## Requirements

- Chrome or Edge on a computer, or Chromium on the Raspberry Pi (Web Serial is Chromium-only and needs HTTPS).
- The browser must run on the computer the units are plugged into.
- Cameras: the browser asks once for camera permission for the site. Clips need Chromium/Chrome (WebCodecs).
- Linux / Raspberry Pi: the user must be in the `dialout` group (`sudo usermod -aG dialout $USER`, then log out and in).
- RET control-visc: turn **off** the "Eurostar" option in its system settings, otherwise the heater switches off when the serial cable is unplugged.
- Reglo ICC: set each channel's tubing inner diameter and rotation direction on the pump. The app sets flow (mL/min) and start/stop.

Serial settings are found automatically (IKA: 9600 7E1, CR LF; Reglo ICC: 9600 8N1, CR).

Raspberry Pi station: flash Raspberry Pi OS (64-bit, desktop) with Raspberry Pi Imager, using the station name as hostname and the shared user `admin` (password from the lab; never commit it here). Then run the setup script with a station name from the list in [docs/DESIGN.md](docs/DESIGN.md#station-names-d38), then reboot. It sets up autologin, VNC, Wi-Fi and a browser window that opens the app on boot:

```bash
STATION_NAME=hephaestus bash scripts/setup-station.sh
sudo reboot
```

Connect with VNC to `hephaestus.local` (no password). For maintenance: `ssh admin@hephaestus.local`. Quick manual alternative: `chromium --kiosk https://polynicolaas.github.io/reactor-control/`

Each unit needs one click in the port picker the first time (Add device); after that the page reconnects to allowed ports on its own.

## Development

```bash
npm install
npm run dev            # local dev server (Web Serial works on localhost)
npm test               # unit tests (modules against their simulators, safety rules, protocol formats)
npm run build          # type-check and build to dist/
npm run manuals:fetch  # download device manuals into docs/manuals/ (not committed)
npm run manuals:check  # look for new manual editions, dead links, overdue feature reviews
npm run manuals:index  # regenerate docs/MODULES.md from docs/modules.json
```

Pushing to `main` runs the tests, builds and deploys to GitHub Pages (`.github/workflows/deploy.yml`). Every behaviour change also updates [docs/DESIGN.md](docs/DESIGN.md) in the same commit.

### Adding a device (module)

Each device type is a **module**: one folder in `src/modules/` with its description, safety rules,
simulator, tests and a README explaining how it is built. **[The module guide](src/modules/README.md)**
walks through making one; copy [`src/modules/_template/`](src/modules/_template/) and read the
[EUROSTAR module](src/modules/eurostar-60-control/) first, the smallest complete example.

In short: manual and notes first (`docs/modules.json`, `docs/manuals/<id>/`), copy the template, fill in
`module.ts` and `safety.ts`, write the simulator and tests, register it in `src/modules/index.ts`.
Cards, polling, chart, STOP ALL, recording and the safety engine pick it up automatically.

### Code map

| Path | Job |
| --- | --- |
| `src/main.ts` | Page layout, recording controls, wiring |
| `src/core/types.ts` | Driver interface (readings, setpoints, switches, groups, derived values) |
| `src/core/protocol.ts` | Wire protocols: NAMUR (IKA) and Ismatec — framing, acknowledgements, identify, probe settings |
| `src/core/serialTransport.ts` | Web Serial: one command in flight, line and one-character replies, timeouts |
| `src/core/probe.ts` | Asks an unknown port what it is, trying each protocol's settings |
| `src/core/device.ts` | One unit: connect, polling, setpoints with read-back, switches, stop, release |
| `src/core/app.ts` | Units on the page, saved page setup, 1 s sampler, recording |
| `src/modules/` | One folder per device module (`module.ts`, `safety.ts`, `sim.ts`, tests, README), `_template/`, `shared/` (NAMUR simulator base, safety test helpers), `index.ts` (the list of modules), [`README.md`](src/modules/README.md) (the guide) |
| `src/camera/` | Camera module: live view, time-lapse, clip buffer and WebM clips, media storage (IndexedDB) |
| `src/ui/` | Cards (devices, cameras), add device/camera, chart, bench terminal, CSV and zip export |
| `src/test/` | Tests of the shared core (vitest); module tests live in each module's folder |
| `scripts/manuals.mjs` | Manual library: fetch, check, index |
