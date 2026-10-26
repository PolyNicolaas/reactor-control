import type { DeviceSnapshot, InterlockSpec } from '../core/types';

// Plate/probe interlock for the RET control-visc.
//
// The problem: with the external PT100 plugged in, the RET heats the PLATE until the PROBE reaches the
// setpoint. A probe lying beside the flask (or in the air) never gets there, so the plate climbs to the
// unit's safety limit (up to 380 °C, manual p. 31 IN_PV_3) — hot enough to burn someone.
//
// Three rules, any one trips the heater off and locks it out until the user resets:
//   1. Absolute plate maximum.
//   2. Plate more than `plateAbove` over the setpoint while the plate is not cooling.
//      (Not cooling, so lowering the setpoint while the plate is hot does not trip it.)
//   3. Probe check: the heater is working (plate well above probe) but the probe has not moved in
//      `probeWindow` minutes while it is still below the setpoint — the probe is not in the medium.

interface Sample {
  t: number;
  plate?: number;
  probe?: number;
}

const NOT_FALLING_AFTER_S = 20; // compare with the plate at least this long ago
const FALL_TOLERANCE = 0.5; // °C: less of a drop than this counts as "not cooling"
const PROBE_MIN_RISE = 1; // °C over the window
const HEATING_PLATE_RISE = 2; // °C over the window, for heating the app did not command (keypad)

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Sample from at least `ageMs` ago (the newest such), if the history reaches back that far. */
function sampleAgo(h: Sample[], now: number, ageMs: number): Sample | undefined {
  for (let i = h.length - 1; i >= 0; i--) if (now - h[i].t >= ageMs) return h[i];
  return undefined;
}

export function plateCutoff(s: DeviceSnapshot, set: Record<string, number>): number {
  const sp = s.setpoints.temp;
  return sp === undefined ? set.plateMax : Math.min(set.plateMax, sp + set.plateAbove);
}

export const plateProbeInterlock: InterlockSpec = {
  key: 'plate',
  label: 'Plate / probe interlock',
  switches: ['heater'],
  settings: [
    {
      key: 'plateMax', label: 'Max plate temperature', unit: '°C', default: 250, min: 30, max: 340, step: 5,
      hint: 'Heater is cut whenever the plate is hotter than this, whatever the setpoint.',
    },
    {
      key: 'plateAbove', label: 'Max plate above setpoint', unit: '°C', default: 50, min: 5, max: 200, step: 5,
      hint: 'Heater is cut when the plate runs this far above the temperature setpoint and is not cooling. Raise it for big flasks or oil baths that need a hot plate.',
    },
    {
      key: 'probeGap', label: 'Probe check: plate–probe gap', unit: '°C', default: 40, min: 0, max: 200, step: 5,
      hint: 'If the plate stays this much hotter than the probe and the probe does not rise, the probe is probably not in the medium. 0 turns the check off.',
    },
    {
      key: 'probeWindow', label: 'Probe check: time', unit: 'min', default: 5, min: 1, max: 30, step: 1,
      hint: `How long the probe may stay flat (less than ${PROBE_MIN_RISE} °C rise) while the plate is far above it.`,
    },
  ],
  check(s, set, mem, now) {
    const plate = s.values.plate;
    const probe = s.values.probe;
    const sp = s.setpoints.temp;
    const h = ((mem.h as Sample[] | undefined) ??= []);
    h.push({ t: now, plate, probe });
    const keepMs = Math.max(set.probeWindow * 60_000, NOT_FALLING_AFTER_S * 1000) + 60_000;
    while (h.length && now - h[0].t > keepMs) h.shift();

    if (plate === undefined) return undefined;

    // 1. Absolute maximum.
    if (plate > set.plateMax) return `Plate ${r1(plate)} °C is above the ${set.plateMax} °C maximum`;

    // 2. Plate too far above the setpoint and not cooling.
    if (sp !== undefined && plate > sp + set.plateAbove) {
      const ago = sampleAgo(h, now, NOT_FALLING_AFTER_S * 1000);
      if (ago?.plate !== undefined && plate >= ago.plate - FALL_TOLERANCE) {
        return `Plate ${r1(plate)} °C is more than ${set.plateAbove} °C above the ${sp} °C setpoint and still heating` +
          (probe !== undefined ? ` (probe ${r1(probe)} °C). Is the probe in the medium?` : '');
      }
    }

    // 3. Probe not following.
    if (set.probeGap > 0 && probe !== undefined && sp !== undefined && probe < sp - 2) {
      const windowMs = set.probeWindow * 60_000;
      const start = sampleAgo(h, now, windowMs);
      if (start?.probe !== undefined && start.plate !== undefined) {
        const span = h.filter((x) => x.t >= start.t);
        const gapHeld = span.every((x) => x.plate !== undefined && x.probe !== undefined && x.plate - x.probe >= set.probeGap);
        const heating = s.switches.heater || plate - start.plate >= HEATING_PLATE_RISE;
        if (gapHeld && heating && probe - start.probe < PROBE_MIN_RISE) {
          return `Probe ${r1(probe)} °C has not risen in ${set.probeWindow} min while the plate is ${r1(plate)} °C. Is the probe in the medium?`;
        }
      }
    }
    return undefined;
  },
  describe(s, set) {
    const probe = set.probeGap > 0 ? ' · probe check on' : ' · probe check off';
    return `Plate cut-off ${plateCutoff(s, set)} °C${probe}`;
  },
};
