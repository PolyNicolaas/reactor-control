import { bytesFloat, decodeReply, encodeRequest, floatBytes, parseCommand, withCrc, crcOk } from '../../../core/modbus';
import type { Transport } from '../../../core/types';

/**
 * A simulated Modbus RTU unit: a bank of 16-bit holding registers that answers real frames
 * (functions 03, 06, 10, exceptions 01/02/03/06), so the simulators and tests go through the same
 * encoding, CRC and echo checks as the hardware. Modules describe their registers and physics on top.
 */
export interface RegisterSpec {
  /** A float spans this register and the next (big-endian). */
  float?: boolean;
  /** Written values outside this range get exception 03, as the manual says. */
  min?: number;
  max?: number;
  /** Read-only registers refuse writes with exception 02. */
  readOnly?: boolean;
}

export class ModbusSlave {
  readonly regs = new Map<number, number>();
  /** A fault to simulate: 'silent' = no reply (cable off, wrong address), 'busy' = exception 06 (pump in a menu). */
  fault?: 'silent' | 'busy';

  constructor(
    public address: number,
    readonly map: Record<number, RegisterSpec>,
    private onWrite: (reg: number, value: number) => void = () => {},
  ) {
    for (const r of Object.keys(map)) this.regs.set(Number(r), 0);
  }

  get(reg: number): number {
    if (this.map[reg]?.float) return bytesFloat([this.regs.get(reg)! >> 8, this.regs.get(reg)! & 0xff, this.regs.get(reg + 1)! >> 8, this.regs.get(reg + 1)! & 0xff]);
    return this.regs.get(reg) ?? 0;
  }

  /** Set a value as the pump itself would (keypad, physics); no range check. */
  set(reg: number, v: number): void {
    if (this.map[reg]?.float) {
      const b = floatBytes(v);
      this.regs.set(reg, (b[0] << 8) | b[1]);
      this.regs.set(reg + 1, (b[2] << 8) | b[3]);
    } else {
      this.regs.set(reg, v & 0xffff);
    }
  }

  /** Answer one request frame; undefined = no reply (wrong address, bad CRC, broadcast, fault). */
  handle(frame: Uint8Array): Uint8Array | undefined {
    if (!crcOk(frame)) return undefined; // the manual: a bad CRC gets no reply
    const [addr, fn] = frame;
    if (addr !== this.address && addr !== 0) return undefined;
    if (this.fault === 'silent') return undefined;
    const reply = (bytes: number[]) => (addr === 0 ? undefined : withCrc(bytes));
    const err = (code: number) => reply([this.address, fn | 0x80, code]);
    if (this.fault === 'busy' && fn !== 0x03) return err(6);
    const reg = (frame[2] << 8) | frame[3];
    if (fn === 0x03) {
      const n = (frame[4] << 8) | frame[5];
      const out: number[] = [];
      for (let i = 0; i < n; i++) {
        if (!this.regs.has(reg + i)) return err(2);
        const v = this.regs.get(reg + i)!;
        out.push(v >> 8, v & 0xff);
      }
      return reply([this.address, 3, n * 2, ...out]);
    }
    if (fn === 0x06) {
      const spec = this.map[reg];
      if (!spec || spec.float || spec.readOnly) return err(2);
      const v = (frame[4] << 8) | frame[5];
      if ((spec.min !== undefined && v < spec.min) || (spec.max !== undefined && v > spec.max)) return err(3);
      this.regs.set(reg, v);
      this.onWrite(reg, v);
      return reply(Array.from(frame.slice(0, 6)));
    }
    if (fn === 0x10) {
      const spec = this.map[reg];
      const n = (frame[4] << 8) | frame[5];
      if (!spec || !spec.float || spec.readOnly || n !== 2 || frame[6] !== 4) return err(2);
      const v = bytesFloat(frame, 7);
      if ((spec.min !== undefined && v < spec.min) || (spec.max !== undefined && v > spec.max)) return err(3);
      this.set(reg, v);
      this.onWrite(reg, v);
      return reply(Array.from(frame.slice(0, 6)));
    }
    return err(1);
  }
}

/**
 * The Transport a simulated card uses: text command → real frame → ModbusSlave → real reply → text.
 * `step(dtSeconds)` runs the module's physics between requests.
 */
export class ModbusSimTransport implements Transport {
  readonly kind = 'sim' as const;
  onDisconnect?: () => void;
  onLog?: (dir: 'tx' | 'rx' | 'info', text: string) => void;
  private last = Date.now();

  constructor(
    readonly slave: ModbusSlave,
    private label: string,
    private step: (dt: number) => void = () => {},
  ) {}

  async open(): Promise<void> {
    this.onLog?.('info', `simulated ${this.label} at address ${this.slave.address}`);
  }

  async close(): Promise<void> {}

  async request(cmd: string): Promise<string | null> {
    const now = Date.now();
    this.step(Math.min(10, (now - this.last) / 1000));
    this.last = now;
    this.onLog?.('tx', cmd);
    await new Promise((r) => setTimeout(r, 10));
    const c = parseCommand(cmd);
    const { frame } = encodeRequest(this.slave.address, c);
    const reply = this.slave.handle(frame);
    if (!reply) throw new Error(`No reply from pump ${this.slave.address} to ${cmd}`);
    const text = decodeReply(cmd, this.slave.address, c, frame, reply);
    this.onLog?.('rx', text);
    return text;
  }
}
