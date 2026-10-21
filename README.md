# Reactor Control

A browser control page for lab reactor devices over Web Serial. Supported now: the IKA **EUROSTAR 60 control** overhead stirrer and the IKA **RET control-visc** hotplate stirrer; other devices plug in as drivers. It is a static site hosted on GitHub Pages; no server is needed.

**Live app:** https://polynicolaas.github.io/reactor-control/

## What works now

- Add, remove and drag-to-reorder devices (horizontal cards) on a control page at any time (real units over USB, or simulated units for testing). The page is saved in the browser and restored on reload.
- One generic panel per device, built from its driver: live readouts, setpoints with device read-back confirmation, on/off switches, a plain status word.
- **Stop all** sends the stop commands to every connected unit.
- Live chart at the top: one lane per device on a shared time axis, filters for time range (5 min–1 h), lanes and channels.
- Recording with notes; download as CSV (samples: actual, setpoint read-back and switch state per channel; events: commands sent, errors, notes).
- Bench terminal per device for sending raw NAMUR commands — use it to check the commands marked *verify* in the design.
- Per-setpoint user limits; confirmation before turning a heater on or raising temperature by more than 50 °C.

## Requirements

- Chrome or Edge on a computer, or Chromium on the Raspberry Pi (Web Serial is Chromium-only and needs HTTPS, which GitHub Pages provides).
- The browser must run on the machine the IKA units are plugged into.
- On Linux / Raspberry Pi: the user must be in the `dialout` group (`sudo usermod -aG dialout $USER`, then log out and in).
- On the RET control-visc: turn **off** the "Eurostar" option in the system settings, otherwise the heater switches off when the serial cable is unplugged.

Serial settings used: 9600 baud, 7 data bits, even parity, 1 stop bit, no flow control; commands end with CR LF.

## Raspberry Pi kiosk

```bash
chromium-browser --kiosk https://polynicolaas.github.io/reactor-control/
```

The first time, each unit needs one click in the port picker (Add device). After that the page reconnects to allowed ports on its own.

## Device manuals

`docs/manuals/` has one folder per device with the manual and a `notes.md` of annotations: key facts with page numbers, the command table with a verification status, open questions and a bench log. The PDFs are not committed (copyrighted; this repo is public) — run `./scripts/get-manuals.sh` to download them. See [docs/manuals/README.md](docs/manuals/README.md).

## Adding a device model

1. Add a folder under `docs/manuals/` from `_template/` with the manual and notes.
2. Copy `src/devices/eurostar60.ts` to a new file and fill in the readings, setpoints, switches and stop commands from the device manual.
3. Add it to `src/devices/registry.ts`.

The panel, polling, chart, Stop all and recording pick it up automatically.

## Development

```bash
npm install
npm run dev      # local dev server (Web Serial works on localhost)
npm run build    # type-check and build to dist/
```

Pushing to `main` builds and deploys to GitHub Pages via `.github/workflows/deploy.yml`.

## Code map

| Path | Job |
| --- | --- |
| `src/core/types.ts` | Driver interface, NAMUR serial settings, reply parser |
| `src/core/serialTransport.ts` | Web Serial: one command in flight, CR LF lines, timeouts |
| `src/core/device.ts` | One device instance: polling, setpoints, switches, stop, read-back |
| `src/core/app.ts` | Devices on the page, saved config, 1 s sampler, recording |
| `src/devices/*` | Drivers, registry, simulator |
| `src/ui/*` | Panels, add device, chart, terminal, CSV export |

## Not yet built (see the design doc)

Reaction programs (lanes, ramps, gates), safe-run watchdog, IndexedDB run storage, program import from notebooks, login and synced runs.
