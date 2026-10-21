import { NAMUR_SERIAL, type DeviceDriver } from '../core/types';

// IKA RET control-visc — hotplate stirrer (0–340 °C plate, external PT100 probe).
// Viscosity trend, pH and weight (IN_PV_5 / IN_PV_80 / IN_PV_90) are left out until
// they are checked on the bench terminal; add them here once verified.
// Note: turn OFF the "Eurostar" option in the device's system settings, otherwise the
// heater switches off when the serial cable is unplugged.
export const retControlVisc: DeviceDriver = {
  model: 'retControlVisc',
  displayName: 'RET control-visc',
  kind: 'Hotplate stirrer',
  serial: NAMUR_SERIAL,
  identify: (name) => /RET/i.test(name),
  readings: [
    { key: 'probe', label: 'Probe', unit: '°C', cmd: 'IN_PV_1', chart: true, primary: true },
    { key: 'plate', label: 'Plate', unit: '°C', cmd: 'IN_PV_2', chart: true },
    { key: 'speed', label: 'Speed', unit: 'rpm', cmd: 'IN_PV_4', chart: true },
    { key: 'safety', label: 'Safety limit', unit: '°C', cmd: 'IN_PV_3' },
  ],
  setpoints: [
    {
      key: 'temp', label: 'Temperature', unit: '°C', cmd: 'OUT_SP_1', readCmd: 'IN_SP_1',
      min: 0, max: 340, step: 1, decimals: 1, tolerance: 0.5, actualKey: 'probe',
    },
    {
      key: 'speed', label: 'Speed', unit: 'rpm', cmd: 'OUT_SP_4', readCmd: 'IN_SP_4',
      min: 50, max: 1700, step: 10, decimals: 0, tolerance: 1, actualKey: 'speed',
    },
  ],
  switches: [
    { key: 'heater', label: 'Heater', on: 'START_1', off: 'STOP_1', confirmOn: 'Turn the heater on?' },
    { key: 'stirrer', label: 'Stirrer', on: 'START_4', off: 'STOP_4' },
  ],
  stopCommands: ['STOP_1', 'STOP_4'],
  releaseCommand: 'RESET',
  // Unverified on this model: enable only after testing on the bench.
  watchdog: { verified: false, arm: (s) => `OUT_WD1@${s}` },
  status: (s) => {
    if (s.switches.heater) {
      const t = s.values.probe ?? s.values.plate;
      const sp = s.setpoints.temp;
      if (t !== undefined && sp !== undefined && Math.abs(t - sp) <= 2) return 'At temp';
      return 'Heating';
    }
    return s.switches.stirrer ? 'Stirring' : 'Idle';
  },
};
