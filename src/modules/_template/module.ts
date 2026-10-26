import { NAMUR_SERIAL, type DeviceDriver } from '../../core/types';
import { templateSafety } from './safety';
import { TemplateSim } from './sim';

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// TEMPLATE — copy this folder to src/modules/<module-id>/ to start a new module (see ../README.md).
// This example describes a made-up IKA-style heating block so that it compiles and its test runs;
// replace every value with facts from YOUR unit's manual, cited in docs/manuals/<module-id>/notes.md.
// It is NOT listed in src/modules/index.ts, so the app does not offer it.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
export const templateModule: DeviceDriver = {
  // 1. Identity ─────────────────────────────────────────────────────────────────────────────────
  model: 'templateBlock',          // stable id, saved in pages: never change it once used
  displayName: 'Example block',    // shown on the card
  source: '_template',             // this folder's name: links the card to this module's README
  kind: 'Heating block',
  // Match the reply to the identify command (IN_NAME for NAMUR). Test it against the real reply.
  identify: (name) => /EXAMPLE BLOCK/i.test(name),
  // What this unit does for a page. Other modules' safety rules look for these words (README table).
  provides: ['heater'],

  // 2. Connection ───────────────────────────────────────────────────────────────────────────────
  serial: NAMUR_SERIAL,            // 9600 7E1 for IKA; otherwise the manual's settings
  lineEnd: '\r\n',
  // protocol: ISMATEC,            // only if not NAMUR (see reglo-icc)

  // 3. Readings ─────────────────────────────────────────────────────────────────────────────────
  readings: [
    { key: 'temp', label: 'Block', unit: '°C', cmd: 'IN_PV_1', chart: true, primary: true },
    // { key: 'speed', label: 'Speed', unit: 'rpm', cmd: 'IN_PV_4', chart: true, activity: { name: 'stirring', above: 20 } },
  ],

  // 4. Setpoints ────────────────────────────────────────────────────────────────────────────────
  setpoints: [
    {
      key: 'temp', label: 'Temperature', unit: '°C', cmd: 'OUT_SP_1', readCmd: 'IN_SP_1',
      min: 0, max: 200, step: 1, decimals: 1, tolerance: 0.5,
      actualKey: 'temp',           // the reading this setpoint drives
      switchKey: 'heater',         // the switch that makes the unit act on it
      graceS: 90,                  // temperatures move slowly: wait before calling it "not following"
    },
  ],

  // 5. Switches ─────────────────────────────────────────────────────────────────────────────────
  switches: [{ key: 'heater', label: 'Heater', on: 'START_1', off: 'STOP_1', confirmOn: 'Turn the heater on?' }],

  // 6. Stop and release ─────────────────────────────────────────────────────────────────────────
  stopCommands: ['STOP_1'],
  releaseCommand: 'RESET',

  // 7. Status ───────────────────────────────────────────────────────────────────────────────────
  status: (s) => (s.switches.heater ? 'Heating' : 'Idle'),

  // 8. Safety ───────────────────────────────────────────────────────────────────────────────────
  safety: templateSafety,
  hot: { key: 'temp', above: 50 }, // optional: HOT badge on the card

  // 9. Simulator ────────────────────────────────────────────────────────────────────────────────
  simulate: () => new TemplateSim(),
};
