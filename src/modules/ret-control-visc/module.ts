import { NAMUR_SERIAL, type DeviceDriver } from '../../core/types';
import { retSafety } from './safety';
import { RetSim } from './sim';
import { solventCaution } from './solvents';

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// IKA RET control-visc — hotplate stirrer (0–340 °C plate, external PT100 probe, built-in balance).
// The fullest module: readings that are only valid in some states, a software tare, safety rules that
// learn and that watch other modules, a HOT warning and a caution list. Read the EUROSTAR module first.
// Facts: operating instructions 20000004159, p. 31–33, cited in docs/manuals/ret-control-visc/notes.md.
// Keep the unit's "Eurostar control" setting OFF (manual p. 26): with it on, the RET itself talks to a
// EUROSTAR and stops heating when that link drops — the app's safety rules do that job instead.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
export const retControlVisc: DeviceDriver = {
  // 1. Identity
  model: 'retControlVisc',
  displayName: 'RET control-visc',
  source: 'ret-control-visc',
  kind: 'Hotplate stirrer',
  identify: (name) => /\bRET\b|IKARET/i.test(name),
  provides: ['hotplate', 'heater', 'stirrer', 'magnetic-stirrer'],

  // 2. Connection
  serial: NAMUR_SERIAL,
  lineEnd: '\r\n',

  // 3. Readings. pH (IN_PV_80) is not polled: it needs the pH electrode fitted, and the unit returns a
  //    plausible number without one (bench 2026-10-22).
  readings: [
    { key: 'probe', label: 'Probe', unit: '°C', cmd: 'IN_PV_1', chart: true, primary: true },
    { key: 'plate', label: 'Plate', unit: '°C', cmd: 'IN_PV_2', chart: true },
    { key: 'speed', label: 'Speed', unit: 'rpm', cmd: 'IN_PV_4', chart: true, activity: { name: 'stirring', above: 20 } },
    { key: 'viscosity', label: 'Viscosity trend', unit: 'trend', cmd: 'IN_PV_5', chart: true },
    // The hardware cut-off, set on the unit itself. The app only reads it.
    { key: 'safety', label: 'Safety limit', unit: '°C', cmd: 'IN_PV_3' },
    // Built-in balance: 10–5000 g, accuracy ±(0.3 % + 2 g) (manual p. 35). The device only weighs
    // with heating and stirring off (p. 25), so readings at other times are shown and recorded as blank.
    // The app tares in software; the manual lists no tare command.
    {
      key: 'mass', label: 'Mass', unit: 'g', cmd: 'IN_PV_90', chart: true, tareable: true, decimals: 0,
      // Bench 2026-10-22: outside weighing mode IN_PV_90 answers "0.0 90"; in weighing mode the mass
      // ("122.0 90"). So exactly 0 is treated as "not weighing". Whole grams only.
      optional: { retryMs: 3000, missingNote: 'Press the weighing key (G) on the RET and wait for it to settle', zeroMeansMissing: true },
      stable: { span: 1, count: 3 },
      validWhen: (s) => !s.switches.heater && !s.switches.stirrer,
      invalidNote: 'Turn heating and stirring off to weigh',
    },
  ],

  // 4. Setpoints. With the probe plugged in, "temp" is the MEDIUM temperature; the unit drives the
  //    plate as hot as it takes to get there (see safety.ts for why that matters).
  setpoints: [
    {
      key: 'temp', label: 'Temperature', unit: '°C', cmd: 'OUT_SP_1', readCmd: 'IN_SP_1',
      min: 0, max: 340, step: 1, decimals: 1, tolerance: 0.5, actualKey: 'probe', switchKey: 'heater', graceS: 90,
    },
    {
      key: 'speed', label: 'Speed', unit: 'rpm', cmd: 'OUT_SP_4', readCmd: 'IN_SP_4',
      min: 50, max: 1700, step: 10, decimals: 0, tolerance: 1, actualKey: 'speed', switchKey: 'stirrer',
    },
  ],

  // 5. Switches
  switches: [
    { key: 'heater', label: 'Heater', on: 'START_1', off: 'STOP_1', confirmOn: 'Turn the heater on?' },
    { key: 'stirrer', label: 'Stirrer', on: 'START_4', off: 'STOP_4' },
  ],

  // 6. Stop and release
  stopCommands: ['STOP_1', 'STOP_4'],
  releaseCommand: 'RESET',
  // Documented in the manual (p. 31); not used by the app until tried on the bench.
  watchdog: { verified: false, arm: (s) => `OUT_WD1@${s}` },

  // 7. Status
  status: (s) => {
    if (s.switches.heater) {
      const t = s.values.probe ?? s.values.plate;
      const sp = s.setpoints.temp;
      if (t !== undefined && sp !== undefined && Math.abs(t - sp) <= 2) return 'At temp';
      return 'Heating';
    }
    return s.switches.stirrer ? 'Stirring' : 'Idle';
  },

  // 8. Safety — rules (safety.ts), the HOT warning, and the solvent autoignition list (solvents.ts).
  safety: retSafety,
  // The plate stays hot long after the heater is off: HOT on the card from 50 °C, during and after a run.
  hot: { key: 'plate', above: 50 },
  cautions: [solventCaution],

  // 9. Simulator
  simulate: () => new RetSim(),
};
