# Reaction methods — design proposal

Status: **design decided, not built** (last reviewed 2026-10-27). The editor and run behaviour were chosen and tested in a prototype (board D on the *Method editor concepts* canvas; DESIGN D50–D56); the file format below follows it (format 0.2, step-based). Nothing is built into the app yet. Decisions, priorities and the build order live in [DESIGN.md](DESIGN.md): the record of what happened comes first and methods are optional (D10); every reaction runs under a reaction ID on a station (D14, D23). Example: [`examples/methods/dropwise-addition.reactor.json`](../examples/methods/dropwise-addition.reactor.json) (0.2); the earlier lane-based draft is kept as [`dropwise-addition.v0.1-lanes.reactor.json`](../examples/methods/dropwise-addition.v0.1-lanes.reactor.json) for reference.

## Goals

1. A method says **what the reaction needs** (equipment by capability, not by model) and **what to do over time**, as a list of steps; in each step every role keeps, sets, ramps, turns off or doses, and the step says when to go on.
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
| `steps` | The method, in order: what each role does in the step and when to go on (below) |
| `onAbort` | What Stop/abort does per role (e.g. stop the pump, turn the heater off, keep stirring) |

**Format 0.2 (2026-10-27) replaces the 0.1 draft's `lanes` and `prompts`** (one step list per role, joined by
gates): the editor chosen in testing is a table of steps under the curves (D50), and every change is a
step boundary (D53), so one step list says everything and reads like the table. Prompts are now a kind of
"go on when".

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
- `needs` lists the setpoints and readings the steps use, with the range actually required. A EUROSTAR 100 matches if its speed range covers 200–600 rpm.
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
`ch1`) and are what a run record stores next to the unit. While a method runs, the role's column and curve will show
in that function's section (current step, next step, gate, Hold), next to the controls a person uses to
adjust it, and the function's **safety rules stay in force**: a safety stop holds the run at that step and asks the
person, like any other override.

Still to do for matching: capabilities are declared per module today (`provides`: `stirrer`,
`overhead-stirrer`, `hotplate`, `pump`); roles need them **per function** (`kind` on each function: the
RET's Heating is a `hotplate`, its Stirring a `magnetic-stirrer`, each pump channel a `pump-channel`).

### Steps

A step is one row of the editor's table: a stretch of time where nothing changes except ramps.

```json
{ "name": "Dose reagent A", "do": { "reagentA": { "dose": "10 mL", "rate": "0.5 mL/min" } }, "goOnWhen": "dose" }
```

**`do`: what each role does.** A role not named keeps what it was doing.

| Value | Meaning | Card / table |
| --- | --- | --- |
| *(absent)* or `"keep"` | Keep as before | **Keep** |
| `{ "set": 60 }` | Set the value and switch the function on | **Set** |
| `{ "ramp": 400, "from": 200 }` | Ramp linearly over the step to the value (`from` optional: else from the current value) | **Ramp** |
| `"off"` | Switch the function off | **Off** |
| `{ "dose": "10 mL", "rate": "0.5 mL/min" }` | Pump channels: dose exactly this volume at this rate; the pump stops when it is in | **Dose** |

**`goOnWhen`: when the step ends.** One per step.

| Value | Meaning | Chip |
| --- | --- | --- |
| `{ "time": "5 min" }` | After this long (the step's own clock: it stops during a hold) | **Time** |
| `{ "reading": "heater.probe", "atLeast": 58 }` (or `atMost`) | When a reading gets there; the step's `estimate` is used for planning | **Probe** |
| `{ "person": "Add 5.0 g substrate…", "record": ["mass added (g)"] }` | When a person confirms; recorded values go into the run record | **Person** |
| `"dose"` | When the step's dose is in; its time is ≈ volume ÷ rate | **Dose** |

Waiting steps (reading, person) may add `"timeout": "45 min"` with `"onTimeout": "ask" | "goOn" | "abort"`
(default `ask`). Durations are strings with units (`"90 s"`, `"5 min"`, `"1.5 h"`). A "do X at a set time"
is written by splitting a step at that point (D53). Planned additions, documented but not decided
(D49): ramp by rate (`{ "ramp": 80, "rate": "2 °C/min" }`), closed-loop control, more gates — see
*Control variables* below.

## Control variables (to decide, 2026-10-26)

What a method can command, how a target may change over time, what the app may control in a loop, and
what a step may wait for. "Unit" = the instrument does it itself (keeps working if the Pi or browser dies);
"app" = the app does it every poll (stops with the page: the unit then holds its last setpoint).
**Status: documented to consider; implement later** (DESIGN D49). Nothing here is built or scheduled; it is the list to decide from when methods are built.

### 1. Direct setpoints and switches (what each function takes)

| Function | Variable | Unit | Who | Notes |
| --- | --- | --- | --- | --- |
| Heating (RET) | `temp` — medium temperature with the probe in, plate temperature without | °C | unit | The plate runs as hot as it takes; the safety rules (§15) bound it |
| Heating | `on` | — | unit | |
| Heating | plate cap for this run | °C | app | = the *Plate maximum* rule's setting; a method could set it from its solvents (autoignition list) |
| Stirring (EUROSTAR) | `speed`, `on` | rpm | unit | 30–2000 rpm |
| Stirring (EUROSTAR) | **torque limit** `OUT_SP_5` | Ncm | unit | In the manual, not used yet. A unit-side limit keeps working without the Pi; complements the app's *Torque limit* rule. Bench: what the unit does at the limit (stop, error 4?) |
| Stirring (EUROSTAR) | direction `OUT_MODE_1/2` | — | unit | Setup fact or method variable? (also pump direction) |
| Stirring (RET) | `speed`, `on` | rpm | unit | 50–1700 rpm, magnetic |
| Pump channel | `flow`, `on` | mL/min | unit | Rate × time = dispensed (estimate until calibrated) |
| Pump channel | **dose volume** (pump's Volume mode) | mL | unit | The pump stops itself at the volume: safer than the app timing it (DESIGN §11) |
| Pump channel | direction `nJ`/`nK` | — | unit | Same question as the stirrer |

### 2. How a target changes over time

| Shape | Parameters | Who | Notes |
| --- | --- | --- | --- |
| Step | value | unit | Today's behaviour |
| **Ramp by rate** | end value, **rate** (°C/min, rpm/s, mL/min per min) | app | The rate chemists think in ("heat at 2 °C/min to 80 °C"). The app moves the setpoint every poll. |
| Ramp by duration | end value, time | app | Already in the step list (`"over": "5 min"`); a rate is derived from it |
| On-unit ramp (RET `RMP_*`) | segments | unit | Only in an older RET manual; untested on ours. Would survive a Pi crash. Bench `RMP_IN_1` first |
| Soak / profile | list of (value, ramp, hold) | app | A sequence of ramps and holds; just steps |
| Max ramp rate (limit) | per variable | app | A method or page limit: no step may change temperature faster than N °C/min (glassware, exotherms) |

Ramps must agree with the safety rules: during a heating ramp the setpoint trails the end value, so
*Plate above setpoint* (plate > setpoint + 30 °C) can trip while the plate leads a fast ramp. Options:
compare against the ramp's end value, or widen the margin while ramping. To decide.

### 3. Closed loops the app could run (one reading drives another setpoint)

| Loop | Reads | Adjusts | Use | Notes |
| --- | --- | --- | --- | --- |
| **Constant torque** | stirrer torque | stirrer speed | Viscous mixtures, polymerisations: keep shear/torque constant as the mixture thickens | No serial torque mode on the EUROSTAR (only on its own panel), so the app does it: slow loop (1 s polls), speed bounded by min/max, rate-limited. Torque units/meaning still to confirm on the bench (notes.md) |
| Speed-on-viscosity | RET viscosity trend | RET stirrer speed | Same idea on a magnetic stirrer | The trend needs a constant set speed (manual), so it cannot drive speed directly — probably a gate only |
| **Feed on temperature** | probe | pump flow (pause or scale) | Exothermic additions: dose only while the probe stays below a limit; pause and resume | The classic semi-batch safety pattern; cheap to build (pause/resume, no tuning) |
| Feed on torque | torque | pump flow | Stop adding when the mixture gets too thick | |
| Heat on another probe | EUROSTAR PT100 (in flask) | RET setpoint | When the RET probe is in a bath and the EUROSTAR probe in the flask | Cascade control; needs care (lag) |

Every loop needs: target, bounds (min/max of what it adjusts), a maximum step per poll, what happens if
the reading is lost (hold last value, or stop), and a record of every adjustment (source: the loop).

### 4. Gates and endpoints (what a step can wait for)

| Gate | Example | Notes |
| --- | --- | --- |
| Reading reaches a value | probe ≥ 58 °C | In the step list (`until`) |
| Reading stable | probe within ±0.5 °C for 3 min | "At temperature" without guessing a time |
| Torque reaches / plateaus | torque ≥ 25 Ncm; torque change < 2 % over 10 min | Polymerisation / thickening endpoints |
| Viscosity trend changes | trend +20 % from start | Needs constant speed while measured |
| Volume dispensed | reagentA ≥ 10 mL | From the pump channel |
| Mass (RET balance) | added ≥ 5.0 g | Only with heating and stirring off (manual p. 25): a pause step, not a live gate |
| Time | 30 min | `hold` |
| Person confirms | "added the solid" | `prompt`, can record values |

### 5. Per-method limits

Caps that apply during a run on top of device ranges, page limits and safety rules: max temperature,
max plate, max speed, max torque, max flow, max total volume per channel, max ramp rate. A method may only
tighten the page's safety settings, never loosen them (same principle as the rules).

### Questions to settle

- Ramp rate as the primary way to write ramps (`"rate": "2 °C/min"`) with duration as the alternative?
- Constant-torque control: do we need it soon (polymerisations), or is a torque gate enough at first?
- Feed-on-temperature: pause/resume only, or proportional slowing?
- Use the EUROSTAR's own torque limit (`OUT_SP_5`) as a unit-side backstop for the app's torque rule?
- Which loops must survive a Pi failure, and can they (unit-side features: RET ramps, pump Volume mode, torque limit)?

## Editor and run decisions (2026-10-27)

Prototype: board **D** (restyled 2026-10-27 to match the device cards: Keep / Set / Ramp / Off / Dose and Time / Probe / Person / Dose are chip rows, the chosen chip filled in the function's colour, waits in purple; row tools appear on the selected step only) ("Curves with a step table") on the *Method editor concepts* canvas — C's
curves on top of a B-style step table. **The table is the method; the curves are drawn from it**, and
editing either updates the other. Chosen over A (lanes), B (steps) and C (profiles) on 2026-10-26.
Each decision below was made after weighing the options and is implemented and tested in D
(DESIGN D50–D54).

**Shape of a method.** A list of steps. In each step every function (Heating, Stirring, Ch 1 …) is
*Keep as before*, *Set to*, *Ramp to*, *Off*, or for pump channels *Dose*. Each step says when to go on:
*the time is up*, *the probe reaches*, *a person confirms*, or *the dose is done*. A step's time counts from
the end of the step before it. In edit and run, the same step strip, curves and colours: the plan is
solid while editing, dashed while running with the measured values drawn solid over it.

| # | Question | Decision | Why / consequence |
| --- | --- | --- | --- |
| 1 | What does **Hold** do? | **Freeze the step's clock and pause dosing.** Heating and stirring keep their current values; ramps freeze where they are; a waiting step does not move on while held; Resume continues. The chart shades the hold and the step stretches. | Planned volumes stay exact and a held run is safe to walk away from. Switching heating or stirring off would change the chemistry: that is Stop. |
| 2 | How long does a **change by hand** last? | **Until the method next speaks about that function**: through *Keep* steps, ending at the first later step that sets, ramps, turns off or doses it (or when a dose completes). The plan redraws to include it, the table marks it "by hand", **Back to method** cancels it, and its start and end are recorded. A change during a ramp stops the ramp at the new value. | Matches "I've taken over the heat until the method says something about heat again". A faster pump in one dose does not leak into later doses; nothing is silently undone. Supersedes the "holds until the lane's next set/ramp; Keep makes it sticky" proposal in *Running with people in the loop*. |
| 3 | How is "**do X at a set time**" written? | **Every change is a step boundary.** A step is a stretch where nothing changes except ramps; every corner in a curve is a step boundary. **Split** (shift-click or right-click a step in the strip, or the row's Split button) cuts a step at that point: the first part keeps the step's changes and becomes timed, the second keeps everything and inherits the step's wait; a ramp is cut so the curve is unchanged. **Merge ↓** undoes it, and is refused when the next step changes something (that change would move earlier). | One clock, one rule, a flat table that always lines up with the chart. Absolute-time events were rejected: they fire whatever the reaction's state (before the substrate is in, during a hold). Repeated actions ("sample every 30 min") need a repeat feature later. A scheduled start is a separate feature. |
| 4 | How is a **volume** dosed? | **Dose X mL at Y mL/min**, a pump-channel mode; the step goes on when the volume is in, and its time is ≈ volume ÷ rate. Hand rate changes, holds and safety pauses change only how long it takes; the last bit is metered so the volume is exact. *Set to* stays for open-ended pumping. **Next (after a bench test):** the Reglo counts the volume itself (Volume mode), so it stops on its own if the Pi fails; the table and chart do not change. | The method's volume is what goes in. Today's count is the app's (rate × time while pumping), as good as the channel's calibration. The volume-limit safety rule stays as the backstop. |
| 5 | How does the **time axis** behave? | **Planned length + 25 %, to a clean 10 min**, the same in edit and at Start; during a run it grows only when now or the shifted plan passes the right edge, and then by another 25 %. | Edit and run line up, and the chart rarely rescales (a 30-min hold in a 65-min method rescaled once, 90 → 120 min). Long methods will later want a zoom on top. |

Also from testing D (2026-10-26/27): setpoint changes, step lengths, ramps, prompts with a recorded value,
reorder/insert/delete, dot and edge dragging and double-click setting all round-trip between table and
curves; the "Pause simulation" button belongs to the prototype only.

## Running with people in the loop

The run view is the editor's own picture (D50): the step strip and curves on one time axis, the plan dashed with the measured values drawn solid over it, a "now" line, and the step table with the current step highlighted. The device cards stay usable during a run. What a person can do, and how the engine treats it:

| Action | Effect | Recorded as |
| --- | --- | --- |
| Change a setpoint on a card | **Override** until the method next sets, ramps, turns off or doses that function (decision 2, 2026-10-27); Back to method cancels it | override, old/new value, and when it ended |
| Hold | The step's clock stops, heating and stirring stay, dosing pauses (decision 1, 2026-10-27) | hold / resume, with its length |
| Extend / shorten the current step | Moves the rest of the method | edit step |
| Skip step / jump to step | Ends the current step now | skip |
| Release gate now | Treats an `until` as reached | gate forced |
| Take a function by hand | A change by hand; the method takes it back where it next speaks about that function, or on Back to method | override |
| Edit the rest of the method | Insert, delete or change future steps in a side panel | method edit (diff) |
| Stop all | Runs `onAbort`, ends the run | abort |

Rules that keep this safe and predictable:

- Method `limits`, page limits and device ranges all apply to overrides too.
- The engine never silently undoes a person's change: anything that would overwrite an override is announced first.
- The run never continues past a prompt or gate on its own unless a timeout action says so.
- If a unit disconnects, the run holds and shows it (to decide in detail with the run engine).

## Manual sessions → methods

Every reaction is recorded from the moment its reaction ID is entered, whether or not a method is used (D14, D23). From any reaction record:

**Save as method** produces a `.reactor.json` with:

- `equipment` built from the units used, generalized to capabilities: a stirrer used at 200–450 rpm becomes `"kind": "overhead-stirrer", "speed": { "min": "<=200", "max": ">=450" }`, with the actual model as `prefer`. So a manual session on a EUROSTAR 60 replays on a EUROSTAR 100.
- `steps`: every change starts a new step (D53) with `goOnWhen.time` = the time until the next change. Notes become step names; terminal commands are listed as comments, not replayed.
- An optional **tidy** pass, offered as checkboxes: merge setpoint changes made in quick steps into a `ramp`; replace "waited until the probe read 60 °C" with a reading `goOnWhen` (the app can suggest it when a change follows a reading crossing a round value); turn notes like "added substrate" into person `goOnWhen`s.

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
from reactor_method import Method

m = Method("Dropwise addition at 60 °C")
m.role("heater",   kind="hotplate",         needs={"temp": (None, 80)})
m.role("stirrer",  kind="overhead-stirrer", needs={"speed": (200, 600)}, prefer=["eurostar60", "eurostar100"])
m.role("reagentA", kind="pump-channel",     needs={"flow": (None, 1)}, check={"tubing": 1.02})

m.step("Heat and stir up", heater=60, stirrer=m.ramp(400, start=200), go_on=m.time("5 min"))
m.step("Reach temperature", go_on=m.reading("heater.probe", at_least=58), estimate="7 min")
m.step("Add the substrate", go_on=m.person("Add 5.0 g substrate", record=["mass added (g)"]))
m.step("Dose reagent A", reagentA=m.dose("10 mL", rate="0.5 mL/min"))
m.step("Let it react", reagentA="off", go_on=m.time("30 min"))
m.step("Switch off", heater="off", stirrer="off", go_on=m.time("1 min"))

m.save("dropwise.reactor.json")
```

Run records export the other way (JSON + the existing CSV), so a notebook can load a run, compare it with the plan, tweak and save a new method.

## Build order

See the roadmap in [DESIGN.md §10](DESIGN.md#10-roadmap): the reaction record and package come first; the run engine, setup check and live plan editing follow.

## Open questions

- ~~Should overrides default to "this step only" or "rest of run"?~~ Decided 2026-10-27: until the method next sets that function (see *Editor and run decisions*).
- Who confirms prompts — anyone at the page, or should runs record a person (needs login)?
- Pump direction: should methods be able to set it, or is it a setup fact checked like tubing?
- Should a method be able to require a specific calibration (e.g. pump channel calibrated within 30 days)?
- Units in files: fixed per quantity (°C, rpm, mL, mL/min), or allow `"60 °C"` strings everywhere?
