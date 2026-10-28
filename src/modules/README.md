# Modules — how they are built, and how to make a new one

A **module** is everything Reactor Control knows about one kind of unit (a stirrer, a hotplate, a pump):
how to talk to it, what it measures, what can be set, what keeps it safe, and a fake one to test with.
Each module is one folder here. The rest of the app (cards, polling, chart, recording, Stop all, the
safety engine) is generic and is drawn from what the module describes, so **a new unit needs a new
folder, nothing else**.

Each existing module is a worked example. Read them in this order:

| Module | Read it for |
| --- | --- |
| [`eurostar-60-control/`](eurostar-60-control/) | **Start here.** The smallest complete module: readings, one setpoint, one switch, one safety rule, simulator, tests. |
| [`ret-control-visc/`](ret-control-visc/) | Readings that are only valid in some states, software tare, eight safety rules (static, learning, one that watches another module), HOT warning, a caution list. |
| [`reglo-icc/`](reglo-icc/) | A different protocol, several channels on one card, values the app computes, safety rules generated per channel, a rule that watches *any* stirrer. |
| [`_template/`](_template/) | The skeleton to copy, every field explained. |

## What is in a module folder

```
src/modules/<module-id>/
  module.ts        the description: identity, connection, readings, setpoints, switches, stop, status, safety, simulator
  safety.ts        the module's safety rules (every module has this file, even with no rules yet)
  sim.ts           a simulated unit, so the app and the tests run without hardware
  <module-id>.test.ts   tests: the simulator, and every safety rule on made-up timelines
  README.md        how this module is built and why — the choices, with manual pages
docs/manuals/<module-id>/notes.md   facts from the manual, each with its page (kept with the manuals)
```

`<module-id>` is the same everywhere: folder, `docs/manuals/<module-id>/`, and the `id` in `docs/modules.json`.

## Making a new module, step by step

1. **Get the manual first.** Add the module to `docs/modules.json` (status `candidate`), download the
   manual (`node scripts/manuals.mjs fetch`), and copy `docs/manuals/_template/notes.md`. Write down the
   interface facts with page numbers: serial settings, line end, every command and its reply. Nothing
   goes in the code that is not in the notes.
2. **Copy `_template/`** to `src/modules/<module-id>/` and rename the exported names.
3. **Fill in `module.ts` section by section** (the template has the sections in this order):
   1. *Identity* — `model`, `displayName`, `kind`, `source` (the folder name), `groups` (the unit's
      **functions**, see below), `identify()` (match the
      reply to the identify command), and `provides`: what the unit **does** for a page, e.g.
      `['stirrer', 'overhead-stirrer']`. Other modules' safety rules find partners by these words, never
      by model name. Reuse an existing word when the unit does the same job; that is what lets a new
      stirrer be covered by the hotplate's and the pump's rules without touching them.
   2. *Connection* — `serial` and `lineEnd` from the manual; `protocol` if it is not NAMUR (see `reglo-icc`).
   3. *Readings* — one entry per value to poll. Use `activity` for a reading that means "the unit is
      doing something" (speed above 20 rpm = `stirring`): it triggers camera clips and other modules'
      rules read it.
   4. *Setpoints* — with `min`/`max` from the manual, `readCmd` to confirm the unit took it,
      `actualKey` + `switchKey` so the card shows "Set 400 · actual 398 rpm ✓".
   5. *Switches* — on/off commands; `confirmOn` for anything dangerous to start (heaters).
   6. *Stop and release* — what Stop all sends; what hands the unit back to its keypad.
   7. *Status* — one word for the card header.
   8. *Safety* — `safety` from `safety.ts` (next step), and optionally `hot` and `cautions`.
   9. *Simulator* — `simulate()` returns your `sim.ts`.
4. **Write `safety.ts`** (next section). Ask: *what can this unit do that hurts someone or ruins a
   reaction, and which reading would show it first?* If the honest answer today is "nothing the app
   can see", say so in the file and leave `rules: []` — the card then says the module has no rules.
5. **Write `sim.ts`.** IKA/NAMUR units extend `shared/namurSim.ts` and only describe physics
   (`step()`); other protocols write a small transport (see `reglo-icc/sim.ts`). Add `SIM_…` commands
   for faults your safety rules must catch (`SIM_JAM`, `SIM_PROBE_OUT`, `SIM_PIN`).
6. **Write the tests** next to the module: the simulator through a `DeviceInstance`, and every safety
   rule with `runSafety()` from `shared/testing.ts` — each rule must have a test where it trips and a
   test of the normal case where it must not.
7. **Register it** in `src/modules/index.ts`; set its status in `docs/modules.json` to `driver-ready`
   and run `node scripts/manuals.mjs index`.
8. **Write the module's `README.md`**: what the unit is, how the app drives it, each choice and why,
   what is still to check on the bench. Update `docs/DESIGN.md` (§5 decision; §15 if it adds safety rules).
9. `npm test`, `npm run build`, then try it on the bench and record what you learn in `notes.md`.

## Functions

A unit does one or more jobs: the RET heats, stirs and weighs; a pump has four channels. Each job is a
**function**, declared in `groups` and joined by every reading, setpoint and switch with `group`:

```ts
groups: [{ key: 'heating', label: 'Heating' }, { key: 'stirring', label: 'Stirring' }],
readings: [{ key: 'probe', …, group: 'heating' }, { key: 'speed', …, group: 'stirring' }],
```

The card draws one row per function holding everything about it — name and switch, readings, setpoint with
set-vs-actual, its safety rules (a rule joins the function of the switch it stops, or set
`group` on the rule), caution lists (`group` on the list), and *Watched by*. Methods address a function
(`heater` role → *Hotplate › Heating*), so keep function keys stable once used. Repeated channels of the
same kind (pump channels) set `channel: true`: the user can rename them and their names prefix labels on
the chart and in recordings. Anything left without a function goes into a last "Unit" row.

## Safety rules

A rule is one object in the module's `safety.ts`:

```ts
const myRule: SafetyRule = {
  key: 'torque',                 // unique in the module
  label: 'Torque limit',         // shown on the card
  why: 'What goes wrong without this rule, in plain words.',   // shown on the card
  switches: ['motor'],           // what a trip turns off
  settings: [{ key: 'torqueMax', label: 'Max torque', unit: 'Ncm', default: 30, min: 1, max: 60, step: 1 }],
  defaultOn: false,              // on/off toggle on the card; false when the right setting depends on the run
  required: false,               // true = cannot be turned off (the static floor)
  withPeer: undefined,           // or e.g. 'stirrer': only armed while such a module is on the page
  watchesActivity: undefined,    // with withPeer: the partner's activity it depends on, e.g. 'stirring'
  watchNote: undefined,          // with withPeer: shown on the partner's card under "Watched by"; {torqueMax} is filled in
  evaluate({ s, history, set, mem, now, peers }) {
    return { state: 'ok', text: 'Torque 12.3 Ncm · stops above 30 Ncm' };
  },
};
```

`evaluate()` runs after every poll and returns a **state** and **one line with the live numbers**:

| State | Meaning | Card label |
| --- | --- | --- |
| `off` | turned off with the rule's toggle (set by the core, not by the rule) | **Off** (grey) |
| `idle` | on, nothing to watch now (heater off, no partner module on the page) | **Standby** (grey) |
| `learning` | on, collecting data before it can judge | **Learning** (blue) |
| `ok` | on and watching, nothing wrong | **Active** (green) |
| `near` | on and watching, getting close to tripping | **Close** (amber) |
| `trip` | the unit must stop | **Tripped** (red, banner, switches off) |

On the card each rule is one row: its state, name, an **on/off toggle** (locked for `required` rules)
and its live line. Opening the row shows *why*, what it **Stops**, which module it **Watches**, and its
**settings**, edited in place; every toggle and setting change is logged. A rule never needs a
"0 = off" setting: the toggle does that.

Returning `trip` is all a rule does. The core (`src/core/device.ts`, `checkSafety`) switches the rule's
switches off, repeats it every 5 s while the condition lasts, locks them out, logs it (with a camera
clip), and only lets the user reset once the rule no longer trips. A rule that throws fails safe (trip).
A trip that cannot clear by itself (a volume that only grows) gives the rule an `onReset` that the reset
applies, e.g. Dispensed back to 0 (`reglo-icc/safety.ts`).

**Principles** — every rule in this folder follows them; keep to them in new ones:

1. **Act on readings, not on what the app switched on.** The keypad can start a unit too: judge "running" from a reading as well as the switch (see `heating()` in `ret-control-visc/safety.ts`, speed in the EUROSTAR torque rule, the pump's running reply in *Dose only while stirring*).
   A reading that is missing for one poll (a failed read is `undefined`) is not a change and not "safe": skip it in history, and if a rule depends on a reading, have a rule that trips when it stays missing while running (RET *Plate reading*).
2. **A rule may only add trips.** Keep simple static limits as the floor and put cleverer rules on top, so a wrong guess can cause a false trip but never a missed one.
3. **Explain yourself.** `why` says what goes wrong; every status line has the numbers and the threshold ("Plate 112 °C · stops above 150 °C"), so anyone can see how close it is.
4. **Don't trip on one reading.** Require a few seconds (`history`) unless one reading is already conclusive.
5. **Defaults are conservative and adjustable.** Settings have a hint and a range. Floor rules are `required`; a rule whose right setting depends on the run starts off (`defaultOn: false`). A rule that could stop a reaction for a normal action (a cold addition) says so in its hint.
6. **The rule lives with the switch it turns off.** A rule that stops the heater is in the hotplate module, even when it watches the stirrer.
7. **Test it.** One test where it must trip, one where it must not.
8. **Say what you do to others.** A rule that watches another module has a `watchNote`, so the person at that module's card knows what stopping it will do.

### Rules that know about other modules

A rule with `withPeer: 'stirrer'` is armed only while a module that `provides` `'stirrer'` is on the
page; it reads those modules through `ctx.peers` (read-only: their latest values, history, whether an
`activity` is on, and whether they answer). Rules never command another module — they stop their own.

- A module **added** to the page arms the rules that look for it at the next poll; a module **removed**
  disarms them. Both are logged ("Safety rule "Overhead stirring" armed (with Stirrer)").
- The **watched** module's card shows a **Watched by** list: every rule on another unit that depends
  on it, with that rule's state and its `watchNote` ("Stopping stirring for 5 s while the hotplate heats
  turns its heater off"). Give the partner's reading `activity: { name, above, switchKey }` and the rule
  `watchesActivity`: switching that switch off then asks for confirmation while the rule is Active.
- A **new kind of module** written later is covered by existing rules as soon as it declares the
  capability they look for. Pick `provides` words from this list (add new ones here when needed):

| Capability | Means | Provided by | Watched by |
| --- | --- | --- | --- |
| `stirrer` | something that mixes the flask; has an `activity` named `stirring` | EUROSTAR, RET | Reglo: *Dose only while stirring* |
| `overhead-stirrer` | a stirrer with a shaft in the flask | EUROSTAR | RET: *Overhead stirring* |
| `magnetic-stirrer` | stirs with a stir bar | RET | — |
| `hotplate`, `heater` | heats the flask | RET | — |
| `pump`, `dosing` | adds liquid to the flask | Reglo ICC | — |

A page is one reactor (one station), so "on the page" means "on this flask".

### Testing rules

```ts
import { runSafety, snap, peer } from '../shared/testing';

const hit = runSafety(mySafety, (t) => snap({ torque: t < 10 ? 10 : 35 }, {}, { motor: true }), 30, { set: { torqueMax: 30 } });
expect(hit.rule).toBe('torque');   // which rule tripped
expect(hit.t).toBe(13);            // at which second
```

`runSafety` feeds one made-up poll per second, keeps the history the rules expect, and returns the first
trip, or the last statuses. `peer()` makes a fake partner module for `withPeer` rules.

## Also available to a module

- `hot: { key, above }` — HOT badge on the card while that reading is hot, MAY BE HOT after a disconnect (RET plate).
- `cautions` — reference lists under a ⚠ on the card, flagged against live values (RET solvent autoignition list).
- `optional`, `validWhen`, `tareable`, `stable` on readings — for values the unit gives only sometimes (RET balance).
- `groups`, `derive()` — several channels on one card; values the app computes (Reglo).
- `initCommands`, `formatSetpoint`, `parse` — protocol details (Reglo).
- `watchdog` — documented unit watchdog, used once bench-tested.
