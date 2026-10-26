import type { ModuleSafety, SafetyRule } from '../../core/types';

// Safety rules owned by the EUROSTAR 60 module. A rule lives in the module whose switch it turns off;
// this one turns off the motor, so it lives here.
//
// The unit protects itself against overload (errors 4 and 8 stop the motor; notes.md, "Error codes"), but its
// limit is the motor's, not the glassware's: a glass stirrer shaft or paddle can break well below it.

const torqueLimit: SafetyRule = {
  key: 'torque',
  label: 'Torque limit',
  why: 'A mixture that thickens or a paddle that catches the flask wall drives the torque up. The motor can push harder than a glass shaft or flask can take; this stops the motor before something breaks.',
  switches: ['motor'],
  settings: [
    {
      key: 'torqueMax', label: 'Max torque', unit: 'Ncm', default: 0, min: 0, max: 60, step: 1,
      hint: 'Motor off when the torque stays above this for 3 s. 0 = off. Pick it from a normal run with your shaft and flask (the torque is on the chart).',
    },
  ],
  evaluate({ s, history, set, now }) {
    if (!set.torqueMax) return { state: 'off', text: 'Off (set a max torque in Limits)' };
    const tq = s.values.torque;
    if (!s.switches.motor || tq === undefined) return { state: 'idle', text: 'Motor off' };
    // Over the limit for the last 3 s, so a single noisy reading does not stop the run.
    const recent = history.filter((x) => now - x.t <= 3000);
    const over = recent.length >= 2 && recent.every((x) => (x.values.torque ?? 0) > set.torqueMax);
    if (over) return { state: 'trip', text: `Torque ${tq.toFixed(1)} Ncm above the ${set.torqueMax} Ncm limit for 3 s` };
    return { state: tq > set.torqueMax * 0.8 ? 'near' : 'ok', text: `Torque ${tq.toFixed(1)} Ncm · stops above ${set.torqueMax} Ncm` };
  },
};

export const eurostarSafety: ModuleSafety = {
  historyS: 10,
  rules: [torqueLimit],
};
