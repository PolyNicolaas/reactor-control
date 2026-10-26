import { NamurSim, approach, noise } from '../shared/namurSim';

/**
 * Simulated RET control-visc. The shared NamurSim does the protocol; this file is only physics:
 * - the plate is driven toward a target that depends on how far the PROBE is below the setpoint
 *   (like the real unit with the PT100 plugged in), heats at most ~15 °C/min and cools slowly;
 * - the probe follows the plate (the medium), or room temperature when it is out of the medium;
 * - the balance answers "0.0 90" until "G" is pressed (here: 5 s after connect) and while heating
 *   or stirring, like our unit.
 *
 * Extra test command: SIM_PROBE_OUT 1 / 0 — probe out of the medium; the plate then keeps heating
 * toward the safety limit, which is exactly what the safety rules in safety.ts must catch.
 */
export class RetSim extends NamurSim {
  protected readonly name = 'RET control-visc';
  private viscosity = 1;
  private load = 412.6; // beaker + 250 mL water, g
  private weighFrom = performance.now() + 5000; // stands in for pressing G on the unit
  private probeOut = false;

  constructor() {
    super();
    // 1 = probe, 2 = plate, 3 = safety limit, 4 = speed, 5 = viscosity trend, 90 = mass
    this.pv = { 1: 22, 2: 22, 3: 380, 4: 0, 5: 0, 90: 0 };
    this.sp = { 1: 50, 4: 400 };
  }

  protected command(head: string, args: string[]): string | null | undefined {
    if (head === 'SIM_PROBE_OUT') {
      this.probeOut = args[0] === '1';
      return null;
    }
    return undefined;
  }

  // Like our RET: "0.0 90" outside weighing mode, the mass in weighing mode.
  protected readPv(ch: number): string | null {
    if (ch === 90 && (performance.now() < this.weighFrom || this.on[1] || this.on[4])) return '0.0 90';
    return super.readPv(ch);
  }

  protected step(dt: number): void {
    const speedTarget = this.on[4] ? this.sp[4] ?? 0 : 0;
    this.pv[4] = Math.max(0, approach(this.pv[4] ?? 0, speedTarget, 1.5, dt));

    const sp = this.sp[1] ?? 22;
    const probe = this.pv[1];
    const boost = this.probeOut ? 400 : Math.min(40, (sp - probe) * 1.5);
    const plateTarget = this.on[1] ? Math.min(340, this.pv[3], sp + Math.max(0, boost)) : 22;
    const plate = this.pv[2];
    const next = approach(plate, plateTarget, plateTarget > plate ? 40 : 300, dt);
    this.pv[2] = plateTarget > plate ? Math.min(next, plate + dt * 0.25) : next;
    this.pv[1] = approach(probe, this.probeOut ? 22 : this.pv[2], 60, dt) + noise(0.1);

    if (this.on[4]) this.viscosity = Math.min(this.viscosity + dt * 0.001, 2);
    if (this.pv[1] > 40) this.load -= dt * (this.pv[1] - 40) * 0.0004; // evaporation
    const settle = Math.max(0, 1 - (performance.now() - this.weighFrom) / 4000); // wobbles for ~4 s
    this.pv[90] = Math.round(this.load + noise(0.6) + settle * 30 * Math.sin(performance.now() / 300));
    if (this.on[1] || this.on[4]) this.weighFrom = performance.now() + 5000; // leaves weighing mode
    this.pv[5] = this.on[4] ? (this.viscosity - 1) * 100 + noise(1) : 0;
  }
}
