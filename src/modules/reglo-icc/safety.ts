import type { ModuleSafety, SafetyRule } from '../../core/types';

// Safety rules owned by the Reglo ICC module: they turn pump channels off, so they live here.
// Shows two patterns the other modules do not:
// - rules GENERATED per channel in a loop (one per channel, each turning off only its own channel);
// - a rule that watches ANY module providing a capability ("stirrer"), whichever model it is.

const CHANNELS = [1, 2, 3, 4];

/** One volume limit per channel: stop a channel once it has dispensed its maximum. */
const volumeLimits: SafetyRule[] = CHANNELS.map((n) => ({
  key: `volume${n}`,
  label: `Ch ${n} volume limit`,
  why: 'A channel left running fills the flask past what the reaction (or the flask) can take. This stops the channel at a set volume. "Dispensed" is the app\'s estimate from the set rate, so calibrate the channel and keep a margin.',
  switches: [`run${n}`],
  defaultOn: false, // the right volume depends on the reaction; turn it on and set it per run
  settings: [
    { key: `volumeMax${n}`, label: `Ch ${n} max dispensed`, unit: 'mL', default: 10, min: 0.5, max: 5000, step: 0.5, hint: 'Channel stops at this volume.' },
  ],
  evaluate({ s, set }) {
    const max = set[`volumeMax${n}`];
    const v = s.values[`dispensed${n}`] ?? 0;
    if (v >= max) return { state: 'trip', text: `Ch ${n} dispensed ${v.toFixed(2)} mL, limit ${max} mL` };
    return { state: v >= max * 0.9 ? 'near' : s.switches[`run${n}`] ? 'ok' : 'idle', text: `${v.toFixed(2)} of ${max} mL` };
  },
}));

/** Dosing into an unstirred flask: reagent pools and can react all at once. */
const noStirring: SafetyRule = {
  key: 'noStirring',
  label: 'Dose only while stirring',
  why: 'Reagent added to an unstirred flask pools, then reacts all at once when stirring resumes (runaway exotherm). With a stirrer on the page, every channel stops when nothing is stirring. Any module that provides "stirrer" counts: an overhead stirrer or the hotplate\'s magnetic stirrer.',
  switches: CHANNELS.map((n) => `run${n}`),
  withPeer: 'stirrer',
  watchesActivity: 'stirring',
  watchNote: 'When nothing on the page has stirred for {noStirS} s, the pump stops dosing.',
  settings: [{ key: 'noStirS', label: 'Stop dosing after no stirring for', unit: 's', default: 5, min: 1, max: 120, step: 1 }],
  evaluate({ s, set, peers, mem, now }) {
    const dosing = CHANNELS.some((n) => s.switches[`run${n}`]);
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

export const regloSafety: ModuleSafety = {
  historyS: 0, // these rules need only the latest poll
  rules: [...volumeLimits, noStirring],
};
