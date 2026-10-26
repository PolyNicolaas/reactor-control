import type { DeviceSnapshot, ModuleSafety, PeerView, RuleStatus, Sample } from '../../core/types';

/**
 * Test a module's safety rules against a made-up timeline, one poll per second, without hardware or
 * waiting in real time. Every module's test file uses this; copy the pattern for a new module.
 *
 *   const hit = runSafety(retSafety, (t) => snap({ plate: 22 + t * 0.25, probe: 22 }), 900);
 *   expect(hit.rule).toBe('plateAbove');
 *
 * `timeline(t)` gives the unit's snapshot at second t. `peers(t)`, if given, gives the other modules
 * on the page at second t (see peer()). Returns the first trip, or rule: undefined with the last statuses.
 */
export function runSafety(
  safety: ModuleSafety,
  timeline: (t: number) => DeviceSnapshot,
  seconds: number,
  opts: { set?: Record<string, number>; peers?: (t: number) => PeerView[]; only?: string[] } = {},
): { t: number; rule?: string; text?: string; statuses: Record<string, RuleStatus>; mem: Record<string, Record<string, unknown>> } {
  const set = { ...defaultsOf(safety), ...(opts.set ?? {}) };
  const history: Sample[] = [];
  const mem: Record<string, Record<string, unknown>> = {};
  let statuses: Record<string, RuleStatus> = {};
  for (let t = 0; t <= seconds; t++) {
    const now = t * 1000;
    const s = timeline(t);
    history.push({ t: now, values: { ...s.values }, setpoints: { ...s.setpoints }, switches: { ...s.switches } });
    while (history.length && now - history[0].t > (safety.historyS + 5) * 1000) history.shift();
    statuses = {};
    for (const rule of safety.rules) {
      if (opts.only && !opts.only.includes(rule.key)) continue;
      const peers = rule.withPeer ? (opts.peers?.(t) ?? []).filter((p) => p.provides.includes(rule.withPeer!)) : [];
      if (rule.withPeer && !peers.length) {
        statuses[rule.key] = { state: 'idle', text: 'no peer' };
        continue;
      }
      const st = rule.evaluate({ s, history, set, mem: (mem[rule.key] ??= {}), now, peers });
      statuses[rule.key] = st;
      if (st.state === 'trip') return { t, rule: rule.key, text: st.text, statuses, mem };
    }
  }
  return { t: -1, statuses, mem };
}

/** The module's safety settings at their defaults. */
export function defaultsOf(safety: ModuleSafety): Record<string, number> {
  return Object.fromEntries(safety.rules.flatMap((r) => r.settings ?? []).map((st) => [st.key, st.default]));
}

/** A snapshot from plain objects. */
export function snap(values: Record<string, number | undefined>, setpoints: Record<string, number | undefined> = {}, switches: Record<string, boolean> = {}): DeviceSnapshot {
  return { values, gross: {}, setpoints, switches };
}

/** A fake partner module for rules with `withPeer`. */
export function peer(o: { id?: string; label?: string; provides: string[]; live?: boolean; active?: Record<string, boolean> }): PeerView {
  return {
    id: o.id ?? 'peer-1',
    label: o.label ?? 'Peer',
    model: 'fake',
    displayName: 'Fake',
    provides: o.provides,
    live: o.live ?? true,
    snapshot: snap({}),
    history: [],
    active: (name) => !!o.active?.[name],
  };
}
