import type { Transport } from '../core/types';
import { sleep } from '../core/serialTransport';

// Max flow (mL/min) per tubing inner diameter (mm) at 100 rpm, from the manual's chart (p. 16).
const MAX_FLOW: [number, number][] = [[0.76, 3.6], [1.02, 6.3], [1.52, 13], [2.06, 20], [2.54, 27], [3.17, 35]];
const maxFlowFor = (id: number) => (MAX_FLOW.find(([d]) => d >= id - 0.005) ?? MAX_FLOW[MAX_FLOW.length - 1])[1];

interface Chan {
  flow: number;       // mL/min
  running: boolean;
  mode: string;       // L, M, O, G, Q, N, P
  dir: 'J' | 'K';
  tubing: number;     // mm
}

/**
 * A fake Reglo ICC that answers the Ismatec protocol: status replies (*, #, +, -) with no line end,
 * data replies ending CR LF. Channel 2 has thinner tubing so "above the tubing maximum" can be tried.
 */
export class RegloSimTransport implements Transport {
  readonly kind = 'sim' as const;
  onDisconnect?: () => void;
  onLog?: (dir: 'tx' | 'rx' | 'info', text: string) => void;

  private chans: Chan[] = [1.52, 0.76, 1.52, 2.06].map((tubing) => ({ flow: 1, running: false, mode: 'L', dir: 'J', tubing }));
  private channelAddressing = false;

  async open(): Promise<void> {
    this.onLog?.('info', 'simulated Reglo ICC connected');
  }

  async close(): Promise<void> {}

  async request(cmd: string, expectReply: boolean): Promise<string | null> {
    this.onLog?.('tx', cmd);
    await sleep(15);
    const reply = this.handle(cmd.trim());
    this.onLog?.('rx', reply);
    return expectReply ? reply : null;
  }

  private handle(cmd: string): string {
    const m = /^(\d)(.*)$/.exec(cmd);
    if (!m) return '#';
    const addr = Number(m[1]);
    const rest = m[2];
    // Without channel addressing every channel-level command applies to all channels.
    const targets = this.channelAddressing && addr >= 1 && addr <= 4 ? [this.chans[addr - 1]] : this.chans;
    const ch = targets[0];
    const fmt1 = (v: number) => {
      const [mant, e] = v.toExponential(3).split('e');
      return `${mant.replace('.', '')}E${Number(e) < 0 ? '-' : '+'}${Math.abs(Number(e))}`;
    };

    if (rest === '#') return 'REGLO ICC 0208 406';
    if (rest === '(') return '0208';
    if (rest === '~') return this.channelAddressing ? '1' : '0';
    if (rest === '~1' || rest === '~0') {
      this.channelAddressing = rest === '~1';
      return '*';
    }
    if (/^xE[01]?$/.test(rest)) return rest === 'xE' ? '0' : '*';
    if (rest === 'xA') return '4';
    if (rest === 'E') return this.chans.some((c) => c.running) ? '+' : '-';
    if (rest === 'A' || rest === 'B') return '*';
    if ('LMOGQNP'.includes(rest) && rest.length === 1) {
      for (const c of targets) c.mode = rest;
      return '*';
    }
    if (rest === 'xM') return ch.mode;
    if (rest === 'xD') return ch.dir;
    if (rest === 'J' || rest === 'K') {
      for (const c of targets) c.dir = rest;
      return '*';
    }
    if (rest === 'H') {
      if (targets.some((c) => c.flow <= 0 || c.flow > maxFlowFor(c.tubing))) return '-';
      for (const c of targets) c.running = true;
      return '*';
    }
    if (rest === 'I' || rest === 'xI') {
      for (const c of targets) c.running = false;
      return '*';
    }
    if (rest === 'f') return fmt1(ch.flow);
    let v = /^f(\d{4})([+-]\d)$/.exec(rest);
    if (v) {
      const flow = Number(`${v[1][0]}.${v[1].slice(1)}e${v[2]}`);
      for (const c of targets) c.flow = flow;
      return fmt1(flow);
    }
    if (rest === '+') return `${ch.tubing.toFixed(2)} mm`;
    if (rest === '?') return `${maxFlowFor(ch.tubing).toFixed(2)} ml/min`;
    if (rest === 'xe') return ch.flow > maxFlowFor(ch.tubing) ? `R ${fmt1(maxFlowFor(ch.tubing))}` : `R ${fmt1(0)}`;
    v = /^\+(\d{4})$/.exec(rest);
    if (v) {
      for (const c of targets) c.tubing = Number(v[1]) / 100;
      return '*';
    }
    return '#';
  }
}
