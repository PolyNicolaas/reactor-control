#!/usr/bin/env node
// Manual library for Reactor Control. Reads docs/modules.json.
//
//   node scripts/manuals.mjs fetch    download missing manuals into docs/manuals/<id>/, verify SHA-256
//   node scripts/manuals.mjs check    re-download every manual and report dead links or new editions,
//                                     list modules whose feature review is older than 90 days
//   node scripts/manuals.mjs index    regenerate docs/MODULES.md from docs/modules.json
//
// PDFs are not committed (manufacturers' copyright, public repo). Notes and the index are.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manualsDir = join(root, 'docs', 'manuals');
const registry = JSON.parse(readFileSync(join(root, 'docs', 'modules.json'), 'utf8'));
const REVIEW_DAYS = 90;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(0, 5).toString() !== '%PDF-') throw new Error('not a PDF (the link may now point to a web page)');
  return buf;
}

async function fetchAll() {
  let problems = 0;
  for (const m of registry.modules) {
    for (const d of m.documents) {
      const dir = join(manualsDir, m.id);
      const dest = join(dir, d.file);
      mkdirSync(dir, { recursive: true });
      if (existsSync(dest) && sha256(readFileSync(dest)) === d.sha256) {
        console.log(`ok        ${m.id}/${d.file}`);
        continue;
      }
      try {
        const buf = await download(d.url);
        writeFileSync(dest + '.part', buf);
        renameSync(dest + '.part', dest);
        const same = sha256(buf) === d.sha256;
        console.log(`${same ? 'download ' : 'DIFFERENT'} ${m.id}/${d.file}${same ? '' : '  (new edition? page references in notes.md may be off)'}`);
        if (!same) problems++;
      } catch (e) {
        problems++;
        console.log(`FAILED    ${m.id}/${d.file}: ${e.message}. Download it by hand and save it under this name.`);
      }
    }
  }
  process.exitCode = problems ? 1 : 0;
}

async function check() {
  const today = Date.now();
  for (const m of registry.modules) {
    for (const d of m.documents) {
      try {
        const buf = await download(d.url);
        const same = sha256(buf) === d.sha256;
        console.log(`${same ? 'unchanged' : 'CHANGED  '} ${m.id}: ${d.title} ${d.docNo}${same ? '' : `  new sha256 ${sha256(buf)}`}`);
      } catch (e) {
        console.log(`DEAD LINK ${m.id}: ${d.title} ${d.docNo}: ${e.message}`);
      }
    }
    const age = Math.floor((today - Date.parse(m.lastFeatureReview ?? '1970-01-01')) / 864e5);
    if (age > REVIEW_DAYS) console.log(`REVIEW    ${m.id}: feature review is ${age} days old. Check: ${m.watch.join(' | ')}`);
  }
}

function index() {
  const rows = registry.modules.map((m) => {
    const docs = m.documents.map((d) => `${d.docNo} (${d.edition}), ${d.pages} p., interface p. ${d.interfacePages}`).join('<br>');
    return `| ${m.name} | ${m.kind} | ${m.status} | ${m.driver ? `[${m.driver.split('/').pop()}](../${m.driver})` : '—'} | [notes](../${m.notes}) | ${docs} | ${m.connection} | ${m.buy} | ${m.lastFeatureReview} |`;
  });
  const md = `# Modules

Devices Reactor Control supports or plans to. **Generated from [modules.json](modules.json)** by \`node scripts/manuals.mjs index\`; edit the JSON, not this file.

| Module | Kind | Status | Driver | Notes | Manual | Connection | Buy | Last feature review |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

**Status:** supported = driver in the app and bench-tested · driver-ready = driver in the app, not yet tested on hardware · planned = decided, no driver yet · candidate = being considered.

## Keeping manuals and features current

- \`node scripts/manuals.mjs fetch\` puts every manual in \`docs/manuals/<module>/\` (PDFs are not committed).
- \`node scripts/manuals.mjs check\` re-downloads each manual and reports **CHANGED** (new edition) or **DEAD LINK**, and flags modules whose feature review is over ${REVIEW_DAYS} days old.
- A **feature review** means searching the sources in the module's \`watch\` list (manufacturer pages, other manuals of the same family, open-source drivers) for commands the manual does not list. Findings go in the module's \`notes.md\` under *Possible features* with source and confidence; then update \`lastFeatureReview\`.
- A new edition: save it, update \`docNo\`, \`edition\`, \`url\`, \`sha256\`, \`retrieved\` in modules.json, and re-check the page references in notes.md.
`;
  writeFileSync(join(root, 'docs', 'MODULES.md'), md);
  console.log('wrote docs/MODULES.md');
}

const cmd = process.argv[2];
if (cmd === 'fetch') await fetchAll();
else if (cmd === 'check') await check();
else if (cmd === 'index') index();
else console.log('usage: node scripts/manuals.mjs fetch | check | index');
