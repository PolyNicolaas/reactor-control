import { ModbusSimTransport, ModbusSlave } from '../shared/innofluid/modbusSim';

/**
 * A fake LabV1-III: the Lab V Series register map behind real Modbus frames. The pump turns a flow
 * setpoint into a speed with its own calibration; here an EasyPump III with 25# tubing is taken as
 * 4.3 mL per revolution (645 mL/min at 150 rpm). Starts stopped, clockwise, in Fixed volume mode
 * (so the test can see the app put it in Transferring). Tests reach `slave` to act on the pump.
 */
export const SIM_ML_PER_REV = 4.3;

export class LabV1Sim {
  readonly slave: ModbusSlave;
  readonly transport: ModbusSimTransport;

  constructor(address = 1) {
    this.slave = new ModbusSlave(
      address,
      {
        1000: { min: 0, max: 255 },                 // pump head code
        1001: { min: 0, max: 255 },                 // tubing code
        1002: { float: true, min: 0.1, max: 150 }, 1003: {}, // speed, rpm (LabV1: 0.1–150)
        1004: { float: true, min: 0.0053, max: 99999 }, 1005: {}, // flow rate
        1007: { min: 0, max: 360 },                 // back suction angle
        1008: { min: 0, max: 1 },                   // start/stop
        1009: { min: 0, max: 1 },                   // direction
        1010: { min: 0, max: 1 },                   // full speed
        1015: { float: true, min: 0, max: 99999 }, 1016: {},
        1018: { float: true, min: 0.1, max: 9999 }, 1019: {},
        1020: { min: 0, max: 2 },                   // working mode
        1021: { float: true, min: 0.1, max: 9999 }, 1022: {},
        1023: { min: 0, max: 9999 },
      },
      (reg, v) => {
        // The pump keeps flow and speed in step through its calibration.
        if (reg === 1004) this.slave.set(1002, v / SIM_ML_PER_REV);
        if (reg === 1002) this.slave.set(1004, v * SIM_ML_PER_REV);
      },
    );
    this.slave.set(1001, 25);
    this.slave.set(1009, 1);
    this.slave.set(1020, 1);
    this.slave.set(1004, 10);
    this.slave.set(1002, 10 / SIM_ML_PER_REV);
    this.transport = new ModbusSimTransport(this.slave, 'LabV1-III');
  }
}
