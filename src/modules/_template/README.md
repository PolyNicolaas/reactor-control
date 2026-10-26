# Template module

Copy this folder to `src/modules/<module-id>/` to start a new module, then follow
[the guide](../README.md#making-a-new-module-step-by-step).

| File | Fill in |
| --- | --- |
| `module.ts` | The nine sections, in order: identity (with the unit's functions), connection, readings, setpoints, switches, stop and release, status, safety, simulator. Put every reading, setpoint and switch in a function with `group`. |
| `safety.ts` | One rule per way the unit can hurt someone or ruin a reaction. Two examples: a static limit, and a rule that watches another module (`withPeer`). |
| `sim.ts` | The unit's physics on top of the shared NAMUR simulator (or your own transport for another protocol). |
| `template.test.ts` | Rename to `<module-id>.test.ts`. One simulator test; for every rule, one case that trips and one that must not. |
| `README.md` | Replace this file: what the unit is, how the app drives it, each choice and why (with manual pages), what is still to check on the bench. |

The template compiles and its tests run, so it stays correct as the core changes. It is not listed in
`src/modules/index.ts`, so the app does not offer it.
