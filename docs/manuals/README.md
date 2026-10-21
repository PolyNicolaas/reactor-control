# Device manuals

One folder per device model. Each holds the manufacturer's manual (PDF) and a `notes.md` with our annotations: the facts the app relies on, with page references, and what we found on the bench.

| Device | Folder | Manual | Interface section |
| --- | --- | --- | --- |
| IKA EUROSTAR 60 control (also 100 control) | [eurostar-60-control](eurostar-60-control/notes.md) | Operating instructions 20000003965c (03/2018), 21 pages, EN | PDF p. 17 |
| IKA RET control-visc | [ret-control-visc](ret-control-visc/notes.md) | Operating instructions 20000004159 (04/2019), 136 pages, multilingual (EN from p. 20) | PDF p. 31–33 |

## Where the PDFs are

The PDFs are IKA's copyrighted documents, and this repo is public (needed for free GitHub Pages), so they are **not committed**. `.gitignore` excludes `docs/manuals/**/*.pdf`. Get them into the folders with:

```bash
./scripts/get-manuals.sh
```

The script downloads each manual from the source listed in its `notes.md` and checks the SHA-256 so everyone annotates the same edition. If a link dies, download the manual from IKA and drop it in the folder under the same file name.

## How to annotate

Annotations go in `notes.md`, not in the PDF, so they are versioned, reviewable in pull requests, and searchable.

- **Cite the page.** Write `p. 31` for the PDF page number (what a PDF viewer shows), not the printed page number.
- **Command table.** Every command the app uses has a row with a status:
  - `manual` — documented in the manual, not yet tried on our unit
  - `bench ✓` — tried on our unit; add the date and firmware (`IN_SOFTWARE` reply)
  - `differs` — our unit behaves differently from the manual; describe how
- **Bench log.** Add dated entries at the bottom: what you tried, the exact reply, and what changed in the app.
- **Questions.** Open items go in the Questions list so they are not lost.
- If you want to mark up a PDF directly, save it beside the original as `<name>-annotated.pdf` (also not committed).

## Adding a device

Copy `_template/` to a new folder named after the model (`kebab-case`), add the manual, fill in `notes.md`, add the manual's URL and checksum to `scripts/get-manuals.sh`, and add a row to the table above. Then write the driver in `src/devices/`.
