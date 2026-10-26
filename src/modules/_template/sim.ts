import { NamurSim, approach, noise } from '../shared/namurSim';

/**
 * TEMPLATE simulator. For an IKA/NAMUR unit, extend NamurSim and describe only the physics:
 * the reply to IN_NAME, starting values by NAMUR channel, and how they move in step().
 * For another protocol, write a small Transport instead (see ../reglo-icc/sim.ts).
 * Add SIM_… commands in command() for the faults your safety rules must catch.
 */
export class TemplateSim extends NamurSim {
  protected readonly name = 'EXAMPLE BLOCK';

  constructor() {
    super();
    this.pv = { 1: 22 }; // 1 = block temperature
    this.sp = { 1: 60 };
  }

  protected step(dt: number): void {
    const target = this.on[1] ? this.sp[1] ?? 22 : 22;
    this.pv[1] = approach(this.pv[1], target, 30, dt) + noise(0.1);
  }
}
