# Reactor Control — project design

**Living document.** It must describe the app as it is in `main` right now. Every change to the code updates this file in the same commit (see [Keeping this document current](#keeping-this-document-current)). Last reviewed: 2026-10-22.

Related: [README](../README.md) (setup, code map) · [MODULES.md](MODULES.md) (supported devices) · [program-format.md](program-format.md) (draft program format) · [manuals/](manuals/) (device notes)

## 1. What it is

Reactor Control is a web page that runs lab reactor equipment — overhead stirrers, hotplates, pumps — from one screen, and records what happened. It runs in Chromium on a Raspberry Pi (or any computer) next to the equipment, talks to each unit over USB serial (Web Serial), and needs no server: it is hosted on GitHub Pages.

The goal, in order of importance:

1. **Know exactly what happened** in every reaction: every setpoint, every change and who made it, every reading.
2. **Control it easily and flexibly**: change anything at any time, like the CombiFlash run screen.
3. **Repeat it**: turn what happened into a program that can be run again, adjusted live, and shared.
4. **File it**: hand a complete package for each reaction to the electronic notebook (ELN), linked by a reaction ID.

## 2. How it is used

### Today

1. Open https://polynicolaas.github.io/reactor-control/ in Chromium on the Pi (kiosk mode works).
2. **Add device** for each unit: pick its USB port once; the app asks the unit what it is and sets up the card. Simulated units are available for testing without hardware.
3. Each device card shows live readings, setpoints (with read-back from the unit) and on/off switches. Pump channels each have their own block and can be named ("Reagent A").
4. The live chart shows one lane per device on a shared time axis.
5. **Start recording**, run the reaction, add notes as you go ("added substrate"), **Stop recording**, **Download CSV**.
6. **STOP ALL** stops every unit at once.

### Planned (decided, not built)

1. Enter or scan the **reaction ID** (a code linked to the ELN page) to start a reaction. Recording starts automatically and cannot be forgotten.
2. Run by hand, or load a program and adjust it live. Every change is recorded with its source.
3. **Stop** halts all units, then asks: **Resume** (restore the previous state, same reaction) or **Reaction complete**.
4. On *Reaction complete* the app writes a **package** (data, as-run program, photos) to a drop folder, where an orchestrator (likely Luma Lab Connect) picks it up and files it in the ELN page.

## 3. What is recorded and saved

### Now

| What | Where | When / how long | Notes |
| --- | --- | --- | --- |
| Page setup: devices, names, colours, order, user limits, serial settings, pump channel names, balance tare | Browser storage (`reactor-control.page`) on that computer | Until changed or browser data is cleared | Restored on reload; real units reconnect to ports already allowed |
| Chart view: time range, hidden lanes/channels | Browser storage (`reactor-control.chart`) | Same | |
| Last hour of samples (for the chart) | Memory | Lost on reload | |
| **Recording — samples**, 1 per second per device: every reading (actual), setpoint as read back from the unit, switch state (0/1); for the balance also gross and tare; pump flow (set rate while running) and dispensed (app estimate) | Memory, then `reactor-run_<date>_samples.csv` on **Download CSV** | **Lost if the page reloads before download** | Readings outside their valid state (balance while heating/stirring) are blank |
| **Recording — events**: every command sent except routine polling, connection info, errors, notes, tare actions, terminal commands | Memory, then `reactor-run_<date>_events.csv` | Same | Changes are logged as commands; who made them is not yet recorded |
| Event log on screen | Memory (last 300) | Lost on reload | |

Not recorded today: reaction ID, operator, the program/plan, the source of each change (person or program), photos, device firmware versions.

### Planned

| What | Notes |
| --- | --- |
| Reaction session record, saved continuously in browser storage (IndexedDB) | Survives reloads and power cuts; recording starts with the reaction ID |
| Source of every change (person, program step, device itself) | Basis for "what actually happened" and for as-run programs |
| Reaction package on *Reaction complete* | See [§7](#7-reaction-id-stop-and-the-package) |
| Camera snapshots / time-lapse | See [§9](#9-camera) |
| Device identity: model reply, firmware, serial where available | In the package manifest |

## 4. How it works (short)

- **Drivers describe devices; the core does the work.** A driver lists readings, setpoints, switches, stop commands and its wire protocol. Panels, polling, chart, recording and Stop all are generic. Adding a model is a new driver file (see README).
- **Protocols:** NAMUR for IKA (9600 7E1, CR LF, unacknowledged writes) and Ismatec for the Reglo ICC (9600 8N1, CR, `*`/`#` acknowledgements). Add device tries both.
- **One command in flight per port**; polling and user commands share the queue.
- **Safety in the app:** device ranges, per-setpoint user limits, confirmation before heating or large temperature jumps, Stop all, removing a unit stops it first, pump channels marked off when the pump stops itself.

## 5. Decisions

Newest last. Each has a date and a short reason. Change a decision by adding a new entry that supersedes it; do not delete old ones.

| # | Date | Decision | Why |
| --- | --- | --- | --- |
| D1 | 2026-10-21 | Browser app using Web Serial, static site on GitHub Pages, run in Chromium on the Raspberry Pi | No server to maintain; the Pi is the bench computer. May be wrapped as a standalone app later |
| D2 | 2026-10-21 | Modular from the start: units are added/removed on the control page; drivers describe devices | Setups change per reaction |
| D3 | 2026-10-21 | Record actuals **and** setpoints (as read back) and switch states; one chart lane per device | Need to see what the unit was told and what it did |
| D4 | 2026-10-21 | Renamed IKA Control App → **Reactor Control** (repo `reactor-control`) | Non-IKA devices are coming |
| D5 | 2026-10-21 | One folder of manuals per device, annotated in `notes.md` with page references; PDFs not committed | Manuals are copyrighted; the repo is public |
| D6 | 2026-10-22 | Maintained module list (`modules.json` → MODULES.md); manuals checked for new editions; periodic feature reviews for undocumented features | Keep drivers complete and current |
| D7 | 2026-10-22 | Pump: **Ismatec Reglo ICC**, 4 channels, 12 rollers, bought with tubing from **Fisher** | Independent channels, computer control over USB, chemically compatible tubing options |
| D8 | 2026-10-22 | The app sets pump flow (mL/min) and start/stop; tubing ID and rotation direction stay keypad settings | Direction errors could pull reactor contents back; to revisit (open question) |
| D9 | 2026-10-22 | Removing a unit from the page stops it before handing it back to local control | No unit left running unattended |
| D10 | 2026-10-22 | **Knowing what actually happened is the priority.** Programs are optional: a plan to start from, and something produced from the record afterwards | Most reactions will be adjusted by hand |
| D11 | 2026-10-22 | Change anything during a run, CombiFlash-style; every change is recorded with time and source | People adjust reactions on the fly |
| D12 | 2026-10-22 | Manual sessions can be saved as programs, re-imported and duplicated | Repeatability without writing programs first |
| D13 | 2026-10-22 | Programs name **roles** with required capabilities, not models; a setup check matches units to roles, fuzzy (e.g. EUROSTAR 100 for EUROSTAR 60) | Highly modular, substitutable equipment |
| D14 | 2026-10-22 | Every reaction has a **reaction ID**: a unique code linked to the ELN page | Data must land on the right notebook page |
| D15 | 2026-10-22 | **Stop** halts all units at once, then offers **Resume** or **Reaction complete** | Safety first; a stop is not always the end |
| D16 | 2026-10-22 | *Reaction complete* writes a package (reaction ID, as-run program from the time-stamped setpoints, actuals, events, photos) to a drop location for an orchestrator | Hands-off filing into the ELN |
| D17 | 2026-10-22 | ELN will be electronic; product not chosen. **ELN integration is deferred** — design hooks now, implement later. Likely orchestrator: **Luma Lab Connect** | Decide ELN first |
| D18 | 2026-10-22 | Add a camera to the Pi setup | Visual record of the reaction alongside the data |
| D19 | 2026-10-22 | This design document is living and is updated with every code change; decisions and improvement ideas are tracked here | Keep the design true to the code |
| D20 | 2026-10-22 | **Planned direction:** host the app on department hardware inside NU's network, with a small server of our own (§12). **Needs to be defined and implemented.** GitHub Pages stays the host until then | A server we control lets feedback become issues without a third-party relay, keeps reaction data and feedback inside NU, and enables server-side records, packages for Luma, and NU login |
| D21 | 2026-10-22 | In-app feedback (bugs, ideas, comments) is filed as issues automatically through our own server, not a third-party relay. Issues must not be public | Cleaner and private; feedback can contain reaction and lab details |
| D22 | 2026-10-22 | The server is built and shipped as **one container** (Docker/Podman), multi-architecture (ARM for the Pi, x86 for a server). It runs on whatever host the department provides — most likely a Linux VM with a container runtime — or on the Pi as the interim. Data, secrets, certificate and backups live on the host, not in the container | Small service; identical code on Pi and department server; simple updates and rollback; matches how university IT usually hosts services |

## 6. Programs (draft)

Full draft: [program-format.md](program-format.md). Summary:

- JSON file (`.reactor.json`) with roles, limits, one step lane per role (set, ramp, hold, until-reading gate, wait, dose), prompts for human actions, and abort behaviour.
- During a run, the device cards stay live: a change is an override of that step, with "keep for the rest of the run"; pause, hold, skip, extend, take a role manual and hand it back.
- **Reworked by D10:** the record is primary. The run view shows the past (actuals) and the future (plan) on the same chart; editing the plan by dragging points is the CombiFlash-style goal. Build order now starts with the record and package, not the run engine.

## 7. Reaction ID, Stop and the package

**Reaction ID**
- Entered or scanned (a USB barcode/QR scanner types like a keyboard) when a reaction starts; shown in the top bar throughout; stamped into every file.
- Format: not decided — depends on the ELN. Working assumption: `<initials>-<notebook>-<page>`, e.g. `NV-012-045`, plus an optional suffix for repeats. The app will validate against a configurable pattern.

**Stop** (D15)
1. Halts every unit immediately (as STOP ALL does today).
2. Dialog: **Resume** — restores the setpoints and switches from before the stop and continues the same record (heater needs a confirmation); **Reaction complete** — closes the record and builds the package.

**Package** — one folder per reaction, e.g. `NV-012-045_2026-10-22_0914/`:

| File | Contents |
| --- | --- |
| `manifest.json` | Reaction ID, operator, start/end, status, units (model, firmware, roles), app version, file list with checksums |
| `program.reactor.json` | As-run program built from the time-stamped setpoints and switches |
| `actuals.csv` | Samples, as in today's samples CSV |
| `events.csv` | Every change with its source, notes, errors |
| `run.json` | The complete record (machine-readable) |
| `chart.png` | The run at a glance |
| `photos/` | Camera images named by time in the run |

**Drop location** (to decide with the orchestrator):
- Preferred: an **outbox folder on the Pi** (e.g. `~/reactor-outbox`), chosen once in the browser (File System Access API). The app writes files, then `manifest.json`, then a `READY` marker, so a watcher never picks up a half-written package.
- Alternatives: POST to an orchestrator on the Pi (`http://localhost`); zip download as a fallback.

## 8. ELN and Luma Lab Connect (deferred — D17)

What we know (public Dotmatics material, 2026-10-22):
- Luma Lab Connect uploads files automatically from Windows or Linux machines or S3 buckets, parses them with built-in or custom data models (JSON and CSV sources are supported), and can link results to ELN experiments.
- Not confirmed: how its Linux agent watches folders, how results are matched to an experiment (ID in the file name? in the content?), and which ELNs it writes to.

How our design fits: packages are self-describing folders (`manifest.json` + CSV/JSON) carrying the reaction ID, written to an outbox folder on a Linux machine. Before the department server exists that is the Pi; afterwards it is the server's packages folder (§12, Deployment). A Lab Connect agent runs on that host — not inside our container — and watches the folder (or the folder is synced to S3); a custom data model would map `manifest.json` → experiment and `actuals.csv` → data.

To decide later: which ELN; the reaction ID format the ELN generates; whether the app can look up/validate an ID against the ELN; whether Lab Connect needs a specific folder layout or file naming; whether packages must also carry a human-readable report (PDF/HTML).

## 9. Camera

Decided to add one (D18); model not chosen. Plan:
- A USB (UVC) webcam works in Chromium on the Pi with no extra software; the browser can lock focus and exposure on many models, which matters for a fixed shot through a fume hood sash.
- Features: live tile on the page; snapshot every N seconds during a reaction (time-lapse aligned with the chart); automatic photo at every change, at Stop and with each note; video opt-in only (files are large).
- Photos go into the package under `photos/`, and are kept in browser storage during the reaction so a reload does not lose them.
- The Pi's own ribbon-cable camera module is harder to use from a browser (it needs a bridge); keep it as an option if we add a local helper service later.

## 10. Roadmap

1. **Reaction session**: reaction ID, always-on record in IndexedDB, source on every change, two-stage Stop (Resume / Reaction complete).
2. **Package and outbox**: as-run program from setpoints, outbox folder writer, zip fallback.
3. **Camera**: live tile, time-lapse, photos on events.
4. **Feedback box** with local queue and configurable send address (§12); works local-only until a server exists.
5. **Run view**: plan lanes on the chart, drag to edit, Hold per lane; run engine for programs; setup check with role matching.
6. Program import (file, link, notebook helper), JSON Schema.
7. **Department server** (D20, D22): define; build the container (usable on the Pi as the interim); set up host, HTTPS and backups; feedback → private issues; then central records, packages for Luma, NU login.
8. ELN/Luma integration.
9. Safe-run watchdog on units that support it (RET `OUT_WD`), more devices.

## 11. Ideas and improvements

Add ideas here with a date; move them to the roadmap when decided.

- 2026-10-22 — Pump: per-channel calibration from the app (`xY`/`xV`), so "Dispensed" becomes trustworthy.
- 2026-10-22 — Pump: set rotation direction per channel from programs, or check it like tubing.
- 2026-10-22 — Pump: dose a set volume (pump's Volume mode) as a program step.
- 2026-10-22 — Suggest gates when saving a manual session as a program (e.g. a change made right after the probe reached 60 °C).
- 2026-10-22 — "Same as last time" device-to-role assignment when rerunning a program.
- 2026-10-22 — Barcode/QR on the notebook page for the reaction ID.

## 12. Department server and feedback (planned — D20, D21; to be defined)

**Status: direction agreed, design and implementation still to do.**

### Why a server

GitHub Pages only serves files: the app has nowhere private to keep a key or send data. A server on department hardware inside NU's network serves the app **and** receives what it sends back. The browser still runs on the Pi next to the equipment (Web Serial only reaches the USB ports of the computer the browser runs on); the server hosts the app and the data, not the device connections.

### Feedback box

- A box at the bottom of the page: type (bug, idea, comment), text, optional photo/screenshot.
- Context attached automatically: app version, connected devices and status, reaction ID if running, last ~50 log lines, browser.
- **Saved locally first** (browser storage) and sent to a configurable address (`/api/feedback` on the server); unsent items are queued and retried, and can be exported. Before a server exists the box works in local-only mode.
- The server stores each item, then files it as an issue in a **private** tracker (private GitHub repo with the token held on the server, or an NU-run tracker) and returns the issue number, which the app shows.

### What else the server enables (each to be decided separately)

- Reaction records stored centrally, not only in one browser.
- Reaction packages written to a server folder watched by a Luma Lab Connect agent (§8).
- Login with NU credentials (single sign-on): a real operator on every change.
- One deployment updates every Pi.

### Deployment (D22)

The server is one container image; the host is whatever the department provides. Most likely IT gives us a Linux VM and we run the container on it with Docker or Podman. If containers are not allowed, the same service installs directly on the VM, with more manual upkeep.

| Need | How |
| --- | --- |
| Data that survives updates (database, feedback queue, reaction records, packages) | A host folder mounted into the container, included in IT's backups |
| GitHub token and other secrets | A secrets file on the host; never in the image or the repo |
| HTTPS certificate | A reverse proxy in front (Caddy, or IT's own) holding NU's certificate |
| NU login (later) | IT's single sign-on at the proxy; the app receives the user's identity |
| Luma Lab Connect | Its agent runs on the host and watches the mounted packages folder |
| Updates | Pull the new image and restart; roll back the same way. Settings in one compose file in the repo |

Device control is unaffected: the Pi's browser still talks to the equipment over USB; the server hosts the app and receives data.

### Requirements

- HTTPS with a certificate trusted by the Pis' browsers (Web Serial needs a secure page); NU IT can likely issue one for an internal hostname.
- IT approval to run the service on the network; outbound access to GitHub if issues go there.
- A host for the container (VM or server) and a container runtime, or permission to install one.
- Backups of the mounted data folder.

### Interim option

The Pi can run the same container for itself: pages served from `localhost` count as secure, so no certificate is needed, and the token stays on the Pi. Moving to the department server later is the same code on another machine.

### To define

- Host: VM or physical server, container platform available?, hostname; who administers it (department IT or us).
- Server stack inside the container (proposal: small Node service next to the static app, SQLite for storage).
- Issue destination: private GitHub repo or an NU tracker.
- Authentication: NU single sign-on or none at first.
- Which data moves to the server first: feedback only, or reaction records and packages too.
- Whether to start with the interim Pi-local server.

## 13. Known limitations

- Recordings live in memory until downloaded; a reload loses them (fixed by roadmap item 1).
- Changes are logged as commands, not as "who changed what".
- Pump "Flow" is the set rate while running; "Dispensed" is an estimate until channels are calibrated. Channels started on the pump keypad are not known to the app.
- Reglo ICC commands are from the manual and not yet bench-tested (see its notes).
- RET watchdog is documented but unused until tested.

## 14. Open questions

- Which ELN, and what reaction ID format?
- How Luma Lab Connect expects files (folder, naming, data model) and how it links to an experiment.
- Override default during program runs: this step only, or rest of the run?
- Who confirms prompts — needs operator identity (login)?
- Pump direction: set by programs or only checked?
- Camera model and mounting position.
- Department server: host (VM/container platform), hostname, administration, stack, issue destination, login (§12 "To define").

## Keeping this document current

- **Every commit that changes behaviour updates this file**: §3 if anything recorded or saved changes, §4 if the architecture changes, §5 for any new decision, §10–§14 as items move. Update "Last reviewed" at the top.
- Decisions are never deleted; add a new one that says which it supersedes (e.g. "supersedes D8").
- New ideas go in §11 with a date; problems found in use go in §13 or as GitHub issues.
- The same rule is in [`CLAUDE.md`](../CLAUDE.md) for AI-assisted changes and in the pull request template.
