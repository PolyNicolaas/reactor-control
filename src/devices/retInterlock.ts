import type { DeviceSnapshot, InterlockSpec } from '../core/types';

// Plate/probe interlock for the RET control-visc. See DESIGN.md §15 "Hotplate safety".
//
// The problem: with the external PT100 plugged in, the RET heats the PLATE until the PROBE reaches the
// setpoint. A probe lying beside the flask (or in the air) never gets there, so the plate climbs to the
// unit's safety limit (up to 380 °C, manual p. 31 IN_PV_3) — hot enough to burn someone.
//
// Static rules (always on; dynamic rules may only add trips, never loosen these):
//   1. Absolute plate maximum.
//   2. Plate more than `plateAbove` over the setpoint while the plate is not cooling.
//      (Not cooling, so lowering the setpoint while the plate is hot does not trip it.)
// Dynamic rules (plate referenced to the probe):
//   3. Probe response: while the plate is far above the probe, the probe must rise at least a share
//      of that gap per window. A probe beside the flask or hanging in warm air does not.
//   4. Probe drop: the probe falls fast with the setpoint unchanged — pulled out of the medium.
//   5. Probe lost: the probe reading disappears (or is implausible) while heating, after it was seen.
//   6. Steady gap: once the probe has held the setpoint, the plate–probe gap that holds it is learned;
//      if the gap later grows well past it (probe lifted, flask boiling dry, stir bar decoupled), trip.
//      The learned gap only ever goes down for a given setpoint.

interface Sample {
  t: number;
  plate?: number;
  probe?: number;
  sp?: number;
}

interface Mem {
  h?: Sample[];
  sawProbe?: boolean;
  missingSince?: number;
  learned?: { sp: number; gap: number };
  overSince?: number;
}

const NOT_FALLING_AFTER_S = 20; // compare with the plate at least this long ago
const FALL_TOLERANCE = 0.5; // °C: less of a drop than this counts as "not cooling"
const PROBE_MIN_RISE = 1; // °C over the window, the floor of the response check
const HEATING_PLATE_RISE = 2; // °C over the window, for heating the app did not command (keypad)
const DROP_WINDOW_S = 120;
const LOST_AFTER_S = 10;
const LEARN_S = 180; // probe within LEARN_BAND of setpoint this long -> learn the steady gap
const LEARN_BAND = 1.5;
const GROW_HOLD_S = 30; // gap must stay above learned + growth this long
const PROBE_PLAUSIBLE = (v: number | undefined) => v !== undefined && v > -40 && v < 400;

const r1 = (v: number) => Math.round(v * 10) / 10;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Sample from at least `ageMs` ago (the newest such), if the history reaches back that far. */
function sampleAgo(h: Sample[], now: number, ageMs: number): Sample | undefined {
  for (let i = h.length - 1; i >= 0; i--) if (now - h[i].t >= ageMs) return h[i];
  return undefined;
}

/** The hottest the plate may get right now before the interlock trips (static rules). */
export function plateCutoff(s: DeviceSnapshot, set: Record<string, number>): number {
  const sp = s.setpoints.temp;
  return sp === undefined ? set.plateMax : Math.min(set.plateMax, sp + set.plateAbove);
}

/** The learned steady plate–probe gap, if any (for the card). */
export function learnedGap(mem: Record<string, unknown> | undefined): number | undefined {
  return (mem as Mem | undefined)?.learned?.gap;
}

export const plateProbeInterlock: InterlockSpec = {
  key: 'plate',
  label: 'Plate / probe interlock',
  switches: ['heater'],
  settings: [
    {
      key: 'plateMax', label: 'Max plate temperature', unit: '°C', default: 250, min: 30, max: 340, step: 5,
      hint: 'Heater is cut whenever the plate is hotter than this, whatever the setpoint. Keep it below the autoignition temperature of anything in the hood (see the ⚠ list on the card).',
    },
    {
      key: 'plateAbove', label: 'Max plate above setpoint', unit: '°C', default: 30, min: 5, max: 200, step: 5,
      hint: 'Heater is cut when the plate runs this far above the temperature setpoint and is not cooling. Raise it for big flasks or oil baths that need a hot plate.',
    },
    {
      key: 'probeGap', label: 'Probe check: plate–probe gap', unit: '°C', default: 40, min: 0, max: 200, step: 5,
      hint: 'The probe check runs while the plate is this much hotter than the probe. 0 turns it off.',
    },
    {
      key: 'probeWindow', label: 'Probe check: time', unit: 'min', default: 5, min: 1, max: 30, step: 1,
      hint: 'Over this time the probe must rise by the share below.',
    },
    {
      key: 'probeResponse', label: 'Probe check: min rise, % of the gap', unit: '%', default: 3, min: 0, max: 50, step: 1,
      hint: `E.g. 3 % with the plate 100 °C above the probe: the probe must rise at least 3 °C per window (never less than ${PROBE_MIN_RISE} °C). Lower it for very large volumes.`,
    },
    {
      key: 'probeDrop', label: 'Probe drop trip', unit: '°C', default: 10, min: 0, max: 100, step: 1,
      hint: `Trip if the probe falls this much within ${DROP_WINDOW_S / 60} min with the setpoint unchanged (probe pulled out). Raise it if large cold additions trip it. 0 turns it off.`,
    },
    {
      key: 'gapGrowth', label: 'Steady gap growth', unit: '°C', default: 15, min: 0, max: 100, step: 1,
      hint: `After the probe has held the setpoint for ${LEARN_S / 60} min, trip if the plate–probe gap grows this much past the learned one for ${GROW_HOLD_S} s (probe lifted, boiling dry, stir bar lost). Relearned on every setpoint change. 0 turns it off.`,
    },
  ],
  check(s, set, memAny, now) {
    const mem = memAny as Mem;
    const plate = s.values.plate;
    const rawProbe = s.values.probe;
    const probe = PROBE_PLAUSIBLE(rawProbe) ? rawProbe : undefined;
    const sp = s.setpoints.temp;
    const h = (mem.h ??= []);
    h.push({ t: now, plate, probe, sp });
    const keepMs = Math.max(set.probeWindow * 60_000, LEARN_S * 1000, DROP_WINDOW_S * 1000) + 60_000;
    while (h.length && now - h[0].t > keepMs) h.shift();
    if (probe !== undefined) mem.sawProbe = true;
    if (mem.learned && mem.learned.sp !== sp) {
      mem.learned = undefined;
      mem.overSince = undefined;
    }

    if (plate === undefined) return undefined;
    const ago20 = sampleAgo(h, now, NOT_FALLING_AFTER_S * 1000);
    const notCooling = ago20?.plate !== undefined && plate >= ago20.plate - FALL_TOLERANCE;
    const heating = s.switches.heater || (ago20?.plate !== undefined && plate > ago20.plate + FALL_TOLERANCE);

    // 1. Absolute maximum.
    if (plate > set.plateMax) return `Plate ${r1(plate)} °C is above the ${set.plateMax} °C maximum`;

    // 2. Plate too far above the setpoint and not cooling.
    if (sp !== undefined && plate > sp + set.plateAbove && notCooling) {
      return `Plate ${r1(plate)} °C is more than ${set.plateAbove} °C above the ${sp} °C setpoint and still heating` +
        (probe !== undefined ? ` (probe ${r1(probe)} °C). Is the probe in the medium?` : '');
    }

    // 5. Probe lost while heating.
    if (probe === undefined && mem.sawProbe && heating) {
      mem.missingSince ??= now;
      if (now - mem.missingSince >= LOST_AFTER_S * 1000) {
        return `Probe reading lost while heating${rawProbe !== undefined ? ` (reads ${rawProbe})` : ''}. Is the probe plugged in?`;
      }
    } else {
      mem.missingSince = undefined;
    }
    if (probe === undefined || sp === undefined) return undefined;

    // 4. Probe dropping fast with the setpoint unchanged.
    if (set.probeDrop > 0 && heating && probe < sp - 5) {
      const span = h.filter((x) => now - x.t <= DROP_WINDOW_S * 1000);
      const spSame = span.every((x) => x.sp === sp);
      const peak = Math.max(...span.map((x) => x.probe ?? -Infinity));
      if (spSame && peak - probe >= set.probeDrop) {
        return `Probe fell ${r1(peak - probe)} °C (to ${r1(probe)} °C) in under ${DROP_WINDOW_S / 60} min with the setpoint unchanged. Was it pulled out of the medium?`;
      }
    }

    // 3. Probe not responding to the plate.
    if (set.probeGap > 0 && probe < sp - 2) {
      const windowMs = set.probeWindow * 60_000;
      const start = sampleAgo(h, now, windowMs);
      if (start?.probe !== undefined && start.plate !== undefined) {
        const span = h.filter((x) => x.t >= start.t);
        const gaps = span.map((x) => (x.plate !== undefined && x.probe !== undefined ? x.plate - x.probe : -Infinity));
        const gapHeld = gaps.every((g) => g >= set.probeGap);
        const heatingOverWindow = s.switches.heater || plate - start.plate >= HEATING_PLATE_RISE;
        const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        const need = Math.max(PROBE_MIN_RISE, (set.probeResponse / 100) * meanGap);
        if (gapHeld && heatingOverWindow && probe - start.probe < need) {
          return `Probe rose only ${r1(probe - start.probe)} °C in ${set.probeWindow} min (needs ${r1(need)} °C) while the plate is ${r1(plate)} °C, ${r1(plate - probe)} °C above it. Is the probe in the medium?`;
        }
      }
    }

    // 6. Steady gap: learn it, then watch it.
    if (set.gapGrowth > 0) {
      const learnSpan = h.filter((x) => now - x.t <= LEARN_S * 1000);
      const covers = now - (learnSpan[0]?.t ?? now) >= (LEARN_S - 2) * 1000;
      const steady = covers && learnSpan.every((x) => x.sp === sp && x.probe !== undefined && x.plate !== undefined && Math.abs(x.probe - sp) <= LEARN_BAND);
      // Learned once per setpoint and only ever lowered afterwards: a gap creeping up while the probe
      // still holds the setpoint must not be absorbed into the reference.
      if (steady) {
        const g = median(learnSpan.map((x) => x.plate! - x.probe!));
        if (!mem.learned || g < mem.learned.gap) mem.learned = { sp, gap: g };
      }
      const L = mem.learned;
      if (L && plate - probe > L.gap + set.gapGrowth) {
        mem.overSince ??= now;
        if (now - mem.overSince >= GROW_HOLD_S * 1000) {
          return `Plate–probe gap grew to ${r1(plate - probe)} °C; it held the setpoint at ${r1(L.gap)} °C. Probe lifted, flask boiling dry, or stirring lost?`;
        }
      } else {
        mem.overSince = undefined;
      }
    }
    return undefined;
  },
  describe(s, set, mem) {
    const parts = [`Plate cut-off ${plateCutoff(s, set)} °C`];
    parts.push(set.probeGap > 0 ? 'probe check on' : 'probe check off');
    const g = learnedGap(mem);
    if (set.gapGrowth > 0) parts.push(g === undefined ? 'steady gap: learning once at setpoint' : `steady gap ${r1(g)} °C (+${set.gapGrowth} trips)`);
    return parts.join(' · ');
  },
};
