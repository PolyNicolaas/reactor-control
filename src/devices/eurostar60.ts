import { NAMUR_SERIAL, type DeviceDriver } from '../core/types';

// IKA EUROSTAR 60 control — overhead stirrer.
// Source: operating instructions 20000003965c, p. 17 (see docs/manuals/eurostar-60-control/notes.md).
// Speed range 30–2000 rpm. This model has no watchdog command.
export const eurostar60: DeviceDriver = {
  model: 'eurostar60',
  displayName: 'EUROSTAR 60 control',
  kind: 'Overhead stirrer',
  serial: NAMUR_SERIAL,
  lineEnd: ' \r \n', // manual: "blank CR LF" (hex 20 0D 20 0A)
  identify: (name) => /EUROSTAR/i.test(name),
  readings: [
    { key: 'speed', label: 'Speed', unit: 'rpm', cmd: 'IN_PV_4', chart: true, primary: true },
    { key: 'torque', label: 'Torque', unit: 'Ncm', cmd: 'IN_PV_5', chart: true },
    { key: 'probe', label: 'Probe', unit: '°C', cmd: 'IN_PV_3', chart: true },
  ],
  setpoints: [
    {
      key: 'speed', label: 'Speed', unit: 'rpm', cmd: 'OUT_SP_4', readCmd: 'IN_SP_4',
      min: 30, max: 2000, step: 10, decimals: 0, tolerance: 1, actualKey: 'speed',
    },
  ],
  switches: [{ key: 'motor', label: 'Motor', on: 'START_4', off: 'STOP_4' }],
  stopCommands: ['STOP_4'],
  releaseCommand: 'RESET',
  status: (s) => (s.switches.motor ? 'Stirring' : 'Idle'),
};
