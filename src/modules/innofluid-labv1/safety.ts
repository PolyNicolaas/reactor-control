import type { ModuleSafety, SafetyRule } from '../../core/types';
import { noStirring, pumping, runReading, volumeLimit } from '../shared/innofluid/pumpSafety';

// Safety rules owned by the LabV1 module (they stop this pump). Shared rules come from
// ../shared/innofluid/pumpSafety.ts; the LabV adds one of its own because it has dispensing programs.

/**
 * The app counts Dispensed as rate × time and assumes the pump runs until told to stop. In the pump's
 * own dispensing modes it starts, stops and pauses by itself, so that count (and the volume limit) would
 * be wrong. The app sets Transferring on connect; this catches a change made on the pump's keypad.
 */
export const transferMode: SafetyRule = {
  key: 'transferMode',
  label: 'Transfer mode',
  why: 'The app sets the pump to Transferring (run until stopped) when it connects, because Dispensed and the volume limit assume that. In Fixed volume or Fixed time-and-volume mode the pump starts, stops and pauses by itself, so the app\'s numbers would be wrong. This stops the pump if its mode is changed on the pump.',
  switches: ['run'],
  evaluate({ s }) {
    const m = s.values.mode;
    if (m === undefined) return { state: 'idle', text: 'Mode not read yet' };
    const name = m === 0 ? 'Transferring' : m === 1 ? 'Fixed volume' : m === 2 ? 'Fixed time and volume' : `mode ${m}`;
    if (m === 0) return { state: pumping(s) ? 'ok' : 'idle', text: 'Transferring' };
    if (pumping(s)) return { state: 'trip', text: `Pump in ${name} mode while running` };
    return { state: 'near', text: `Pump in ${name} mode · set Transferring on the pump, or reconnect` };
  },
};

export const labV1Safety: ModuleSafety = {
  historyS: 0,
  rules: [runReading, transferMode, volumeLimit(), noStirring],
};
