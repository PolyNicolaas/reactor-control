# RET control-visc — how this module is built

IKA hotplate stirrer: plate to 340 °C, external PT100 probe, magnetic stirring, viscosity trend,
built-in balance. **The fullest module** — read the [EUROSTAR module](../eurostar-60-control/) first.
Manual facts with pages: [`docs/manuals/ret-control-visc/notes.md`](../../../docs/manuals/ret-control-visc/notes.md).
The safety design is described in full in [`docs/DESIGN.md` §15](../../../docs/DESIGN.md).

| File | What it shows |
| --- | --- |
| [`module.ts`](module.ts) | Readings valid only in some states (`validWhen`), a reading the unit gives only after a keypress (`optional`), software tare (`tareable`, `stable`), `hot`, `cautions`. |
| [`safety.ts`](safety.ts) | Seven rules: two static limits, four that read history (one learns), one that watches another module. Shared helpers at the top. |
| [`solvents.ts`](solvents.ts) | A caution list: data with sources, flagged against live values, with a one-click adjustment. |
| [`sim.ts`](sim.ts) | Plate driven by how far the probe is from setpoint, like the unit; `SIM_PROBE_OUT 1` reproduces the runaway the rules must catch. |
| [`ret-control-visc.test.ts`](ret-control-visc.test.ts) | Each rule on timelines (trips / must not), the rule arming when a stirrer joins the page, a trip and reset on the simulator, HOT, the solvent list. |

## Choices, and why

- **The probe drives the plate.** With the PT100 plugged in, `OUT_SP_1` sets the *medium* temperature and
  the unit heats the plate as hard as it takes. That is why most of `safety.ts` exists.
- **`provides: ['hotplate', 'heater', 'stirrer', 'magnetic-stirrer']`**: its magnetic stirring counts as
  stirring for the pump's *Dose only while stirring* rule; it is not an `overhead-stirrer`.
- **Balance**: no remote tare or weighing start exists, so the app tares in software; `0.0` means "not
  weighing"; mass is blank while heating or stirring (bench 2026-10-22, manual p. 25, 35).
- **pH is not polled**: the unit reports a plausible value with no electrode fitted (bench 2026-10-22).
- **Keep the unit's "Eurostar control" setting off** (manual p. 26); the app's *Overhead stirring* rule does that job, visibly.
- **Watchdog** documented (p. 31) but not used until bench-tested; it is the only protection that works if the Pi dies.

## Safety rules

| # | Rule | Trips when | Default |
| --- | --- | --- | --- |
| 1 | Plate maximum | plate above the maximum | 250 °C |
| 2 | Plate above setpoint | plate more than N above setpoint and not cooling | 30 °C |
| 3 | Probe responds | plate ≥ 40 °C above probe, and the probe rose less than 3 % of that gap in 5 min | 40 °C · 5 min · 3 % |
| 4 | Probe drop | probe falls ≥ 10 °C in 2 min, setpoint unchanged, heating | 10 °C |
| 5 | Probe present | probe reading lost 10 s while heating, after one was seen | — |
| 6 | Steady gap | plate–probe gap grows N past the gap learned at setpoint, for 30 s | 15 °C |
| 7 | Overhead stirring *(with overhead-stirrer)* | the overhead stirrer stops or stops answering while heating, for N s | 5 s |

Rules 1–2 are the floor; 3–7 only add trips. Every rule's live line and its *why* are on the card.
The unit's own safety limit (set on the unit, read as "Safety limit") is the hardware backstop.

## Still to check on the bench

Plate overshoot in normal heat-ups (sets rules 2–3); how far a cold addition drops the probe (rule 4);
reflux onset against rule 6; what the unit reports with the probe unplugged; the watchdog.
