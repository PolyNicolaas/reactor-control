import { MODBUS } from '../../core/protocol';
import type { DeviceDriver } from '../../core/types';
import { reconcileRun } from '../shared/innofluid/pumpSafety';
import { labV1Safety } from './safety';
import { LabV1Sim } from './sim';

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Innofluid LabV1-III with an EasyPump III head — dispensing peristaltic pump, flow in mL/min.
// The module to read for: a second register map on the same Modbus cable as the ST-HandyPump, a pump
// that converts mL/min to rpm itself (calibrated on the pump), and an init command that puts the pump in
// the one working mode the app can follow.
// Sources (docs/manuals/innofluid-labv1/notes.md): "Lab V Series MODBUS Protocol" (registers 1000–1023,
// 2001–2006), the LabV Series user manual, and Darwin Microfluidics' LabV Modbus article with frames.
// Our unit: 1 × LabV1-EP3, EasyPump III, 0.0053–645 mL/min (Elexan quote 2611051v1). Not on the bench yet.
//
// How the app drives it:
// - Working mode Transferring (1020 = 0) on every connect: the pump then runs until told to stop, so
//   Dispensed = rate × time holds. Its own dispensing modes start, stop and pause by themselves; a rule
//   stops the pump if someone switches to one on the keypad.
// - Flow setpoint in mL/min (1004, float). The pump computes the speed from its head, tubing and its own
//   calibration (Test / CAL on the pump), and the app reads that speed back (1002).
// - "Flow" is the set rate while the pump reports running (1008), else 0; "Dispensed" its integral.
// - Direction (1009) is read and recorded, never written. Full speed (1010, for priming) is not used.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Quote and product page: EasyPump III on a LabV1-III, 0.0053–645 mL/min (bench: the pump's real limits). */
export const MAX_FLOW = 645;

export const REG = {
  head: 1000, tubing: 1001, speed: 1002, flow: 1004, backSuction: 1007,
  run: 1008, direction: 1009, fullSpeed: 1010, volume: 1015, workTime: 1018,
  mode: 1020, pause: 1021, copies: 1023,
} as const;

export const labV1: DeviceDriver = {
  model: 'innofluidLabV1',
  displayName: 'Innofluid LabV1-III',
  source: 'innofluid-labv1',
  kind: 'Peristaltic pump',
  protocol: MODBUS,
  serial: { baudRate: 9600, dataBits: 8, parity: 'even', stopBits: 1, flowControl: 'none' },
  identify: (reply) => /^\d+(\.\d+)?$/.test(reply.trim()),
  provides: ['pump', 'dosing'],
  groups: [{ key: 'ch1', label: 'Pump', channel: true }],
  readings: [
    { key: 'flow', label: 'Flow', unit: 'mL/min', chart: true, primary: true, decimals: 3, group: 'ch1' },
    { key: 'dispensed', label: 'Dispensed', unit: 'mL', decimals: 2, group: 'ch1' },
    // The speed the pump chose for the set flow (its calibration). Every other poll.
    { key: 'speed', label: 'Pump speed', unit: 'rpm', cmd: `RF${REG.speed}`, everyN: 2, decimals: 1, group: 'ch1' },
    { key: 'running', label: 'Pump running', unit: '0/1', cmd: `R${REG.run}`, hidden: true, group: 'ch1' },
    // 0 Transferring, 1 Fixed volume, 2 Fixed time and volume. The Transfer mode rule watches it.
    { key: 'mode', label: 'Working mode', unit: '0=transfer', cmd: `R${REG.mode}`, everyN: 5, hidden: true, group: 'ch1' },
    { key: 'dir', label: 'Direction', unit: '1=CW/0=CCW', cmd: `R${REG.direction}`, everyN: 10, hidden: true, group: 'ch1' },
    // Codes from the protocol's Chart 1; recorded so a run shows which head and tubing the pump assumed.
    { key: 'head', label: 'Pump head code', unit: 'code', cmd: `R${REG.head}`, everyN: 10, hidden: true, group: 'ch1' },
    { key: 'tubing', label: 'Tubing code', unit: 'code', cmd: `R${REG.tubing}`, everyN: 10, hidden: true, group: 'ch1' },
  ],
  setpoints: [
    {
      key: 'flow', label: 'Flow', unit: 'mL/min', cmd: `WF${REG.flow}`, readCmd: `RF${REG.flow}`,
      min: 0.01, max: MAX_FLOW, step: 0.01, decimals: 3,
      tolerance: 0.0005, toleranceRel: 0.0005,
      actualKey: 'flow', switchKey: 'run', group: 'ch1',
    },
  ],
  switches: [{ key: 'run', label: 'Pump', on: `W${REG.run}=1`, off: `W${REG.run}=0`, group: 'ch1' }],
  initCommands: [`W${REG.mode}=0`], // Transferring: runs until told to stop
  formatSetpoint: (sp, v) => `${sp.cmd}=${v}`,
  stopCommands: [`W${REG.run}=0`],
  derive: (s, dt) => {
    const on = reconcileRun(s);
    const flow = on ? s.setpoints.flow ?? 0 : 0;
    s.values.flow = flow;
    s.values.dispensed = (s.values.dispensed ?? 0) + (flow * Math.min(dt, 10)) / 60;
  },
  safety: labV1Safety,
  simulate: () => new LabV1Sim().transport,
  status: (s) => (s.switches.run || s.values.running === 1 ? 'Pumping' : 'Idle'),
};
