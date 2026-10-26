# Working on Reactor Control

- **Keep `docs/DESIGN.md` true to the code.** Every commit that changes behaviour updates it in the same commit:
  - §3 "What is recorded and saved" whenever recording, storage, exports or packages change
  - §4 when the architecture changes
  - §5 for every new decision (dated, with the reason; never delete, supersede instead)
  - §10–§14 as roadmap items, ideas, limitations and open questions move
  - §15 "Hotplate safety" whenever an interlock rule, a default, the HOT state or the solvent list changes
  - the "Last reviewed" date at the top
- Keep `README.md` (setup, code map) and `docs/MODULES.md` (generated from `docs/modules.json`) in step too.
- Device facts come from the manual: cite the page in `docs/manuals/<module>/notes.md`.
- Devices are **modules**: one folder in `src/modules/<id>/` (module.ts, safety.ts, sim.ts, tests, README.md). Follow `src/modules/README.md`; keep each module's README true to its code, since modules are how people learn to write new ones. Every safety rule gets a test where it trips and one where it must not.
- Run `npm test` and `npm run build` before pushing; `main` runs the tests and deploys to GitHub Pages.
