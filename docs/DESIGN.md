# Reactor Control — project design

**Living document.** It must describe the app as it is in `main` right now. Every change to the code updates this file in the same commit (see [Keeping this document current](#keeping-this-document-current)). Last reviewed: 2026-10-26 (RET plate/probe interlock, plate-above-setpoint default 30 °C; set-vs-actual line on every setpoint).

Related: [README](../README.md) (setup, development, code map) · [MODULES.md](MODULES.md) (supported devices) · [program-format.md](program-format.md) (draft program format) · [manuals/](manuals/README.md) (device notes)

**Contents:** [1 What it is](#1-what-it-is) · [2 How it is used](#2-how-it-is-used) · [3 What is recorded and saved](#3-what-is-recorded-and-saved) · [4 How it works](#4-how-it-works-short) · [5 Decisions](#5-decisions) · [6 Programs](#6-programs-draft) · [7 Reaction ID, Stop, package](#7-reaction-id-stop-and-the-package) · [8 ELN and Luma](#8-eln-and-luma-lab-connect-deferred--d17) · [9 Camera and video](#9-camera-and-video) · [10 Roadmap](#10-roadmap) · [11 Ideas](#11-ideas-and-improvements) · [12 Server, feedback, remote access](#12-department-server-and-feedback-planned--d20-d21-to-be-defined) · [13 Known limitations](#13-known-limitations) · [14 Open questions](#14-open-questions)

## 1. What it is

Reactor Control is a web page that runs lab reactor equipment — overhead stirrers, hotplates, pumps — from one screen, and records what happened. It runs in Chromium on a Raspberry Pi (or any computer) next to the equipment and talks to each unit over USB serial (Web Serial).

Today it is a static site on GitHub Pages with no server. The target (D20–D23) is a **station** model: named Pis that users reach by VNC, with the app and all records hosted on a department server inside NU's network, from where Luma Lab Connect files them into the electronic notebook.

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

The station workflow (D23):

1. Pick a named station (a Pi, e.g. `RC-03`), plug in the modules for this reaction (and the camera).
2. Connect to the Pi from your laptop with VNC; the app is already open in the browser.
3. Connect the modules in the app (Add device).
4. Enter or scan the **reaction ID** (a code linked to the ELN page) to start a reaction. Recording starts automatically and cannot be forgotten.
5. Run by hand, or load a program and adjust it live. Every change is recorded with its source.
6. **Stop** halts all units, then asks: **Resume** (restore the previous state, same reaction) or **Reaction complete**.
7. Throughout, data, metadata, photos and video are saved to the **host** automatically. On *Reaction complete* the host closes the **package** for the reaction (data, as-run program, photos, video), where Luma Lab Connect picks it up and files it in the ELN page.
8. Unplug everything. The station keeps nothing; the host has the how and the what.

## 3. What is recorded and saved

### Now

| What | Where | When / how long | Notes |
| --- | --- | --- | --- |
| Page setup: devices, names, colours, order, user limits, interlock settings (D32), serial settings, pump channel names, balance tare | Browser storage (`reactor-control.page`) on that computer | Until changed or browser data is cleared | Restored on reload; real units reconnect to ports already allowed |
| Chart view: time range, hidden lanes/channels | Browser storage (`reactor-control.chart`) | Same | |
| Last hour of samples (for the chart) | Memory | Lost on reload | |
| **Recording — samples**, 1 per second per device (download: two CSV files, or one zip with `samples.csv`, `events.csv`, `media.csv` and the media folders when a camera recorded): every reading (actual), setpoint as read back from the unit, switch state (0/1); for the balance also gross and tare; pump flow (set rate while running) and dispensed (app estimate) | Memory, then `reactor-run_<date>_samples.csv` on **Download CSV** | **Lost if the page reloads before download** | Readings outside their valid state (balance while heating/stirring) are blank |
| **Recording — events**: every command sent except routine polling, connection info, errors, notes, tare actions, terminal commands, interlock trips (with the reason; also trigger a camera clip) and resets, interlock setting changes | Memory, then `reactor-run_<date>_events.csv` | Same | Changes are logged as commands; who made them is not yet recorded |
| Event log on screen | Memory (last 300) | Lost on reload | |
| **Camera — time-lapse**: one 720p JPEG every 10 s per camera while recording | Browser IndexedDB, then in the recording zip (`timelapse/`) on **Download recording** | Until the next recording starts | |
| **Camera — clips**: WebM (VP8, 720p, 10 frames/s) from 60 s before to 60 s after every change: a setpoint or switch changed on a card, stirring starting or stopping (seen in the speed reading, so also when started on the unit), a setpoint changed on the unit or in the terminal, a pump channel stopping on the pump, Stop all, a note, **Mark**. Merged when changes are close, max 5 min. With a camera on the page, the first change **starts the recording by itself** (D31) | Browser IndexedDB, then `clips/` in the zip | Same | Each clip is listed in `media.csv` with the change that triggered it, and in the events |
| **Camera — snapshots** (button) | While recording: `snapshots/` in the zip; otherwise downloaded at once | Same | |
| Camera list (name, which camera) | Browser storage (`reactor-control.page`) | Until changed | Cameras restart on reload once the site has camera permission |

Not recorded today: reaction ID, station name, operator, the program/plan, the source of each change (person or program), device firmware versions. Nothing is uploaded anywhere yet.

### Planned

| What | Notes |
| --- | --- |
| Reaction session record, saved continuously in browser storage (IndexedDB) | Survives reloads and power cuts; recording starts with the reaction ID |
| Source of every change (person, program step, device itself) | Basis for "what actually happened" and for as-run programs |
| Reaction package on *Reaction complete* | See [§7](#7-reaction-id-stop-and-the-package) |
| Device identity: model reply, firmware, serial where available | In the package manifest |
| Station name (which Pi) | In every record and the manifest; set once per Pi (proposal: in the kiosk start URL, e.g. `?station=RC-03`, since a browser cannot read the Pi's hostname) |
| Time-lapse and change clips (720p), streamed to the host during the reaction | See [§9](#9-camera-and-video) |
| Everything above saved on the host as it happens, and kept there | D23; the Pi's browser storage is only a buffer for network drops |

## 4. How it works (short)

- **Drivers describe devices; the core does the work.** A driver lists readings, setpoints, switches, stop commands and its wire protocol. Panels, polling, chart, recording and Stop all are generic. Adding a model is a new driver file (see README).
- **Protocols:** NAMUR for IKA (9600 7E1, CR LF, unacknowledged writes) and Ismatec for the Reglo ICC (9600 8N1, CR, `*`/`#` acknowledgements). Add device tries both.
- **One command in flight per port**; polling and user commands share the queue.
- **Cameras are not serial devices.** They use the browser camera API (`getUserMedia`) and have their own card and code (`src/camera/`). Every change is logged as a note — changes made on the cards, and changes each unit shows by itself, found by polling (activity crossing a threshold, e.g. speed above 20 rpm = stirring; setpoints that changed without a write from the card). Each note while recording triggers a clip on every camera; with a camera present, a change starts the recording if none is running (D31). The encoder runs whenever a camera is live. Clips are encoded once (WebCodecs) into a rolling 60 s buffer, so a clip can start before the change (D28).
- **Simulators and tests:** every driver has a simulated unit (usable from Add device) and tests in `src/test/` that run on every push (D27).
- **Safety in the app:** device ranges, per-setpoint user limits, confirmation before heating or large temperature jumps, Stop all, removing a unit stops it first, pump channels marked off when the pump stops itself.

### When a connection drops (D26)

| Link that drops | Today | Planned |
| --- | --- | --- |
| **VNC** (laptop ↔ Pi) | Nothing changes: the browser on the Pi keeps running the reaction and recording. Reconnect and carry on | Same. Closing the *browser* (not VNC) asks for confirmation |
| **Network** (Pi ↔ host) | Not applicable yet (no host) | Control and recording continue on the Pi. Data, events, photos and clips queue in browser storage; a banner shows "Host offline — saving on this station (N MB queued)"; uploads resume by themselves. *Reaction complete* waits until the queue is empty. The host notices a silent station (heartbeat) and can alert. If the Pi's storage runs low: data and events are never dropped; clips first, then every other time-lapse frame, and the record says so |
| **Module USB** (cable pulled, unit off) | The card shows *Disconnected* with **Reconnect**; the log says "Connection lost"; other units carry on; that unit's samples are blank until it is back | Same, plus a clear alarm and the gap marked in the record. **The unit itself keeps its last settings** unless it has a watchdog (below) |
| **The Pi** (power, crash, browser closed) | The recording in memory is lost (§13). Units keep running at their last settings | The record is in browser storage up to the last second and on the host up to the last upload. On restart the app reopens the reaction: "Reaction NV-012-045 interrupted at 10:42 — Resume or Reaction complete", and reconnects the units it knows |

**What the units do on their own when the Pi is gone** — the real safety question:
- RET control-visc: has a watchdog (`OUT_WD1@m`: heating and stirring off if no command for *m* seconds; `OUT_WD2@m`: fall back to safety temperature and speed). Documented, not yet used or bench-tested (roadmap item 9).
- EUROSTAR 60: no watchdog; keeps stirring.
- Reglo ICC: keeps pumping at the last rate. Mitigation idea: run doses in the pump's own Volume mode so the pump stops by itself after the set volume (§11).
- Whether a reaction may continue unattended after a Pi failure is a lab-policy question (§14).

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
| D23 | 2026-10-22 | **Stations are ephemeral, named Pis reached by VNC.** Workflow: the Pi has a name; the user plugs in the modules for their reaction; connects to the Pi with VNC from their laptop; opens the app, connects the modules, runs the reaction. Data and metadata are saved automatically to the host (server) as the reaction runs and catalogued there; Luma Lab Connect picks the files up from the host and pushes them into the ELN. After the reaction everything can be unplugged: nothing needed is kept on the Pi | Easy for students and users to understand; any Pi serves any reaction; the record of how and what is never tied to one piece of hardware. Supersedes the Pi outbox as the main drop location (§7) once the server exists |
| D24 | 2026-10-22 | Video and photos stream to the host **during** the reaction, not at the end | An ephemeral Pi can be unplugged at any time and has little storage |
| D25 | 2026-10-22 | **Video is limited:** time-lapse plus clips around changes, both at 720p; no continuous video. These settings are fixed for now — users cannot change them (user-adjustable settings are a future idea, §11) | Keeps storage and upload small; the clips capture the moments that matter |
| D26 | 2026-10-22 | **A dropped connection never stops the record or the reaction.** Each link (VNC, host, module USB, the Pi itself) fails safe as described in §4 "When a connection drops"; nothing recorded is lost, gaps are marked | Stations are ephemeral and networked; failures must be expected |
| D27 | 2026-10-22 | Every driver has a simulator and tests; pushes to `main` run the tests before deploying | Changes to shared code must not silently break a device; the pump can be developed before it arrives |
| D28 | 2026-10-22 | Camera module built on the browser camera API (not Web Serial): time-lapse by grabbing frames, clips by encoding once with WebCodecs into a rolling buffer and writing WebM; media kept in browser storage (IndexedDB) and downloaded with the recording until the host exists | Works with any UVC webcam in Chromium, no extra software on the Pi; one encoder keeps the Pi load low; IndexedDB keeps large files out of memory |
| D29 | 2026-10-22 | **RET balance:** mass shown in whole grams; the app tares in software (net = gross − stored tare, all three recorded); mass is blank while heating or stirring and until the weighing key (G) is pressed and the reading settles (the RET answers exactly 0.0 outside weighing mode, so 0 counts as "not weighing"; an empty plate therefore shows the prompt too); Tare only when settled | The RET has no remote tare or weighing start, weighs only with heating and stirring off, and reports whole grams (manual p. 25, 35; bench 2026-10-22) |
| D30 | 2026-10-22 | A unit that answers with correct framing but a **blank stored name** (all 0xFF) is treated as a working unit: it connects when its model is picked in Add device; after a reload it is reattached to the port no other model claims | Our RET's stored name is erased (`IN_NAME` → `ff`×7, `IN_TYPE` → `1`); refusing it would block a working unit. `OUT_NAME IKARET` may restore the name (untested) |
| D31 | 2026-10-22 | **Any change triggers the camera**: setpoint or switch changes on the cards, stirring starting or stopping (from the speed reading, so also from the unit's own controls), setpoints changed on the unit, pump channels stopping on the pump, Stop all and notes. With a camera on the page and nothing recording, the first change starts the recording automatically; the clip still covers the 60 s before it | Changes made at the hood must be captured even if nobody pressed Start recording; first step toward always-on recording (D14) |
| D32 | 2026-10-26 | **RET plate/probe interlock** (software). After every poll the app checks: plate above an absolute maximum (default 250 °C); plate more than *N* °C above the temperature setpoint (default 50) while not cooling; plate ≥ 40 °C above the probe for 5 min while the probe rises < 1 °C and is below setpoint. Any rule sends `STOP_1` (whatever the app thinks the heater state is, so keypad heating is covered), latches, repeats `STOP_1` every 5 s while the condition lasts, and refuses Heater on until the user resets on the card; reset is refused while a rule still holds. All four numbers are per unit in Limits and saved with the page. Trips and resets are logged as changes (camera clip). Generic `interlocks` on the driver, so other units can get their own | With the PT100 plugged in the RET heats the plate until the probe reaches setpoint; a probe left out of the medium sends the plate to the unit's safety limit (up to 380 °C) and can burn someone. Not cooling, so lowering the setpoint over a hot plate does not trip; the probe check catches a stray probe long before setpoint + 50 at high setpoints. It only works while the page is open and the unit answers, so the unit's own safety-limit setting stays the backstop (§13) |
| D33 | 2026-10-26 | **Set vs actual on every setpoint** with a driving switch: the line under each setpoint shows "Set X · actual Y" and its state: on target ✓, rising/falling, off, **unit set value differs from what you applied** (e.g. EUROSTAR comes back from Motor off with no speed), or **on but not following** after a grace time (8 s; 90 s for temperature). The last two turn red and make Apply flash. The app does not resend setpoints by itself | After Motor off/on the EUROSTAR does not run until the speed is applied again (user report 2026-10-26); the user wants that explicit step kept but made obvious, for every setting |
| D34 | 2026-10-26 | RET interlock: default "max plate above setpoint" lowered from 50 °C to **30 °C** (supersedes that default in D32). Units with their own value in Limits keep it | User choice: trip earlier when the probe is out of the medium. Big flasks or oil baths that need a hotter plate raise it per unit |

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
| `media/` | Time-lapse frames and change clips (720p), named by time in the run; full video may stay on the host with a link (§9) |

**Drop location** (to decide with the orchestrator):
- **With the server (D23, the target):** the host writes packages to its packages folder as the reaction runs and finalises them on *Reaction complete*; the Luma agent on the host watches that folder. The Pi only buffers.
- Before the server exists: an **outbox folder on the Pi** (e.g. `~/reactor-outbox`), chosen once in the browser (File System Access API). The app writes files, then `manifest.json`, then a `READY` marker, so a watcher never picks up a half-written package.
- Alternatives: POST to an orchestrator on the Pi (`http://localhost`); zip download as a fallback.

## 8. ELN and Luma Lab Connect (deferred — D17)

What we know (public Dotmatics material, 2026-10-22):
- Luma Lab Connect uploads files automatically from Windows or Linux machines or S3 buckets, parses them with built-in or custom data models (JSON and CSV sources are supported), and can link results to ELN experiments.
- Not confirmed: how its Linux agent watches folders, how results are matched to an experiment (ID in the file name? in the content?), and which ELNs it writes to.

How our design fits: packages are self-describing folders (`manifest.json` + CSV/JSON) carrying the reaction ID, written to an outbox folder on a Linux machine. Before the department server exists that is the Pi; afterwards it is the server's packages folder (§12, Deployment). A Lab Connect agent runs on that host — not inside our container — and watches the folder (or the folder is synced to S3); a custom data model would map `manifest.json` → experiment and `actuals.csv` → data.

To decide later: which ELN; the reaction ID format the ELN generates; whether the app can look up/validate an ID against the ELN; whether Lab Connect needs a specific folder layout or file naming; whether packages must also carry a human-readable report (PDF/HTML).

## 9. Camera and video

Decided to add a camera (D18); model not chosen (options: USB webcams such as the Logitech C920 class or Arducam UVC cameras). The camera is treated like a module: plugged into the station Pi for the reaction and connected in the app.

**Built (trial, D28, D31):** **Add camera** on the control page; the card shows the live view, resolution, counts, and the measured encode rate; **Snapshot**, **Mark (save clip)** and, where the camera supports it, **Lock focus & exposure**. While recording it makes the time-lapse and change clips described below and they download with the recording as one zip. Not built yet: streaming to the host (needs the server), live tile for remote viewers. Notes and tests: [manuals/usb-camera/notes.md](manuals/usb-camera/notes.md).

**What the station model (D23, D24) means for video**

- **Stream to the host during the reaction.** The Pi is ephemeral and has a small SD card, so video and photos are uploaded in short chunks (a few seconds each) as they are recorded. If the network drops, chunks wait in browser storage and catch up. If the Pi is unplugged early, the host has everything up to the last chunk. *Reaction complete* shows "upload finished" before the station can be torn down.
- **Recording happens on the Pi, not over VNC.** The browser records the camera directly; VNC only shows you a preview, which may look laggy, but the recording is unaffected.
- **Record less, keep what matters** (D25; sizes to confirm on our hardware; users cannot change these settings for now):

| Mode | Default | Approx. size | Use |
| --- | --- | --- | --- |
| Time-lapse: one 720p photo every 10 s | Always on, fixed | ~0.1 GB per hour | Whole-reaction overview, aligned with the chart |
| Event clips at 720p: keep a rolling ~60 s buffer; save it plus the next ~60 s at every settings change, note, prompt, Stop, or a "mark" button | Always on, fixed | Small, per event | "What did it look like when I added the reagent?" |
| Continuous video | Not offered (D25) | ~0.5–1 GB per hour at 720p | Reconsider later if fast events need it |

- **Pi load.** The Pi's browser encodes video in software while VNC also encodes the screen; a Pi 5 should manage 720p at 10–15 frames/s, a Pi 4 less. To test on the actual station before picking defaults.
- **Synchronised with the data.** Every photo and video chunk carries its time in the reaction; the planned run view can show the frame at any point on the chart.
- **Into the ELN as summary + link.** Large video should not be pushed into the ELN. The package carries the time-lapse, event clips' thumbnails and a contact sheet; full video stays on the host and the ELN entry links to it. Needs a **retention policy** on the host (e.g. keep full video N days unless the reaction is flagged) and storage sized for it.
- **People in frame.** A camera in a lab can record people. Aim at the apparatus, and check NU/department policy on recording in labs (signage, consent, who can see video).
- The Pi's ribbon-cable camera module is harder to use from a browser (it needs a bridge); USB cameras are the default.

## 10. Roadmap

1. **Reaction session**: reaction ID, always-on record in IndexedDB, source on every change, two-stage Stop (Resume / Reaction complete).
2. **Package and outbox**: as-run program from setpoints, outbox folder writer, zip fallback.
3. **Camera**: ~~live view, 720p time-lapse and change clips (D25), download with the recording~~ built as a trial (D28). Next: test on the station Pi with VNC and pick the camera; upload to the host comes with item 7.
4. **Feedback box** with local queue and configurable send address (§12); works local-only until a server exists.
5. **Run view**: plan lanes on the chart, drag to edit, Hold per lane; run engine for programs; setup check with role matching.
6. Program import (file, link, notebook helper), JSON Schema.
7. **Department server** (D20, D22, D23): define; build the container (usable on the Pi as the interim); set up host, HTTPS and backups; streaming of records and media to the host; feedback → private issues; packages for Luma; station names; NU login.
8. ELN/Luma integration.
9. Safety when a station fails (§4): RET watchdog, pump doses in Volume mode; more devices.

## 11. Ideas and improvements

Add ideas here with a date; move them to the roadmap when decided.

- 2026-10-22 — Pump: per-channel calibration from the app (`xY`/`xV`), so "Dispensed" becomes trustworthy.
- 2026-10-22 — Pump: set rotation direction per channel from programs, or check it like tubing.
- 2026-10-22 — Pump: dose a set volume (pump's Volume mode) as a program step; also a safety measure, since the pump then stops by itself if the Pi fails (§4).
- 2026-10-22 — User-adjustable video settings (time-lapse interval, clip length, continuous video) — not for now (D25).
- 2026-10-22 — Suggest gates when saving a manual session as a program (e.g. a change made right after the probe reached 60 °C).
- 2026-10-22 — "Same as last time" device-to-role assignment when rerunning a program.
- 2026-10-22 — Barcode/QR on the notebook page for the reaction ID.
- 2026-10-22 — Station dashboard: all Pis and their reactions on one page, through the server (§12, Remote access).

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

### Remote access and scale

**Each Pi is a self-contained station**: its own browser, its own USB-connected modules, its own reaction. The server only hosts the app and receives data, so it is not the limit on how many Pis there can be — dozens to hundreds of Pis are a light load for one small server.

**Modules per Pi:** each module is one USB serial port, polled about once a second at 9600 baud, and ports work independently. A Pi 4/5 has 4 USB ports; with a powered USB hub, 8–10 modules per Pi is comfortable. The practical limit is the screen (cards and chart lanes), not the hardware.

**Controlling a Pi from a laptop:**

| Way | How | Scale | Notes |
| --- | --- | --- | --- |
| VNC / remote desktop (**chosen user model**, D23) | Raspberry Pi OS has a VNC server built in; connect from the laptop to each Pi's desktop | One window per Pi; fine for a few stations | Needs network access to each Pi (IT firewall/VPN rules), a password per Pi; you see exactly what is at the hood |
| Remote view through the server (idea, not decided) | Each Pi's app publishes live state to the server; laptops open the app in a normal browser and see all stations on one dashboard; remote changes are sent back through the server to the Pi | All stations in one page | No VNC; uses NU login; every remote change recorded with the person's name |

**Safety rules for remote control (to define with lab policy):**
- Stop on the Pi (and STOP ALL) always wins over anything remote.
- Remote control requires login; remote view could be the default and control an explicit permission.
- Remote changes are marked as remote in the record; heater-on and large temperature jumps still need confirmation.
- If the Pi loses the server connection, the reaction continues locally under its last settings and the record keeps going on the Pi.
- Whether reactions may run unattended at all is a lab-policy question, not an app setting.

### Interim option

The Pi can run the same container for itself: pages served from `localhost` count as secure, so no certificate is needed, and the token stays on the Pi. Moving to the department server later is the same code on another machine.

### To define

- Host: VM or physical server, container platform available?, hostname; who administers it (department IT or us).
- Server stack inside the container (proposal: small Node service next to the static app, SQLite for storage).
- Issue destination: private GitHub repo or an NU tracker.
- Authentication: NU single sign-on or none at first.
- Which data moves to the server first: feedback only, or reaction records and packages too.
- Whether to start with the interim Pi-local server.
- Remote view/control through the server (beyond VNC): whether and when, and which safety rules apply.

## 13. Known limitations

- Recordings live in memory until downloaded; a reload loses them (fixed by roadmap item 1).
- No reaction ID, station name or operator in the record yet; the CSV files are named by date only.
- A heater switched on with the unit's own controls is not detected (only from the card); `STATUS_1` on the RET could tell, once tested on the bench. Auto-start of recording happens only with a camera on the page.
- Camera media stays in that browser until downloaded and is cleared when the next recording starts; clips need Chromium (WebCodecs); the encode rate on a Pi with VNC is untested; focus/exposure lock depends on the camera.
- Changes are logged as commands, not as "who changed what".
- Pump "Flow" is the set rate while running; "Dispensed" is an estimate until channels are calibrated. Channels started on the pump keypad are not known to the app.
- Reglo ICC commands are from the manual and not yet bench-tested (see its notes).
- RET watchdog is documented but unused until tested.
- **The RET interlock (D32) is software**: it cannot act if the browser, the Pi or the USB link is down. The hardware cut-off is the RET's own safety temperature (read as "Safety limit", set on the unit, default up to 380 °C): set it on each unit to just above the hottest plate a reaction needs. The interlock thresholds are first guesses from the simulator; check them on the bench with a real flask/oil bath (a big bath may need a larger "plate above setpoint").
- RET balance: mass needs the weighing key (G) pressed on the unit; the tare is the app's, not the RET's (its display shows gross).
- Our RET has a blank stored name, so Auto-detect cannot identify it; pick the model in Add device (D30).

## 14. Open questions

- Which ELN, and what reaction ID format?
- How Luma Lab Connect expects files (folder, naming, data model) and how it links to an experiment.
- Override default during program runs: this step only, or rest of the run?
- Who confirms prompts — needs operator identity (login)?
- Pump direction: set by programs or only checked?
- Camera model and mounting position.
- Exact time-lapse interval and clip length after a load test on the station Pi (720p fixed, D25).
- Which units must use a watchdog, and what a reaction should do if its Pi fails (lab policy).
- How long a station may run disconnected from the host, and how much local storage to allow for the queue.
- Video retention on the host, storage size, and NU/department policy on recording in labs.
- Should any change start a recording even without a camera (one step closer to always-on recording, D14)?
- How each Pi gets its station name (kiosk URL parameter, or registered on the server).
- Does `OUT_NAME IKARET` restore our RET's name permanently?
- RET: how far above setpoint does the plate run during a normal heat-up (small flask, large flask, oil bath)? Sets the default for "plate above setpoint" (D32).
- RET: what does `IN_PV_1` read with the probe unplugged, and does the unit then regulate on the plate? Should the interlock also refuse heating when the probe reading is missing?
- RET: can the safety temperature be read as the set value (`IN_SP_3`) and should the app warn when it is above the interlock's plate maximum? Should the watchdog (`OUT_WD2` with `OUT_SP_12`) be armed so the unit drops to a safe temperature if the Pi dies?
- EUROSTAR: after `STOP_4` / `START_4`, does `IN_SP_4` read 0 (set speed cleared) or the old value with the motor not turning? The card handles both (D33); the answer decides whether the driver should resend the speed on Motor on.
- Department server: host (VM/container platform), hostname, administration, stack, issue destination, login (§12 "To define").

## Keeping this document current

- **Every commit that changes behaviour updates this file**: §3 if anything recorded or saved changes, §4 if the architecture changes, §5 for any new decision, §10–§14 as items move. Update "Last reviewed" at the top.
- Decisions are never deleted; add a new one that says which it supersedes (e.g. "supersedes D8").
- New ideas go in §11 with a date; problems found in use go in §13 or as GitHub issues.
- The same rule is in [`CLAUDE.md`](../CLAUDE.md) for AI-assisted changes and in the pull request template.
