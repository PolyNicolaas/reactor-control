import type { SafetyRule, SafetySetting } from '../../../core/types';

// Safety rules shared by the single-head Innofluid pumps (ST-HandyPump, LabV1). Each pump is its own
// card with one channel; these rules stop that pump's `run` switch. Patterns are the Reglo ICC's
// (reglo-icc/safety.ts), written once here because both Innofluid modules use them.
//
// Every rule acts on what the pump reports (`running`, read from its start/stop register) as well as the
// card's switch, so a start from the pump's own keypad counts (principle 1 in src/modules/README.md).

/** True when the pump is (or may be) turning: the card's switch, or the pump's own report. */
export const pumping = (s: { switches: Record<string, boolean>; values: Record<string, number | undefined> }) =>
  !!s.switches.run || s.values.running === 1;

/** Stop the pump once it has dispensed its maximum. `extra` adds settings that live with it (calibration). */
export function volumeLimit(extra: SafetySetting[] = [], why = ''): SafetyRule {
  return {
    key: 'volume',
    label: 'Volume limit',
    why: `A pump left running fills the flask past what the reaction (or the flask) can take. This stops the pump at a set volume. "Dispensed" is the app's estimate from the set rate and the time the pump ran, so calibrate and keep a margin.${why}`,
    switches: ['run'],
    defaultOn: false, // the right volume depends on the reaction; turn it on and set it per run
    settings: [
      { key: 'volumeMax', label: 'Max dispensed', unit: 'mL', default: 10, min: 0.1, max: 5000, step: 0.1, hint: 'Pump stops at this volume.' },
      ...extra,
    ],
    // Dispensed only grows, so this trip cannot clear by itself: resetting it starts the count again.
    onReset: { note: 'dispensed set back to 0', apply: (s) => { s.values.dispensed = 0; } },
    evaluate({ s, set }) {
      const max = set.volumeMax;
      const v = s.values.dispensed ?? 0;
      if (v >= max) return { state: 'trip', text: `Dispensed ${v.toFixed(2)} mL, limit ${max} mL` };
      return { state: v >= max * 0.9 ? 'near' : pumping(s) ? 'ok' : 'idle', text: `${v.toFixed(2)} of ${max} mL` };
    },
  };
}

/** Dosing into an unstirred flask: reagent pools and can react all at once. Same as the Reglo rule. */
export const noStirring: SafetyRule = {
  key: 'noStirring',
  label: 'Dose only while stirring',
  why: 'Reagent added to an unstirred flask pools, then reacts all at once when stirring resumes (runaway exotherm). With a stirrer on the page, the pump stops when nothing is stirring. Any module that provides "stirrer" counts: an overhead stirrer or the hotplate\'s magnetic stirrer.',
  switches: ['run'],
  withPeer: 'stirrer',
  watchesActivity: 'stirring',
  watchNote: 'When nothing on the page has stirred for {noStirS} s, this pump stops dosing.',
  settings: [{ key: 'noStirS', label: 'Stop dosing after no stirring for', unit: 's', default: 5, min: 1, max: 120, step: 1 }],
  evaluate({ s, set, peers, mem, now }) {
    const dosing = pumping(s);
    const stirring = peers.filter((p) => p.live && p.active('stirring'));
    if (stirring.length) {
      mem.since = undefined;
      return { state: dosing ? 'ok' : 'idle', text: `Stirring: ${stirring.map((p) => p.label).join(', ')}` };
    }
    if (!dosing) {
      mem.since = undefined;
      return { state: 'idle', text: `Not dosing · nothing stirring (${peers.map((p) => p.label).join(', ')})` };
    }
    const since = (mem.since as number | undefined) ?? now;
    mem.since = since;
    const secs = Math.round((now - since) / 1000);
    if (now - since >= set.noStirS * 1000) return { state: 'trip', text: `Dosing with nothing stirring for ${secs} s` };
    return { state: 'near', text: `Dosing with nothing stirring for ${secs} s · stops at ${set.noStirS} s` };
  },
};

/**
 * The pump's own run report is what every other rule leans on (a keypad start, a stop on the pump).
 * If the pump keeps answering nothing for it while the card has it on, stop: the app is guessing.
 */
export const runReading: SafetyRule = {
  key: 'runReading',
  label: 'Run reading',
  why: 'The other rules and Dispensed rely on the pump saying whether it is turning. If that reading stays missing while the pump is switched on, a start or stop made on the pump would go unseen, so the pump is stopped.',
  switches: ['run'],
  required: true,
  settings: [{ key: 'runLostS', label: 'Stop after no run reading for', unit: 's', default: 10, min: 3, max: 60, step: 1 }],
  evaluate({ s, set, mem, now }) {
    if (s.values.running !== undefined) mem.lastSeen = now;
    const last = (mem.lastSeen as number | undefined) ?? now;
    mem.lastSeen = last;
    if (!s.switches.run) return { state: 'idle', text: s.values.running === undefined ? 'Pump off · no run reading yet' : 'Pump off' };
    const gone = Math.round((now - last) / 1000);
    if (s.values.running !== undefined) return { state: 'ok', text: `Pump reports ${s.values.running === 1 ? 'running' : 'stopped'}` };
    if (now - last >= set.runLostS * 1000) return { state: 'trip', text: `No run reading for ${gone} s with the pump on` };
    return { state: 'near', text: `No run reading for ${gone} s · stops at ${set.runLostS} s` };
  },
};

/**
 * Shared derive() bookkeeping: "running" from the pump wins over the card's switch, and Dispensed errs
 * high, never low (the volume limit then stops early, not late).
 *
 * - The pump saying "stopped" on two polls in a row WHILE the card has it on turns the switch off (stop on
 *   the pump, end of a program). Counted only while the switch is on, so a poll that raced a start does
 *   not count, however long the pump sat idle before.
 * - A start on the pump's keypad (running = 1, switch off) counts as pumping.
 * - The rate is the set rate; if its read-back failed this poll, the last known one.
 * - Time is counted when the pump runs now OR ran at the previous poll, over the whole time since then —
 *   also across a gap with no replies (device.ts keeps the time of the last answered poll).
 */
interface RunMemory { stopped: number; rate: number; wasOn: boolean }
const memory = new WeakMap<object, RunMemory>();

export function pumpVolume(
  s: { switches: Record<string, boolean>; values: Record<string, number | undefined> },
  setRate: number | undefined,
  dtSeconds: number,
): { on: boolean; rate: number; added: number } {
  const m = memory.get(s) ?? { stopped: 0, rate: 0, wasOn: false };
  memory.set(s, m);
  const running = s.values.running;
  m.stopped = running === 0 && s.switches.run ? m.stopped + 1 : 0;
  if (m.stopped >= 2) s.switches.run = false;
  const on = running === 1 || (running === undefined && !!s.switches.run);
  if (setRate !== undefined) m.rate = setRate;
  const added = on || m.wasOn ? (m.rate * Math.max(0, dtSeconds)) / 60 : 0;
  m.wasOn = on;
  return { on, rate: on ? m.rate : 0, added };
}
