# Device manuals

One folder per device model. Each holds the manufacturer's manual (PDF) and a `notes.md` with our annotations: the facts the app relies on, with page references, and what we found on the bench.

The list of modules, their manuals (edition, source URL, checksum) and their status lives in **[docs/modules.json](../modules.json)**; the readable table is **[docs/MODULES.md](../MODULES.md)**.

## Where the PDFs are

The PDFs are the manufacturers' copyrighted documents, and this repo is public (needed for free GitHub Pages), so they are **not committed**. `.gitignore` excludes `docs/manuals/**/*.pdf`. Get them into the folders with:

```bash
npm run manuals:fetch    # download missing manuals, verify SHA-256
npm run manuals:check    # find new editions, dead links, overdue feature reviews
```

The checksum makes sure everyone annotates the same edition. If a link dies, download the manual from the manufacturer, save it under the same file name, and update the URL in modules.json.

## How to annotate

Annotations go in `notes.md`, not in the PDF, so they are versioned, reviewable in pull requests, and searchable.

- **Cite the page.** Write `p. 31` for the PDF page number (what a PDF viewer shows), not the printed page number.
- **Command table.** Every command the app uses has a row with a status:
  - `manual` — documented in the manual, not yet tried on our unit
  - `bench ✓` — tried on our unit; add the date and firmware (`IN_SOFTWARE` reply)
  - `differs` — our unit behaves differently from the manual; describe how
- **Bench log.** Add dated entries at the bottom: what you tried, the exact reply, and what changed in the app.
- **Questions.** Open items go in the Questions list so they are not lost.
- **Possible features.** Commands or behaviours found outside our manual (other editions, sibling models, open-source drivers, forums), each with its source URL and confidence: `IKA doc` (in an IKA document), `code` (used in working open-source code), `claim` (forum or unverified). Move an item into the Commands table once it is tried on the bench.
- If you want to mark up a PDF directly, save it beside the original as `<name>-annotated.pdf` (also not committed).

## Adding a device

1. Add an entry to `docs/modules.json` (status `candidate` or `planned`), with the manual's URL, checksum (`sha256sum file.pdf`) and the `watch` sources to search.
2. Copy `_template/` to `docs/manuals/<id>/`, run `npm run manuals:fetch`, fill in `notes.md`.
3. Write the driver and a simulator in `src/devices/`, register it, add a test in `src/test/`, set status to `driver-ready`, then `supported` after bench testing.
4. Run `npm run manuals:index` to refresh MODULES.md.
