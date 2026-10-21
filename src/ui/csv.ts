import type { Run } from '../core/app';

const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const stamp = (t: number) => new Date(t).toISOString();

/** Wide CSV: one row per second, one column per channel (actual, setpoint read-back, switch state). */
export function samplesCsv(run: Run): string {
  const head = ['time_iso', 'elapsed_s', ...run.columns.map((c) => `${c.label} (${c.unit})`)];
  const lines = [head.map(esc).join(',')];
  for (const r of run.rows) {
    lines.push(
      [stamp(r.t), ((r.t - run.startedAt) / 1000).toFixed(1), ...run.columns.map((c) => (r.v[c.key] === undefined ? '' : String(r.v[c.key])))].join(','),
    );
  }
  return lines.join('\n');
}

/** Event log and notes, in time order. */
export function eventsCsv(run: Run): string {
  const label = (id: string) => run.devices.find((d) => d.id === id)?.label ?? '';
  const rows = [
    ...run.events.map((e) => ({ t: e.t, device: label(e.deviceId), kind: e.kind, text: e.text })),
    ...run.notes.map((n) => ({ t: n.t, device: '', kind: 'note', text: n.text })),
  ].sort((a, b) => a.t - b.t);
  return ['time_iso,elapsed_s,device,kind,text', ...rows.map((r) => [stamp(r.t), ((r.t - run.startedAt) / 1000).toFixed(1), esc(r.device), r.kind, esc(r.text)].join(','))].join('\n');
}

export function runFileStem(run: Run): string {
  const d = new Date(run.startedAt);
  const p = (n: number) => String(n).padStart(2, '0');
  return `reactor-run_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
