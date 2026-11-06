import type { ModuleSafety } from '../../core/types';
import { noStirring, runReading, volumeLimit } from '../shared/innofluid/pumpSafety';

// Safety rules owned by the ST-HandyPump module (they stop this pump). The rules themselves are shared
// with the LabV1 module (../shared/innofluid/pumpSafety.ts); what is particular here is the calibration:
// the pump only knows rpm, so "mL per revolution" lives with the Volume limit, the rule that needs mL.

export const handyPumpSafety: ModuleSafety = {
  historyS: 0, // these rules need only the latest poll (runReading keeps its own clock)
  rules: [
    runReading,
    volumeLimit(
      [{
        key: 'mlPerRev', label: 'mL per revolution', unit: 'mL', default: 1.22, min: 0.001, max: 5, step: 0.001,
        hint: 'Also sets the Flow and Dispensed shown on the card. Calibrate: run 60 s at 100 rpm into a tared vial, divide the mL by 100. The default (1.22, the biggest 25# tubing) reads high on smaller tubing, so the limit stops early until you calibrate.',
      }],
      ' This pump only knows its speed, so the app turns turns into millilitres with "mL per revolution", set here.',
    ),
    noStirring,
  ],
};
