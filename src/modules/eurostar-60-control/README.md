# EUROSTAR 60 control — how this module is built

IKA overhead stirrer, 30–2000 rpm, torque reading, PT100 input. **The smallest complete module; read
it first** ([guide](../README.md)). Manual facts with pages: [`docs/manuals/eurostar-60-control/notes.md`](../../../docs/manuals/eurostar-60-control/notes.md).

| File | What it shows |
| --- | --- |
| [`module.ts`](module.ts) | The nine sections; two functions (Stirring, Temperature); one setpoint/switch pair. |
| [`safety.ts`](safety.ts) | One rule: torque limit. |
| [`sim.ts`](sim.ts) | Physics only, on the shared NAMUR simulator; `SIM_JAM 1` blocks the shaft. |
| [`eurostar-60-control.test.ts`](eurostar-60-control.test.ts) | Set-vs-actual against the simulator; the torque rule on timelines and on a jammed simulator. |

## Choices, and why

- **Line end is "blank CR blank LF"** (hex 20 0D 20 0A), as the manual writes it (p. 17), not plain CR LF.
- **`identify` also matches EUROSTAR 100**: same command set; our unit answers `IKA ES 60`.
- **`provides: ['stirrer', 'overhead-stirrer']`**: the hotplate stops heating if this stirrer stops
  (RET rule *Overhead stirring*), and the pump only doses while something stirs (Reglo rule
  *Dose only while stirring*). Neither rule names this model; they look for these words.
- **`activity: stirring` above 20 rpm, driven by the Motor switch** on the speed reading: that is what other
  modules read, and what starts a camera clip when stirring starts or stops, whoever caused it. Because
  the hotplate and the pump watch it, this card shows them under *Watched by*, and Motor off asks first
  while either rule is Active.
- **Motor off, then on, does not restart until the speed is applied again** (user report 2026-10-26).
  The app does not resend the speed by itself; the card shows "Unit is set to 0 rpm, not the 400 rpm
  you applied" and Apply flashes (DESIGN D33). The simulator models it as `STOP_4` clearing the set speed.
- **No watchdog command exists** on this model: if the Pi dies the motor keeps turning. Stop all and
  removing the unit from the page both send `STOP_4`.

## Safety rules

| Rule | Trips when | Default | Why it is set so |
| --- | --- | --- | --- |
| Torque limit | torque above the limit for 3 s | off (30 Ncm when turned on) | The unit's own overload stop protects the motor, not the glassware. The right limit depends on the shaft and flask, so it is turned on and set per setup from the torque seen on a normal run. |

## Still to check on the bench

After `STOP_4`/`START_4`, does `IN_SP_4` read 0 or keep the old value? Does `RESET` stop the motor or
only hand control back? (`notes.md`, Questions.)
