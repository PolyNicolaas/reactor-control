import { NamurSim, approach, noise } from '../shared/namurSim';

/**
 * Simulated EUROSTAR 60 control. The shared NamurSim does the protocol; this file is only physics:
 * speed follows the set speed while the motor is on, torque grows with speed and with a slowly
 * thickening mixture, and the PT1000 input reads room temperature.
 *
 * Extra test command: SIM_JAM 1 / 0 — the shaft is blocked (speed 0, torque at the limit).
 */
export class EurostarSim extends NamurSim {
  protected readonly name = 'IKA ES 60';
  private viscosity = 1;
  private jammed = false;

  constructor() {
    super();
    this.pv = { 3: 22, 4: 0, 5: 2 }; // 3 = PT1000 probe, 4 = speed, 5 = torque
    this.sp = { 4: 300 };
  }

  protected command(head: string, args: string[]): string | null | undefined {
    if (head === 'SIM_JAM') {
      this.jammed = args[0] === '1';
      return null;
    }
    return undefined;
  }

  // Like our ES 60 (user report 2026-10-26): after Motor off the motor does not run again until the
  // speed is applied. Modelled as STOP_4 clearing the set speed.
  protected switched(ch: number, on: boolean): void {
    if (ch === 4 && !on) this.sp[4] = 0;
  }

  protected step(dt: number): void {
    const target = this.on[4] && !this.jammed ? this.sp[4] ?? 0 : 0;
    this.pv[4] = Math.max(0, approach(this.pv[4] ?? 0, target, 1.5, dt));
    if (this.on[4]) this.viscosity = Math.min(this.viscosity + dt * 0.002, 3);
    this.pv[5] = this.jammed && this.on[4] ? 60 : Math.max(0, 1.5 + this.pv[4] * 0.008 * this.viscosity + noise(0.4));
    this.pv[3] = 22 + noise(0.2);
  }
}
