import { ISMATEC } from '../core/protocol';
import { parseNumber, type DeviceDriver, type DeviceSnapshot, type ReadingSpec, type SetpointSpec, type SwitchSpec } from '../core/types';
import { RegloSimTransport } from './regloSim';

// Ismatec Reglo ICC — peristaltic pump with independently controlled channels.
// Source: operating manual 14-036-E rev. C (see docs/manuals/reglo-icc/notes.md), serial protocol p. 17–33.
// Our unit: 4 channels, 12 rollers, USB Mini-B (virtual COM port) or RS-232.
//
// How the app drives it:
// - Channel addressing on ("1~1"): the address digit picks the channel (1–4). Without it, on RS-232,
//   "2H" would start EVERY channel, so this is sent first on every connect.
// - Every channel in Flow rate mode ("nM"), rate in mL/min. The pump turns mL/min into rpm using the
//   tubing inner diameter set for that channel (keypad or "n+"), so that setting must match the tubing.
// - The pump has no flow sensor. "Flow" here is the set rate while the channel runs, else 0, and
//   "Dispensed" is that rate integrated over time by the app (an estimate; calibrate the channel).
// - Rotation direction is NOT changed by the app; set it on the pump so the reagent flows into the reactor.

const CHANNELS = 4;
const MAX_FLOW = 35; // mL/min, largest tubing (3.17 mm ID), manual p. 16. Smaller tubing allows less; the pump refuses more.

const chans = Array.from({ length: CHANNELS }, (_, i) => i + 1);
const g = (n: number) => `ch${n}`;

const readings: ReadingSpec[] = [
  ...chans.flatMap((n): ReadingSpec[] => [
    { key: `flow${n}`, label: 'Flow', unit: 'mL/min', chart: true, primary: true, group: g(n) },
    { key: `dispensed${n}`, label: 'Dispensed', unit: 'mL', group: g(n) },
    // Reply "3.17 mm" (manual p. 29). Changes only when someone swaps tubing, so polled every 10 s.
    { key: `tubing${n}`, label: 'Tubing ID', unit: 'mm', cmd: `${n}+`, everyN: 10, group: g(n) },
  ]),
  // Pump-wide "is anything running": + / - (manual p. 24, ref 6.21). Catches stops made on the pump.
  { key: 'running', label: 'Pump running', unit: '0/1', cmd: '1E', hidden: true },
];

const setpoints: SetpointSpec[] = chans.map((n) => ({
  key: `flow${n}`, label: 'Flow', unit: 'mL/min', cmd: `${n}f`, readCmd: `${n}f`,
  min: 0.001, max: MAX_FLOW, step: 0.01, decimals: 3,
  // The pump keeps 4 significant figures (12.345 is stored as 12.35), so allow a small relative error.
  tolerance: 0.0005, toleranceRel: 0.002,
  actualKey: `flow${n}`, group: g(n),
}));

const switches: SwitchSpec[] = chans.map((n) => ({ key: `run${n}`, label: 'Pump', on: `${n}H`, off: `${n}I`, group: g(n) }));

/**
 * Volume Type 2 (setting a rate or volume): 4-digit mantissa with the decimal point after the first
 * digit, then a signed one-digit exponent, no "E". 1.3 µL/min = 0.0013 -> "1300-3" (manual p. 28).
 */
export function volumeType2(v: number): string {
  const [m, e] = Math.abs(v).toExponential(3).split('e');
  const exp = Number(e);
  if (exp > 9 || exp < -9) throw new Error(`${v} is out of range for the pump`);
  return `${m.replace('.', '')}${exp < 0 ? '-' : '+'}${Math.abs(exp)}`;
}

/** Volume Type 1 (replies): "3250E+1" = 3.250 × 10^1 = 32.5 (manual p. 19, 28). */
export function parseVolumeType1(s: string): number | undefined {
  const m = /^(\d)(\d{3})E([+-]\d)$/i.exec(s.trim());
  return m ? Number(`${m[1]}.${m[2]}e${m[3]}`) : undefined;
}

// Per-unit bookkeeping that is not a reading (kept out of the snapshot so it is not recorded).
const stoppedPolls = new WeakMap<DeviceSnapshot, number>();

export const regloIcc: DeviceDriver = {
  model: 'regloIcc',
  displayName: 'Reglo ICC',
  kind: 'Peristaltic pump',
  protocol: ISMATEC,
  serial: ISMATEC.probes[0].link.options,
  lineEnd: '\r',
  // Reply to "1#": model, software version, pump head code (manual p. 24, ref 6.22).
  identify: (name) => /REGLO/i.test(name),
  groups: chans.map((n) => ({ key: g(n), label: `Ch ${n}` })),
  readings,
  setpoints,
  switches,
  initCommands: [
    '1~1',  // channel addressing on (manual p. 17)
    '1xE0', // no unsolicited event messages: they would be mistaken for replies
    ...chans.map((n) => `${n}M`), // flow rate mode
  ],
  formatSetpoint: (sp, v) => `${sp.cmd}${volumeType2(v)}`,
  stopCommands: chans.map((n) => `${n}I`),
  releaseCommand: '1A', // keypad control back to the pump
  parse: (reply) => {
    const r = reply.trim();
    if (r === '+') return 1;
    if (r === '-') return 0;
    return parseVolumeType1(r) ?? parseNumber(r);
  },
  derive: (s, dt) => {
    const running = s.values.running;
    // The pump says nothing is running twice in a row: whatever we think is on, isn't
    // (Run/Stop pressed on the pump, overload). Twice, so a poll that raced a start is ignored.
    const n0 = running === 0 ? (stoppedPolls.get(s) ?? 0) + 1 : 0;
    stoppedPolls.set(s, n0);
    for (const n of chans) {
      if (n0 >= 2) s.switches[`run${n}`] = false;
      const on = s.switches[`run${n}`] && running !== 0;
      const flow = on ? s.setpoints[`flow${n}`] ?? 0 : 0;
      s.values[`flow${n}`] = flow;
      s.values[`dispensed${n}`] = (s.values[`dispensed${n}`] ?? 0) + (flow * Math.min(dt, 10)) / 60;
    }
  },
  simulate: () => new RegloSimTransport(),
  status: (s) => (chans.some((n) => s.switches[`run${n}`]) ? 'Pumping' : 'Idle'),
};
