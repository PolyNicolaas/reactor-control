# Reaction methods — design proposal

Status: **draft for discussion** (last reviewed 2026-10-22). Nothing here is built yet. Decisions, priorities and the build order live in [DESIGN.md](DESIGN.md): the record of what happened comes first and methods are optional (D10); every reaction runs under a reaction ID on a station (D14, D23). Example: [`examples/methods/dropwise-addition.reactor.json`](../examples/methods/dropwise-addition.reactor.json).

## Goals

1. A method says **what the reaction needs** (equipment by capability, not by model) and **what to do over time**, one lane per piece of equipment.
2. **People run methods and adjust them on the fly.** Every adjustment is allowed (within limits), shown, and recorded.
3. **Manual work is a method too.** Everything done on the control page is captured and can be saved as a method, re-imported and run again.
4. **Equipment is modular and substitutable.** Before a run, the app checks that the page has what the method needs and suggests which unit fills which role. A EUROSTAR 100 can stand in for a EUROSTAR 60 when the method's ranges allow it.
5. Methods can be written anywhere — a notebook, a text editor, another app — and loaded into the control page.

## One idea underneath: everything is an event log

The app already logs every command it sends. A **run record** is that log plus method context:

```
t=0:00    run started from "Dropwise addition at 60 °C"   (or: manual session)
t=0:00    heater.temp := 60        source: method step heater#1
t=0:00    stirrer.speed := 200     source: method step stirrer#1
t=3:12    stirrer.speed := 450     source: Nicolaas (override, replaces ramp target 400)
t=11:40   gate heater.hot reached  probe 58.1 °C
t=11:41   prompt "Add 5.0 g substrate" confirmed by Nicolaas, mass added = 5.03 g
t=11:41   reagentA dose 10 mL @ 0.5 mL/min started
t=20:02   reagentA paused          source: Nicolaas
...
```

- **Running a method** = the run engine writes events whose source is a method step.
- **Adjusting** = a person writes events whose source is them; the engine treats them as overrides.
- **Manual control** = only person-sourced events.
- **"Save as method"** = turn a run record back into a method (see below).

Because the same record covers all three, one recorder, one CSV/JSON export and one importer serve every case.

## Method file

JSON, extension `.reactor.json`, versioned by `"format"`. JSON because the browser reads it natively, every notebook language writes it, and a JSON Schema can validate it anywhere. (YAML could be accepted later as an authoring convenience.)

| Section | Purpose |
| --- | --- |
| `name`, `description`, `author`, `created` | Shown in the run header and stored with the run |
| `equipment` | Named **roles** (`heater`, `stirrer`, `reagentA`) and what each role needs |
| `limits` | Hard caps for this method, on top of the device and page limits |
| `lanes` | One step list per role, run in parallel |
| `prompts` | Human actions the method waits for (add solid, take a sample, check colour) |
| `onAbort` | What Stop/abort does per role (e.g. stop the pump, turn the heater off, keep stirring) |

### Equipment: roles, capabilities, fuzzy matching

A method never says "port 3" or "eurostar60-1". It names roles and describes them:

```json
"stirrer": {
  "kind": "overhead-stirrer",
  "needs": { "setpoints": { "speed": { "min": "<=200", "max": ">=600" } } },
  "prefer": ["eurostar60", "eurostar100"]
}
```

- `kind` is a family every driver declares (`overhead-stirrer`, `hotplate`, `pump-channel`, later `thermostat`, `balance`, `pH`…).
- `needs` lists the setpoints and readings the lanes use, with the range actually required. A EUROSTAR 100 matches if its speed range covers 200–600 rpm.
- `prefer` orders candidates when several units qualify; it is a hint, not a requirement.
- `check` holds things the app can read but the method cannot set (tubing ID on a pump channel). A mismatch is a warning the person acknowledges.
- A pump **channel** is a role, so one 4-channel pump can fill `reagentA`, `reagentB` and `quench`.

**Setup check** (before Start): the app matches roles to units on the page and shows one row per role:

| Role | Assigned | Result |
| --- | --- | --- |
| heater | Hotplate (RET control-visc) | ✓ exact (preferred) |
| stirrer | Stirrer (EUROSTAR 100 control) | ✓ compatible: its speed range covers 200–600 rpm |
| reagentA | Pump · Ch 1 | ⚠ tubing 1.52 mm, method expects 1.02 mm |
| quench | — | ✗ no free pump channel |

The person can reassign any row from a dropdown of qualifying units. Start is blocked only by ✗ rows. The final assignment is stored in the run record, so a rerun can offer "same as last time".

To make this work, modules declare what they are (`kind`, plus the ranges they already have), so matching needs no per-model code. A module for a near-identical model (EUROSTAR 100) is then just a copy with different ranges and the same `kind`.

### Roles are filled by functions (built 2026-10-26)

Every module now splits a unit into **functions** (DESIGN D47): one section of its card each, with that
function's readings, setpoints, switch and safety rules together. A role is filled by **one function of one
unit**, which is what the card already shows:

| Role (example) | Filled by | Section on the card holds |
| --- | --- | --- |
| `heater` | Hotplate › **Heating** | probe, plate, safety limit · Temperature · Heater · 7 safety rules · solvent list |
| `stirrer` | Stirrer › **Stirring** (or Hotplate › **Stirring**) | speed, torque · Speed · Motor · torque limit · Watched by |
| `reagentA` | Pump › **Ch 1** | flow, dispensed, tubing · Flow · Pump · volume limit |
| `balance` | Hotplate › **Weighing** | mass, tare |

So a method's `heater.temp` resolves to *Hotplate › Heating › Temperature*, `stirrer.on` to *Stirrer ›
Stirring › Motor*, `reagentA.flow` to *Pump › Ch 1 › Flow*. Function keys are stable (`heating`, `stirring`,
`ch1`) and are what a run record stores next to the unit. While a method runs, the role's lane will show
in that function's section (current step, next step, gate, Hold), next to the controls a person uses to
adjust it, and the function's **safety rules stay in force**: a safety stop holds that lane and asks the
person, like any other override.

Still to do for matching: capabilities are declared per module today (`provides`: `stirrer`,
`overhead-stirrer`, `hotplate`, `pump`); roles need them **per function** (`kind` on each function: the
RET's Heating is a `hotplate`, its Stirring a `magnetic-stirrer`, each pump channel a `pump-channel`).

### Steps

Each lane is a list of steps, run in order. Proposed step types:

| Step | Meaning | Example |
| --- | --- | --- |
| `set` | Change setpoints/switches now | `{ "do": "set", "temp": 60, "on": true }` |
| `ramp` | Move a setpoint linearly over a time | `{ "do": "ramp", "speed": 400, "over": "5 min" }` |
| `hold` | Keep current values for a time or until an event | `{ "do": "hold", "for": "30 min" }` |
| `until` | Wait for a reading condition (a **gate**), with a timeout | `{ "do": "until", "reading": "probe", "op": ">=", "value": 58, "timeout": "45 min" }` |
| `wait` | Wait for another lane or a prompt | `{ "do": "wait", "for": "until:charged" }` |
| `dose` | Pump a volume at a rate (pump-channel roles) | `{ "do": "dose", "volume": 10, "rate": 0.5 }` |
| `mark` | Put a named event on the timeline | `{ "do": "mark", "id": "sample-1" }` |

Steps can carry an `id`; other lanes and prompts refer to `lane.id` (`heater.hot`, `reagentA.done`). Durations are strings with units (`"90 s"`, `"5 min"`, `"1.5 h"`) so files stay readable.

Gates are what make methods robust to real chemistry: "dose when the probe reaches 58 °C" rather than "dose at minute 12". Every gate has a timeout and a timeout action (`prompt`, `skip`, `abort`).

### Prompts

Prompts are steps for people. The run waits (only the lanes that depend on it) until someone confirms. A prompt can ask for values (`"record": ["mass added (g)"]`) that go into the run record as data, next to the instrument data.

## Running with people in the loop

The run view shows the lanes on the shared time axis (as the live chart does): past as recorded, future as planned, a "now" line. The device cards stay usable during a run. What a person can do, and how the engine treats it:

| Action | Effect | Recorded as |
| --- | --- | --- |
| Change a setpoint on a card | **Override**: holds until the lane's next `set`/`ramp`, which the run view flags ("next step will change 450 → 400 rpm — keep 450?") | override, old/new value |
| Keep an override | The value replaces that parameter in the rest of the lane (e.g. "keep 450 rpm for the rest of the run") | override (sticky) |
| Pause a lane / pause all | Timers stop, setpoints stay, pumps stop (pump channels pause by stopping) | pause / resume |
| Extend / shorten the current hold | Moves the rest of the lane | edit step |
| Skip step / jump to step | Ends the current step now | skip |
| Release gate now | Treats an `until` as reached | gate forced |
| Take a role manual | The lane detaches; the method waits at that lane's next step until "hand back" | manual / resume |
| Edit the rest of the method | Insert, delete or change future steps in a side panel | method edit (diff) |
| Stop all | Runs `onAbort`, ends the run | abort |

Rules that keep this safe and predictable:

- Method `limits`, page limits and device ranges all apply to overrides too.
- The engine never silently undoes a person's change: anything that would overwrite an override is announced first.
- The run never continues past a prompt or gate on its own unless a timeout action says so.
- If a unit disconnects, its lane pauses and the run shows it; other lanes continue only if they do not `wait` on it.

## Manual sessions → methods

Every reaction is recorded from the moment its reaction ID is entered, whether or not a method is used (D14, D23). From any reaction record:

**Save as method** produces a `.reactor.json` with:

- `equipment` built from the units used, generalized to capabilities: a stirrer used at 200–450 rpm becomes `"kind": "overhead-stirrer", "speed": { "min": "<=200", "max": ">=450" }`, with the actual model as `prefer`. So a manual session on a EUROSTAR 60 replays on a EUROSTAR 100.
- `lanes` with one `set` per change at its time offset (`hold` between them). Notes become `mark` steps; terminal commands are listed as comments, not replayed.
- An optional **tidy** pass, offered as checkboxes: merge setpoint changes made in quick steps into a `ramp`; replace "waited until the probe read 60 °C" with an `until` gate (the app can suggest it when a change follows a reading crossing a round value); turn notes like "added substrate" into `prompt`s.

**Save run as method** does the same for a method run, keeping the original steps and folding in the overrides that were kept. Each saved method records where it came from (`"derivedFrom": { "run": "...", "method": "..." }`), so a family of edited versions can be traced.

## Getting methods in and out

| Way | How | When |
| --- | --- | --- |
| Open a file | Drag a `.reactor.json` onto the page, or File → Open | Now; works offline and on the Pi |
| Paste | Paste JSON into a dialog | Quick edits, chat, email |
| Link | `…/reactor-control/?method=<URL>` loads a method from a GitHub raw URL or gist | Sharing a fixed version; kiosk on the Pi |
| Notebook | A small Python package (`reactor_method`) builds and validates the JSON; `m.save("x.reactor.json")` or `m.link()` | Designing and sweeping conditions |
| Schema | `reactor-method.schema.json` published with the app | Any language/app can validate before loading |
| Later: sync | With login, methods and runs live in a shared store | Team use |

Notebook sketch:

```python
from reactor_method import Method, minutes

p = Method("Dropwise addition at 60 °C")
heater  = p.role("heater",   kind="hotplate",         needs={"temp": (None, 80)})
stirrer = p.role("stirrer",  kind="overhead-stirrer", needs={"speed": (200, 600)}, prefer=["eurostar60", "eurostar100"])
reagent = p.role("reagentA", kind="pump-channel",     needs={"flow": (None, 1)}, check={"tubing": 1.02})

heater.set(temp=60, on=True).until("probe", ">=", 58, timeout=minutes(45), id="hot")
stirrer.set(speed=200, on=True).ramp(speed=400, over=minutes(5))
charged = p.prompt("Add 5.0 g substrate, then confirm.", after=heater["hot"], record=["mass added (g)"])
reagent.wait(charged).dose(volume=10, rate=0.5, id="done")

p.save("dropwise.reactor.json")
```

Run records export the other way (JSON + the existing CSV), so a notebook can load a run, compare it with the plan, tweak and save a new method.

## Build order

See the roadmap in [DESIGN.md §10](DESIGN.md#10-roadmap): the reaction record and package come first; the run engine, setup check and live plan editing follow.

## Open questions

- Should overrides default to "this step only" or "rest of run"? (Proposal: this step, with a one-click "keep".)
- Who confirms prompts — anyone at the page, or should runs record a person (needs login)?
- Pump direction: should methods be able to set it, or is it a setup fact checked like tubing?
- Should a method be able to require a specific calibration (e.g. pump channel calibrated within 30 days)?
- Units in files: fixed per quantity (°C, rpm, mL, mL/min), or allow `"60 °C"` strings everywhere?
