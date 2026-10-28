import type { ModuleSafety, SafetyRule } from '../../core/types';

// TEMPLATE safety rules. Start by writing down, in plain words, what this unit can do that hurts
// someone or ruins a reaction, and which reading would show it first. Each answer is one rule.
// If the app cannot see any of it yet, leave `rules: []` and say so here.
// Principles and the list of capabilities for `withPeer`: ../README.md, "Safety rules".

/** A static limit: the simplest useful rule. */
const overTemp: SafetyRule = {
  key: 'overTemp',
  label: 'Block maximum',
  why: 'Explain what goes wrong without this rule, for the person reading the card.',
  switches: ['heater'],
  settings: [{ key: 'blockMax', label: 'Max block temperature', unit: '°C', default: 150, min: 30, max: 200, step: 5, hint: 'Heater off above this.' }],
  evaluate({ s, set }) {
    const v = s.values.temp;
    if (v === undefined) return { state: 'idle', text: 'No reading' };
    if (v > set.blockMax) return { state: 'trip', text: `Block ${v.toFixed(1)} °C is above the ${set.blockMax} °C maximum` };
    return { state: v > set.blockMax - 10 ? 'near' : 'ok', text: `Block ${v.toFixed(1)} °C · stops above ${set.blockMax} °C` };
  },
};

/** A rule that watches another module: armed only while a module providing "stirrer" is on the page. */
const heatOnlyWhileStirring: SafetyRule = {
  key: 'stirring',
  label: 'Heat only while stirring',
  why: 'Explain why this unit must not run while the partner is not doing its job.',
  switches: ['heater'],
  withPeer: 'stirrer',
  watchesActivity: 'stirring',  // which activity of the partner it depends on
  watchNote: 'Shown on the partner\'s card under "Watched by": what stopping it will do here.',
  settings: [{ key: 'noStirS', label: 'Heater off after no stirring for', unit: 's', default: 5, min: 1, max: 120, step: 1 }],
  evaluate({ s, set, peers, mem, history, now }) {
    // Act on readings, not only on the switch (principle 1): heating started on the unit's own keys
    // counts too, seen as the block warming by more than 2 °C over the last 20 s.
    const ago = history.find((x) => now - x.t <= 20_000)?.values.temp;
    const heating = s.switches.heater || (ago !== undefined && (s.values.temp ?? ago) > ago + 2);
    if (!heating) {
      mem.since = undefined;
      return { state: 'idle', text: 'Not heating' };
    }
    const stirring = peers.some((p) => p.live && p.active('stirring'));
    if (stirring) {
      mem.since = undefined;
      return { state: 'ok', text: `Stirring: ${peers.map((p) => p.label).join(', ')}` };
    }
    // Hold for a few seconds so one missed reading does not stop the run (principle 4).
    const since = (mem.since as number | undefined) ?? now;
    mem.since = since;
    const secs = Math.round((now - since) / 1000);
    if (now - since >= set.noStirS * 1000) return { state: 'trip', text: `Heating with nothing stirring for ${secs} s` };
    return { state: 'near', text: `Heating with nothing stirring for ${secs} s · stops at ${set.noStirS} s` };
  },
};

export const templateSafety: ModuleSafety = {
  historyS: 30, // seconds of history any rule needs (ctx.history); 0 if only the latest poll is used
  rules: [overTemp, heatOnlyWhileStirring],
};
