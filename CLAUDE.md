# Working on Reactor Control

- **Keep `docs/DESIGN.md` true to the code.** Every commit that changes behaviour updates it in the same commit:
  - §3 "What is recorded and saved" whenever recording, storage, exports or packages change
  - §4 when the architecture changes
  - §5 for every new decision (dated, with the reason; never delete, supersede instead)
  - §10–§14 as roadmap items, ideas, limitations and open questions move
  - the "Last reviewed" date at the top
- Keep `README.md` (setup, code map) and `docs/MODULES.md` (generated from `docs/modules.json`) in step too.
- Device facts come from the manual: cite the page in `docs/manuals/<module>/notes.md`.
- New drivers get a simulator and a test in `src/test/`.
- Run `npm test` and `npm run build` before pushing; `main` runs the tests and deploys to GitHub Pages.
