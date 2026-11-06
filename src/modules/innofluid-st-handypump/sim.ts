import { ModbusSimTransport, ModbusSlave } from '../shared/innofluid/modbusSim';

/**
 * A fake ST-HandyPump: the three registers of the Innofluid standard Modbus sheet (p. 3), with its
 * ranges, behind real Modbus frames. Speed starts at 100 rpm, clockwise, stopped. Tests reach
 * `slave` to press keys on the pump (`slave.set(1000, 0)`) or pull the cable (`slave.fault = 'silent'`).
 */
export class HandyPumpSim {
  readonly slave = new ModbusSlave(1, {
    1000: { min: 0, max: 1 },            // start/stop
    1001: { min: 0, max: 1 },            // direction: 1 clockwise, 0 counter-clockwise
    1002: { float: true, min: 0.1, max: 600 }, // speed, rpm (the sheet's range; the drive tops out at 300)
    1003: {},                            // low word of the speed float
  });
  readonly transport: ModbusSimTransport;

  constructor(address = 1) {
    this.slave.address = address;
    this.slave.set(1001, 1);
    this.slave.set(1002, 100);
    this.transport = new ModbusSimTransport(this.slave, 'ST-HandyPump');
  }
}
