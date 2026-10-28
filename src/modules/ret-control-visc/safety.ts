import type { DeviceSnapshot, ModuleSafety, RuleContext, RuleStatus, SafetyRule, Sample } from '../../core/types';

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Safety rules owned by the RET control-visc module (DESIGN.md §15 "Hotplate safety").
//
// The hazard: with the PT100 plugged in, the RET heats the PLATE until the PROBE reaches the setpoint.
// A probe that is not in the medium never gets there, so the plate climbs to the unit's own safety
// limit (up to 380 °C, IN_PV_3) — hot enough to burn someone and to ignite solvent vapour.
//
// How to read this file (it is meant to be copied):
// - Each rule is one object: what it is (label), why it exists (why — shown on the card), what it
//   turns off (switches), what the user may tune (settings), and evaluate(), which returns a live
//   status every poll. Returning state 'trip' is all a rule does; the core switches off, latches and
//   locks out (src/core/device.ts, checkSafety).
// - Static rules (1, 2, and 5b which keeps them seeing) are the floor. Dynamic rules (3–6) may only ADD trips, never loosen 1 and 2,
//   so a wrong guess in a dynamic rule can only cause a false trip, never a missed one.
// - Rules act on READINGS, not on what the app thinks it switched on: heating started on the keypad
//   is caught too (see heating()).
// - Rule 7 watches another module (withPeer). It is armed only while one is on the page.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const NOT_FALLING_AFTER_S = 20;   // compare with the plate at least this long ago
const FALL_TOLERANCE = 0.5;       // °C: less of a drop than this counts as "not cooling"
const PROBE_MIN_RISE = 1;         // °C over the window: the floor of the response check
const HEATING_PLATE_RISE = 2;     // °C over the window, for heating the app did not command (keypad)
const DROP_WINDOW_S = 120;
const LOST_AFTER_S = 10;
const LEARN_S = 180;              // probe within LEARN_BAND of setpoint this long -> learn the steady gap
const LEARN_BAND = 1.5;
const GROW_HOLD_S = 30;           // gap must stay above learned + growth this long

// ── Helpers shared by the rules ───────────────────────────────────────────────────────────────────

const r1 = (v: number) => (Math.round(v * 10) / 10).toString();
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
/** A probe reading the rules can trust (the unit may report nonsense when the probe is unplugged). */
const probeOf = (v: Record<string, number | undefined>) => {
  const p = v.probe;
  return p !== undefined && p > -40 && p < 400 ? p : undefined;
};
/** Sample from at least `ageMs` ago (the newest such), if the history reaches back that far. */
function sampleAgo(h: Sample[], now: number, ageMs: number): Sample | undefined {
  for (let i = h.length - 1; i >= 0; i--) if (now - h[i].t >= ageMs) return h[i];
  return undefined;
}
/** Plate not falling over the last 20 s (undefined until there is 20 s of history). */
function plateNotFalling({ s, history, now }: RuleContext): boolean | undefined {
  const ago = sampleAgo(history, now, NOT_FALLING_AFTER_S * 1000)?.values.plate;
  const plate = s.values.plate;
  return ago === undefined || plate === undefined ? undefined : plate >= ago - FALL_TOLERANCE;
}
/** Heating, judged from the readings as well as the switch: keypad heating counts. */
function heating(ctx: RuleContext): boolean {
  const ago = sampleAgo(ctx.history, ctx.now, NOT_FALLING_AFTER_S * 1000)?.values.plate;
  const plate = ctx.s.values.plate;
  return ctx.s.switches.heater || (ago !== undefined && plate !== undefined && plate > ago + FALL_TOLERANCE);
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** The hottest the plate may get right now before rule 1 or 2 trips. */
export function plateCutoff(s: DeviceSnapshot, set: Record<string, number>): number {
  const sp = s.setpoints.temp;
  return sp === undefined ? set.plateMax : Math.min(set.plateMax, sp + set.plateAbove);
}

// ── 1. Absolute plate maximum (static) ────────────────────────────────────────────────────────────
const plateMax: SafetyRule = {
  key: 'plateMax',
  label: 'Plate maximum',
  required: true, // the floor every other rule builds on: cannot be turned off
  why: 'Whatever the setpoint, the plate must never get hotter than this. Keep it below the autoignition temperature of anything in the hood (⚠ list below).',
  switches: ['heater'],
  settings: [{ key: 'plateMax', label: 'Max plate temperature', unit: '°C', default: 250, min: 30, max: 340, step: 5, hint: 'Heater off whenever the plate is hotter than this.' }],
  evaluate({ s, set }) {
    const plate = s.values.plate;
    if (plate === undefined) return { state: 'idle', text: 'No plate reading' };
    if (plate > set.plateMax) return { state: 'trip', text: `Plate ${r1(plate)} °C is above the ${set.plateMax} °C maximum` };
    return { state: plate > set.plateMax - 15 ? 'near' : 'ok', text: `Plate ${r1(plate)} °C · stops above ${set.plateMax} °C` };
  },
};

// ── 2. Plate too far above the setpoint (static) ──────────────────────────────────────────────────
const plateAboveSetpoint: SafetyRule = {
  key: 'plateAbove',
  label: 'Plate above setpoint',
  required: true, // the main guard against a probe out of the medium: cannot be turned off
  why: 'If the probe is not in the medium, the RET keeps heating the plate far past the setpoint. A plate much hotter than the setpoint and still heating means the probe is not where it should be. Lowering the setpoint over a hot plate does not trip it (the plate is cooling).',
  switches: ['heater'],
  settings: [{ key: 'plateAbove', label: 'Max plate above setpoint', unit: '°C', default: 30, min: 5, max: 200, step: 5, hint: 'Raise it for big flasks or oil baths that need a hotter plate.' }],
  evaluate(ctx) {
    const { s, set } = ctx;
    const plate = s.values.plate;
    const sp = s.setpoints.temp;
    if (plate === undefined || sp === undefined) return { state: 'idle', text: 'Waiting for plate and setpoint' };
    const lim = sp + set.plateAbove;
    const notFalling = plateNotFalling(ctx);
    if (plate > lim && notFalling) {
      const probe = probeOf(s.values);
      return { state: 'trip', text: `Plate ${r1(plate)} °C is more than ${set.plateAbove} °C above the ${sp} °C setpoint and still heating${probe !== undefined ? ` (probe ${r1(probe)} °C). Is the probe in the medium?` : ''}` };
    }
    const text = `Plate ${r1(plate)} °C · stops above ${r1(lim)} °C (setpoint ${sp} + ${set.plateAbove}) while heating`;
    return { state: plate > lim - 10 && notFalling !== false ? 'near' : 'ok', text };
  },
};

// ── 3. Probe must respond to the plate (dynamic) ──────────────────────────────────────────────────
const probeResponse: SafetyRule = {
  key: 'probeResponse',
  label: 'Probe responds',
  why: 'While the plate is much hotter than the probe, the medium — and the probe in it — must warm up. A probe lying beside the flask or hanging in warm air barely moves. The rise it needs scales with how hard the plate is driving.',
  switches: ['heater'],
  settings: [
    { key: 'probeGap', label: 'Watch when plate is above probe by', unit: '°C', default: 40, min: 5, max: 200, step: 5 },
    { key: 'probeWindow', label: 'Over', unit: 'min', default: 5, min: 1, max: 10, step: 1 },
    { key: 'probeResponse', label: 'Probe must rise at least', unit: '% of the gap', default: 3, min: 0, max: 50, step: 1, hint: `E.g. 3 % with the plate 100 °C above the probe: 3 °C per window (never less than ${PROBE_MIN_RISE} °C). Lower it for very large volumes.` },
  ],
  evaluate(ctx) {
    const { s, set, history, now } = ctx;
    const plate = s.values.plate;
    const probe = probeOf(s.values);
    const sp = s.setpoints.temp;
    if (plate === undefined || probe === undefined || sp === undefined) return { state: 'idle', text: 'Waiting for plate, probe and setpoint' };
    if (probe >= sp - 2) return { state: 'idle', text: 'Probe at setpoint' };
    const gapNow = plate - probe;
    if (gapNow < set.probeGap) return { state: 'idle', text: `Plate ${r1(gapNow)} °C above the probe · watches from ${set.probeGap} °C` };
    const windowMs = set.probeWindow * 60_000;
    // How long has the gap been at least probeGap?
    let since = now;
    for (let i = history.length - 1; i >= 0; i--) {
      const x = history[i];
      const p = probeOf(x.values);
      if (x.values.plate === undefined || p === undefined || x.values.plate - p < set.probeGap) break;
      since = x.t;
    }
    const start = sampleAgo(history, now, windowMs);
    if (now - since < windowMs || !start) return { state: 'learning', text: `Plate far above probe for ${mmss(now - since)} of ${mmss(windowMs)}; then the probe must have risen` };
    const span = history.filter((x) => x.t >= start.t);
    const meanGap = span.reduce((a, x) => a + (x.values.plate! - probeOf(x.values)!), 0) / span.length;
    const need = Math.max(PROBE_MIN_RISE, (set.probeResponse / 100) * meanGap);
    const rise = probe - probeOf(start.values)!;
    const heatingOverWindow = s.switches.heater || plate - (start.values.plate ?? plate) >= HEATING_PLATE_RISE;
    if (!heatingOverWindow) return { state: 'idle', text: 'Not heating' };
    const text = `Probe rose ${r1(rise)} °C in ${set.probeWindow} min · needs ${r1(need)} °C (plate ${r1(gapNow)} °C above it)`;
    if (rise < need) return { state: 'trip', text: `${text}. Is the probe in the medium?` };
    return { state: rise < need * 1.5 ? 'near' : 'ok', text };
  },
};

// ── 4. Probe falls fast: pulled out of the medium (dynamic) ───────────────────────────────────────
const probeDrop: SafetyRule = {
  key: 'probeDrop',
  label: 'Probe drop',
  why: 'A probe lifted out of a hot flask cools fast, and the RET answers by heating the plate hard. A quick fall with the setpoint unchanged trips within seconds instead of waiting for the plate to overshoot.',
  switches: ['heater'],
  settings: [{ key: 'probeDrop', label: 'Trip on a probe fall of', unit: `°C in ${DROP_WINDOW_S / 60} min`, default: 10, min: 1, max: 100, step: 1, hint: 'Raise it if large cold additions trip it.' }],
  evaluate(ctx) {
    const { s, set, history, now } = ctx;
    const probe = probeOf(s.values);
    const sp = s.setpoints.temp;
    if (probe === undefined || sp === undefined) return { state: 'idle', text: 'Waiting for probe and setpoint' };
    if (!heating(ctx)) return { state: 'idle', text: 'Not heating' };
    const span = history.filter((x) => now - x.t <= DROP_WINDOW_S * 1000);
    // A sample whose setpoint read failed (undefined) says nothing about a change: skip it.
    if (!span.every((x) => x.setpoints.temp === undefined || x.setpoints.temp === sp)) return { state: 'idle', text: 'Setpoint just changed' };
    const peak = Math.max(...span.map((x) => probeOf(x.values) ?? -Infinity), probe);
    const drop = peak - probe;
    if (drop >= set.probeDrop && probe < sp - 5) {
      return { state: 'trip', text: `Probe fell ${r1(drop)} °C (to ${r1(probe)} °C) in under ${DROP_WINDOW_S / 60} min with the setpoint unchanged. Was it pulled out of the medium?` };
    }
    return { state: drop >= set.probeDrop / 2 ? 'near' : 'ok', text: `Largest probe fall in ${DROP_WINDOW_S / 60} min: ${r1(drop)} °C · trips at ${set.probeDrop} °C` };
  },
};

// ── 5. Probe reading lost while heating (dynamic) ─────────────────────────────────────────────────
const probeLost: SafetyRule = {
  key: 'probeLost',
  label: 'Probe present',
  why: 'If the probe is unplugged mid-run, nothing tells the RET when the medium is hot enough. Once a probe has been seen, losing its reading while heating stops the heater. Using the plate on its own, without a probe, is not affected.',
  switches: ['heater'],
  evaluate(ctx) {
    const { s, mem, now } = ctx;
    const probe = probeOf(s.values);
    if (probe !== undefined) {
      mem.sawProbe = true;
      mem.missingSince = undefined;
      return { state: 'ok', text: `Probe reading ${r1(probe)} °C` };
    }
    if (!mem.sawProbe) return { state: 'idle', text: 'No probe seen yet (plate-only use)' };
    if (!heating(ctx)) {
      mem.missingSince = undefined;
      return { state: 'near', text: 'Probe reading missing (not heating)' };
    }
    const since = (mem.missingSince as number | undefined) ?? now;
    mem.missingSince = since;
    const raw = s.values.probe;
    if (now - since >= LOST_AFTER_S * 1000) return { state: 'trip', text: `Probe reading lost while heating${raw !== undefined ? ` (reads ${raw})` : ''}. Is the probe plugged in?` };
    return { state: 'near', text: `Probe reading missing for ${Math.round((now - since) / 1000)} s · stops at ${LOST_AFTER_S} s` };
  },
};

// ── 5b. Plate reading lost while heating (static) ────────────────────────────────────────────────
// Rules 1 and 2 need the plate reading: without it they can only say "no plate reading". The unit
// can keep answering other reads while IN_PV_2 fails, so this one stops the heater instead.
const plateLost: SafetyRule = {
  key: 'plateLost',
  label: 'Plate reading',
  required: true, // without it rules 1 and 2 are blind
  why: 'The plate maximum and plate-above-setpoint rules work on the plate reading. If the unit stops reporting it while the heater is on, they cannot see the plate, so the heater goes off.',
  switches: ['heater'],
  evaluate({ s, mem, now }) {
    if (s.values.plate !== undefined) {
      mem.missingSince = undefined;
      return { state: 'ok', text: `Plate reading ${r1(s.values.plate)} °C` };
    }
    if (!s.switches.heater) {
      mem.missingSince = undefined;
      return { state: 'idle', text: 'No plate reading (heater off)' };
    }
    const since = (mem.missingSince as number | undefined) ?? now;
    mem.missingSince = since;
    if (now - since >= LOST_AFTER_S * 1000) return { state: 'trip', text: `Plate reading lost for ${Math.round((now - since) / 1000)} s with the heater on` };
    return { state: 'near', text: `Plate reading missing for ${Math.round((now - since) / 1000)} s · stops at ${LOST_AFTER_S} s` };
  },
};

// ── 6. Steady plate–probe gap (dynamic, learns) ───────────────────────────────────────────────────
const steadyGap: SafetyRule = {
  key: 'steadyGap',
  label: 'Steady gap',
  why: 'Once the probe has held the setpoint, the plate–probe gap needed to hold it is learned for this flask. If that gap later grows a lot, something changed: probe lifted, flask boiling dry, stir bar lost. Relearned at each setpoint; it only ever goes down, so a slow creep is not absorbed.',
  switches: ['heater'],
  settings: [{ key: 'gapGrowth', label: 'Trip when the gap grows by', unit: '°C', default: 15, min: 1, max: 100, step: 1, hint: `Held for ${GROW_HOLD_S} s. Reflux starting right at the setpoint can trip it; raise it then.` }],
  evaluate({ s, set, history, mem, now }) {
    const plate = s.values.plate;
    const probe = probeOf(s.values);
    const sp = s.setpoints.temp;
    // A failed read (any of them undefined) changes nothing: keep what was learned and wait.
    if (plate === undefined || probe === undefined || sp === undefined) return { state: 'idle', text: 'Waiting for plate, probe and setpoint' };
    let learned = mem.learned as { sp: number; gap: number } | undefined;
    if (learned && learned.sp !== sp) learned = mem.learned = mem.overSince = undefined;
    // Learn: probe within ±1.5 °C of the setpoint for 3 min, setpoint unchanged. Samples with a failed
    // read are skipped, not counted as a break; the history kept reaches well past 3 min (historyS).
    let heldMs = 0;
    let from = history.length;
    for (let i = history.length - 1; i >= 0; i--) {
      const x = history[i];
      if (x.setpoints.temp === undefined || x.values.plate === undefined || probeOf(x.values) === undefined) continue;
      if (x.setpoints.temp !== sp || Math.abs(probeOf(x.values)! - sp) > LEARN_BAND) break;
      heldMs = now - x.t;
      from = i;
      if (heldMs >= LEARN_S * 1000) break;
    }
    if (heldMs >= LEARN_S * 1000) {
      const span = history.slice(from).filter((x) => x.values.plate !== undefined && probeOf(x.values) !== undefined);
      const g = median(span.map((x) => x.values.plate! - probeOf(x.values)!));
      if (!learned || g < learned.gap) learned = mem.learned = { sp, gap: g };
    }
    if (!learned) {
      return { state: 'learning', text: heldMs ? `Learning: probe at setpoint for ${mmss(heldMs)} of ${mmss(LEARN_S * 1000)}` : 'Learns once the probe holds the setpoint' };
    }
    const gap = plate - probe;
    const lim = learned.gap + set.gapGrowth;
    if (gap > lim) {
      const since = (mem.overSince as number | undefined) ?? now;
      mem.overSince = since;
      if (now - since >= GROW_HOLD_S * 1000) {
        return { state: 'trip', text: `Plate–probe gap grew to ${r1(gap)} °C; it held the setpoint at ${r1(learned.gap)} °C. Probe lifted, flask boiling dry, or stirring lost?` };
      }
      return { state: 'near', text: `Gap ${r1(gap)} °C above ${r1(lim)} °C for ${Math.round((now - since) / 1000)} s · stops at ${GROW_HOLD_S} s` };
    }
    mem.overSince = undefined;
    return { state: gap > learned.gap + set.gapGrowth / 2 ? 'near' : 'ok', text: `Gap ${r1(gap)} °C · learned ${r1(learned.gap)} °C · stops above ${r1(lim)} °C` };
  },
};

// ── 7. Overhead stirring lost while heating (watches another module) ─────────────────────────────
const stirringLost: SafetyRule = {
  key: 'stirringLost',
  label: 'Overhead stirring',
  why: 'With an overhead stirrer on the page, heating an unstirred flask makes hot spots and can bump. If the stirrer stops while heating (switched off, stalled, error, or not answering), the heater goes off too. Armed only while an overhead stirrer is on the page; any module that provides "overhead-stirrer" counts.',
  switches: ['heater'],
  withPeer: 'overhead-stirrer',
  watchesActivity: 'stirring',
  watchNote: 'Stopping stirring for {stirLostS} s while the hotplate heats turns its heater off.',
  settings: [{ key: 'stirLostS', label: 'Heater off after stirring stops for', unit: 's', default: 5, min: 1, max: 120, step: 1 }],
  evaluate(ctx) {
    const { set, peers, mem, now } = ctx;
    const was = ((mem.wasStirring as Record<string, boolean> | undefined) ??= {});
    const lostSince = ((mem.lostSince as Record<string, number> | undefined) ??= {});
    if (!heating(ctx)) {
      for (const k of Object.keys(was)) delete was[k];
      for (const k of Object.keys(lostSince)) delete lostSince[k];
      return { state: 'idle', text: `Not heating · watching ${peers.map((p) => p.label).join(', ')}` };
    }
    const notes: string[] = [];
    let state: RuleStatus['state'] = 'ok';
    for (const p of peers) {
      const stirring = p.live && p.active('stirring');
      if (stirring) {
        was[p.id] = true;
        delete lostSince[p.id];
        notes.push(`${p.label} stirring`);
        continue;
      }
      if (!was[p.id]) {
        // Never stirred during this heating: warn, do not stop (setting up, or stirring by stir bar).
        notes.push(`${p.label} not stirring`);
        if (state === 'ok') state = 'near';
        continue;
      }
      const since = (lostSince[p.id] ??= now);
      const why = p.live ? 'stopped' : 'not answering';
      if (now - since >= set.stirLostS * 1000) {
        return { state: 'trip', text: `${p.label} ${why} while heating. Stirring lost for ${Math.round((now - since) / 1000)} s` };
      }
      notes.push(`${p.label} ${why} for ${Math.round((now - since) / 1000)} s · stops at ${set.stirLostS} s`);
      state = 'near';
    }
    return { state, text: notes.join(' · ') };
  },
};

export const retSafety: ModuleSafety = {
  historyS: 600, // the longest window any rule uses: probe response, up to 10 min
  rules: [plateMax, plateAboveSetpoint, plateLost, probeResponse, probeDrop, probeLost, steadyGap, stirringLost],
  summary: (s, set) => `Plate cut-off ${plateCutoff(s, set)} °C`,
};
