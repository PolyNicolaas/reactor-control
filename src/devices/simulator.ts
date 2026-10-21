import type { Transport } from '../core/types';
import { sleep } from '../core/serialTransport';

/**
 * A fake IKA device that answers NAMUR commands, so the whole app can be built and
 * tested without the bench. Channel numbers follow the NAMUR convention:
 * 1 = temperature control, 4 = speed.
 */
export class SimTransport implements Transport {
  readonly kind = 'sim' as const;
  onDisconnect?: () => void;
  onLog?: (dir: 'tx' | 'rx' | 'info', text: string) => void;

  private pv: Record<number, number> = {};
  private sp: Record<number, number> = {};
  private on: Record<number, boolean> = {};
  private last = performance.now();
  private viscosity = 1;

  constructor(readonly model: 'eurostar60' | 'retControlVisc') {
    if (model === 'eurostar60') {
      this.pv = { 3: 22, 4: 0, 5: 2 };
      this.sp = { 4: 300 };
    } else {
      this.pv = { 1: 22, 2: 22, 3: 380, 4: 0, 5: 0 };
      this.sp = { 1: 50, 4: 400 };
    }
  }

  async open(): Promise<void> {
    this.onLog?.('info', `simulated ${this.model} connected`);
  }

  async close(): Promise<void> {}

  async request(cmd: string, expectReply: boolean): Promise<string | null> {
    this.onLog?.('tx', cmd);
    await sleep(25);
    this.step();
    const reply = this.handle(cmd.trim());
    if (reply !== null) this.onLog?.('rx', reply);
    if (!expectReply) return null;
    if (reply === null) {
      await sleep(150);
      throw new Error(`No reply to ${cmd}`);
    }
    return reply;
  }

  private handle(cmd: string): string | null {
    const [head, arg] = cmd.split(/\s+/);
    if (head === 'IN_NAME') return this.model === 'eurostar60' ? 'EUROSTAR 60 control' : 'RET control-visc';
    if (head === 'RESET') {
      this.on = {};
      return null;
    }
    let m = /^IN_PV_(\d+)$/.exec(head);
    if (m) {
      const ch = Number(m[1]);
      return ch in this.pv ? `${this.pv[ch].toFixed(1)} ${ch}` : null;
    }
    m = /^IN_SP_(\d+)$/.exec(head);
    if (m) {
      const ch = Number(m[1]);
      return ch in this.sp ? `${this.sp[ch].toFixed(1)} ${ch}` : null;
    }
    m = /^OUT_SP_(\d+)$/.exec(head);
    if (m && arg !== undefined) {
      this.sp[Number(m[1])] = Number(arg);
      return null;
    }
    m = /^(START|STOP)_(\d+)$/.exec(head);
    if (m) {
      this.on[Number(m[2])] = m[1] === 'START';
      return null;
    }
    return null;
  }

  private step(): void {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 5);
    this.last = now;
    const noise = (a: number) => (Math.random() - 0.5) * a;
    const approach = (cur: number, target: number, tau: number) => cur + (target - cur) * (1 - Math.exp(-dt / tau));

    // Speed (channel 4) on both models.
    const speedTarget = this.on[4] ? this.sp[4] ?? 0 : 0;
    this.pv[4] = Math.max(0, approach(this.pv[4] ?? 0, speedTarget, 1.5));

    if (this.model === 'eurostar60') {
      if (this.on[4]) this.viscosity = Math.min(this.viscosity + dt * 0.002, 3);
      this.pv[5] = Math.max(0, 1.5 + this.pv[4] * 0.008 * this.viscosity + noise(0.4));
      this.pv[3] = 22 + noise(0.2);
    } else {
      const sp = this.sp[1] ?? 22;
      const probe = this.pv[1];
      const plateTarget = this.on[1] ? Math.min(340, sp + Math.max(0, Math.min(40, (sp - probe) * 1.5))) : 22;
      const plate = this.pv[2];
      // Plate heats at most ~15 °C/min, cools slowly.
      const next = approach(plate, plateTarget, plateTarget > plate ? 40 : 300);
      this.pv[2] = plateTarget > plate ? Math.min(next, plate + dt * 0.25) : next;
      this.pv[1] = approach(probe, this.pv[2], 60) + noise(0.1);
      if (this.on[4]) this.viscosity = Math.min(this.viscosity + dt * 0.001, 2);
      this.pv[5] = this.on[4] ? (this.viscosity - 1) * 100 + noise(1) : 0;
    }
  }
}
