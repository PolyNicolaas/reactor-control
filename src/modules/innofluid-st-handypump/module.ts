import { MODBUS } from '../../core/protocol';
import type { DeviceDriver } from '../../core/types';
import { pumpVolume } from '../shared/innofluid/pumpSafety';
import { handyPumpSafety } from './safety';
import { HandyPumpSim } from './sim';

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Innofluid ST-HandyPump with a HandyPump01 head — single-channel peristaltic pump, speed in rpm.
// The module to read for: Modbus RTU on RS-485 (core/modbus.ts), several pumps on ONE cable (each card
// owns an address), and a flow the app has to compute from rpm with a calibration it asks the user for.
// Sources (docs/manuals/innofluid-st-handypump/notes.md): Innofluid "Standard MODBUS Communication
// Protocol" (registers 1000–1002, p. 3–4) and the ST-HandyPump datasheet (Drifton, 2023).
// Our units: 2 × ST-HandyPump with HandyPump01 heads (Elexan quote 2611051v1, 2026-11-05). Not on the bench yet.
//
// How the app drives it:
// - The pump's own register map is three registers: start/stop (1000), direction (1001), speed (1002,
//   float rpm). It knows nothing about tubing, so the app turns rpm into mL/min with "mL per revolution",
//   a setting on the Volume limit rule (the one rule that needs millilitres). Calibrate it per tubing.
// - "Speed" and "Flow" are the set speed while the pump reports running, else 0. There is no tachometer.
// - Direction is read and recorded, never written: set it on the pump so the reagent flows into the
//   reactor (a reversed pump pulls from the flask). Same choice as the Reglo ICC.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** HandyPump datasheet: 0.1–300 rpm (the generic protocol sheet allows 600; the drive does not). */
export const MAX_RPM = 300;

/**
 * Default mL per revolution: the datasheet's largest tubing (25#, 365.69 mL/min at 300 rpm = 1.22 mL/rev).
 * Any smaller tubing moves less, so until the user calibrates, Dispensed reads HIGH and the volume limit
 * stops early, never late.
 */
export const DEFAULT_ML_PER_REV = 1.22;

export const REG = { run: 1000, direction: 1001, speed: 1002 } as const;

export const handyPump: DeviceDriver = {
  model: 'innofluidHandyPump',
  displayName: 'Innofluid ST-HandyPump',
  source: 'innofluid-st-handypump',
  kind: 'Peristaltic pump',
  protocol: MODBUS,
  serial: { baudRate: 9600, dataBits: 8, parity: 'even', stopBits: 1, flowControl: 'none' },
  // Modbus units have no name; any number back from R1001 means a pump answers at this address.
  identify: (reply) => /^\d+(\.\d+)?$/.test(reply.trim()),
  provides: ['pump', 'dosing'],
  groups: [{ key: 'ch1', label: 'Pump', channel: true }],
  readings: [
    { key: 'flow', label: 'Flow', unit: 'mL/min', chart: true, primary: true, decimals: 3, group: 'ch1' },
    { key: 'speed', label: 'Speed', unit: 'rpm', decimals: 1, group: 'ch1' },
    { key: 'dispensed', label: 'Dispensed', unit: 'mL', decimals: 2, group: 'ch1' },
    // 1 = running, 0 = stopped (p. 3). Read back every poll so a start or stop on the pump is seen.
    { key: 'running', label: 'Pump running', unit: '0/1', cmd: `R${REG.run}`, hidden: true, group: 'ch1' },
    // 1 = clockwise, 0 = counter-clockwise (p. 3). Recorded so a run shows which way the pump turned.
    { key: 'dir', label: 'Direction', unit: '1=CW/0=CCW', cmd: `R${REG.direction}`, everyN: 10, hidden: true, group: 'ch1' },
  ],
  setpoints: [
    {
      key: 'speed', label: 'Speed', unit: 'rpm', cmd: `WF${REG.speed}`, readCmd: `RF${REG.speed}`,
      min: 0.1, max: MAX_RPM, step: 0.1, decimals: 1,
      tolerance: 0.05, toleranceRel: 0.0005, // a float keeps ~7 figures
      actualKey: 'speed', switchKey: 'run', group: 'ch1',
    },
  ],
  switches: [{ key: 'run', label: 'Pump', on: `W${REG.run}=1`, off: `W${REG.run}=0`, group: 'ch1' }],
  formatSetpoint: (sp, v) => `${sp.cmd}=${v}`,
  stopCommands: [`W${REG.run}=0`],
  // No keypad lock to release: the pump's keys stay live while it is under Modbus control.
  derive: (s, dt, set) => {
    const mlPerRev = set.mlPerRev ?? DEFAULT_ML_PER_REV;
    const sp = s.setpoints.speed;
    const { rate, added } = pumpVolume(s, sp === undefined ? undefined : sp * mlPerRev, dt);
    s.values.flow = rate;
    s.values.speed = rate === 0 ? 0 : sp ?? rate / mlPerRev;
    s.values.dispensed = (s.values.dispensed ?? 0) + added;
  },
  safety: handyPumpSafety,
  simulate: () => new HandyPumpSim().transport,
  status: (s) => (s.switches.run || s.values.running === 1 ? 'Pumping' : 'Idle'),
};
