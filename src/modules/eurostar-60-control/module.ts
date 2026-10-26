import { NAMUR_SERIAL, type DeviceDriver } from '../../core/types';
import { eurostarSafety } from './safety';
import { EurostarSim } from './sim';

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// IKA EUROSTAR 60 control — overhead stirrer.
// The smallest module: start here when learning how a module is built (src/modules/README.md).
// Every fact below comes from the manual and is cited in docs/manuals/eurostar-60-control/notes.md:
// operating instructions 20000003965c, interface p. 17. Speed range 30–2000 rpm. No watchdog command.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
export const eurostar60: DeviceDriver = {
  // 1. Identity — how the app names it, and how it recognises the unit on a port.
  model: 'eurostar60',
  displayName: 'EUROSTAR 60 control',
  source: 'eurostar-60-control',
  kind: 'Overhead stirrer',
  // Our unit answers IN_NAME with "IKA ES 60" (bench, 2026-10-21). EUROSTAR 100 matches too.
  identify: (name) => /EUROSTAR|\bES ?(60|100)\b/i.test(name),
  // What it brings to a page. Other modules' safety rules look for these, never for the model name,
  // so a different stirrer that also says "stirrer" is covered by them.
  provides: ['stirrer', 'overhead-stirrer'],

  // 2. Connection — serial settings and line end, straight from the manual.
  serial: NAMUR_SERIAL,
  lineEnd: ' \r \n', // manual: "blank CR LF" (hex 20 0D 20 0A)

  // 3. Readings — polled every second. `activity` turns a reading into an on/off fact other code can
  //    use: camera clips when stirring starts/stops, and other modules' rules ("is anything stirring?").
  readings: [
    { key: 'speed', label: 'Speed', unit: 'rpm', cmd: 'IN_PV_4', chart: true, primary: true, activity: { name: 'stirring', above: 20, switchKey: 'motor' } },
    { key: 'torque', label: 'Torque', unit: 'Ncm', cmd: 'IN_PV_5', chart: true },
    { key: 'probe', label: 'Probe', unit: '°C', cmd: 'IN_PV_3', chart: true },
  ],

  // 4. Setpoints — what the user can set. `switchKey` links it to the switch that makes the unit act
  //    on it, which gives the card its "Set 400 · actual 398 rpm ✓" line.
  setpoints: [
    {
      key: 'speed', label: 'Speed', unit: 'rpm', cmd: 'OUT_SP_4', readCmd: 'IN_SP_4',
      min: 30, max: 2000, step: 10, decimals: 0, tolerance: 1, actualKey: 'speed', switchKey: 'motor',
    },
  ],

  // 5. Switches — on/off functions.
  switches: [{ key: 'motor', label: 'Motor', on: 'START_4', off: 'STOP_4' }],

  // 6. Stop and release — what Stop all sends, and what hands the unit back to its own keypad.
  stopCommands: ['STOP_4'],
  releaseCommand: 'RESET',

  // 7. Status — one word for the card header.
  status: (s) => (s.switches.motor ? 'Stirring' : 'Idle'),

  // 8. Safety — rules this module owns (see safety.ts). Shown live on the card.
  safety: eurostarSafety,

  // 9. Simulator — a fake unit for tests and for trying the app without hardware (see sim.ts).
  simulate: () => new EurostarSim(),
};
