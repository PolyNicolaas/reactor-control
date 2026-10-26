import type { Transport } from '../../core/types';
import { sleep } from '../../core/serialTransport';

/**
 * Shared simulator for IKA units that speak NAMUR. It handles the protocol (IN_PV_x, IN_SP_x,
 * OUT_SP_x, START_x / STOP_x, RESET) so a module's own sim.ts only describes its physics:
 * the starting values, the name it answers, and how the values move in step().
 *
 * Channel numbers follow NAMUR: 1 = temperature control, 4 = speed (see each module's notes.md).
 *
 * Fault injection for testing safety rules, from tests or the bench terminal:
 *   SIM_PIN <ch> <value>   hold IN_PV_<ch> at a value (SIM_PIN <ch> releases it)
 * Modules may add their own SIM_ commands in command().
 */
export abstract class NamurSim implements Transport {
  readonly kind = 'sim' as const;
  onDisconnect?: () => void;
  onLog?: (dir: 'tx' | 'rx' | 'info', text: string) => void;

  /** Current values, by NAMUR channel. */
  protected pv: Record<number, number> = {};
  /** Set values, by NAMUR channel. */
  protected sp: Record<number, number> = {};
  /** Functions switched on with START_x, by channel. */
  protected on: Record<number, boolean> = {};
  private pinned: Record<number, number> = {};
  private last = performance.now();

  /** The IN_NAME reply, e.g. "IKA ES 60". */
  protected abstract readonly name: string;
  /** Move the values on by dt seconds. */
  protected abstract step(dt: number): void;

  /** Module-specific commands; return undefined to fall through to the shared protocol. */
  protected command(_head: string, _args: string[]): string | null | undefined {
    return undefined;
  }

  /** Reply to IN_PV_<ch>; override to model readings that are sometimes unavailable. */
  protected readPv(ch: number): string | null {
    return ch in this.pv ? `${this.pv[ch].toFixed(1)} ${ch}` : null;
  }

  /** Called after START_x / STOP_x; override to model what the unit does then. */
  protected switched(_ch: number, _on: boolean): void {}

  async open(): Promise<void> {
    this.onLog?.('info', `simulated ${this.name} connected`);
  }

  async close(): Promise<void> {}

  async request(cmd: string, expectReply: boolean): Promise<string | null> {
    this.onLog?.('tx', cmd);
    await sleep(25);
    const now = performance.now();
    this.step(Math.min((now - this.last) / 1000, 5));
    this.last = now;
    for (const [ch, v] of Object.entries(this.pinned)) this.pv[Number(ch)] = v;
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
    const [head, ...args] = cmd.split(/\s+/);
    const own = this.command(head, args);
    if (own !== undefined) return own;
    if (head === 'IN_NAME') return this.name;
    if (head === 'SIM_PIN') {
      const ch = Number(args[0]);
      if (args[1] === undefined) delete this.pinned[ch];
      else this.pinned[ch] = this.pv[ch] = Number(args[1]);
      return null;
    }
    if (head === 'RESET') {
      this.on = {};
      return null;
    }
    let m = /^IN_PV_(\d+)$/.exec(head);
    if (m) return this.readPv(Number(m[1]));
    m = /^IN_SP_(\d+)$/.exec(head);
    if (m) {
      const ch = Number(m[1]);
      return ch in this.sp ? `${this.sp[ch].toFixed(1)} ${ch}` : null;
    }
    m = /^OUT_SP_(\d+)$/.exec(head);
    if (m && args[0] !== undefined) {
      this.sp[Number(m[1])] = Number(args[0]);
      return null;
    }
    m = /^(START|STOP)_(\d+)$/.exec(head);
    if (m) {
      const ch = Number(m[2]);
      this.on[ch] = m[1] === 'START';
      this.switched(ch, this.on[ch]);
      return null;
    }
    return null;
  }
}

/** Helpers for step(): first-order approach to a target, and measurement noise. */
export const approach = (cur: number, target: number, tau: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-dt / tau));
export const noise = (a: number) => (Math.random() - 0.5) * a;
