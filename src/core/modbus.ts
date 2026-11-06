import type { Transport } from './types';

/**
 * Modbus RTU over RS-485, as the Innofluid pumps speak it (the Innofluid modules' notes.md):
 * 9600 baud, 8 data bits, EVEN parity, 1 stop bit; binary frames
 *   address (1–32, 0 = broadcast) · function · data · CRC-16 (low byte first).
 *
 * The rest of the app talks in short text commands, so modules stay readable and the bench terminal
 * works. The transport turns them into frames and the replies back into text:
 *
 *   R1000          read one 16-bit register (function 03)          → "1"
 *   RF1002         read a float, two registers, big-endian (03)    → "58.8"
 *   W1000=1        write one 16-bit register (function 06)         → "OK" (the pump echoes the frame)
 *   WF1002=58.8    write a float (function 10, two registers)      → "OK"
 *
 * The pump's address is NOT in the command: each card owns one address, and its transport adds it.
 * Several pumps can share one RS-485 cable and one USB adapter; they share one ModbusBus (one port,
 * one frame on the wire at a time) and each card gets a ModbusTransport view with its address.
 */

/** CRC-16/MODBUS: init FFFF, reflected polynomial A001. Returned as [low, high], the order on the wire. */
export function crc16(bytes: ArrayLike<number>): [number, number] {
  let crc = 0xffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] & 0xff;
    for (let j = 0; j < 8; j++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return [crc & 0xff, crc >> 8];
}

export function withCrc(bytes: number[]): Uint8Array {
  return Uint8Array.from([...bytes, ...crc16(bytes)]);
}

export function crcOk(frame: ArrayLike<number>): boolean {
  if (frame.length < 4) return false;
  const body = Array.from(frame).slice(0, frame.length - 2);
  const [lo, hi] = crc16(body);
  return frame[frame.length - 2] === lo && frame[frame.length - 1] === hi;
}

/** A float as the pumps send it: IEEE 754, most significant byte first (58.8 → 42 6B 33 33). */
export function floatBytes(v: number): number[] {
  const b = new DataView(new ArrayBuffer(4));
  b.setFloat32(0, v, false);
  return [b.getUint8(0), b.getUint8(1), b.getUint8(2), b.getUint8(3)];
}

export function bytesFloat(b: ArrayLike<number>, at = 0): number {
  const d = new DataView(Uint8Array.from([b[at], b[at + 1], b[at + 2], b[at + 3]]).buffer);
  return d.getFloat32(0, false);
}

/** Floats keep ~7 significant figures; show them without float noise (58.79999923706 → 58.8). */
export function tidyFloat(v: number): string {
  return String(Number(v.toPrecision(6)));
}

export interface ModbusCommand {
  kind: 'read' | 'readFloat' | 'write' | 'writeFloat';
  reg: number;
  value?: number;
}

const CMD = /^(RF?|WF?)\s*(\d{1,5})(?:\s*=\s*(-?\d+(?:\.\d+)?))?$/i;

export function parseCommand(cmd: string): ModbusCommand {
  const m = CMD.exec(cmd.trim());
  if (!m) throw new Error(`"${cmd}" is not a pump command. Use R1000, RF1002, W1000=1 or WF1002=58.8`);
  const op = m[1].toUpperCase();
  const reg = Number(m[2]);
  if (reg > 0xffff) throw new Error(`Register ${reg} does not exist (0–65535)`);
  const value = m[3] === undefined ? undefined : Number(m[3]);
  if (op.startsWith('W') && value === undefined) throw new Error(`"${cmd}" needs a value, e.g. ${op}${reg}=1`);
  if (op.startsWith('R') && value !== undefined) throw new Error(`"${cmd}": a read takes no value`);
  if (op === 'W' && (!Number.isInteger(value) || value! < 0 || value! > 0xffff)) throw new Error(`"${cmd}": W writes a whole number 0–65535 (use WF for decimals)`);
  return { kind: op === 'R' ? 'read' : op === 'RF' ? 'readFloat' : op === 'W' ? 'write' : 'writeFloat', reg, value };
}

/** The request frame for a command, and how long a normal reply is. Address 0 (broadcast) gets no reply. */
export function encodeRequest(address: number, c: ModbusCommand): { frame: Uint8Array; replyLength: number } {
  const hi = c.reg >> 8;
  const lo = c.reg & 0xff;
  switch (c.kind) {
    case 'read':
      return { frame: withCrc([address, 0x03, hi, lo, 0, 1]), replyLength: 5 + 2 };
    case 'readFloat':
      return { frame: withCrc([address, 0x03, hi, lo, 0, 2]), replyLength: 5 + 4 };
    case 'write':
      return { frame: withCrc([address, 0x06, hi, lo, c.value! >> 8, c.value! & 0xff]), replyLength: 8 };
    case 'writeFloat':
      return { frame: withCrc([address, 0x10, hi, lo, 0, 2, 4, ...floatBytes(c.value!)]), replyLength: 8 };
  }
}

const EXCEPTIONS: Record<number, string> = {
  1: 'illegal function (the pump does not support this kind of command)',
  2: 'illegal data address (this pump has no such register)',
  3: 'illegal data value (outside the pump\'s range)',
  6: 'pump busy (it only takes commands on its main screen; leave any menu on the pump)',
};

/** An exception reply (function + 0x80): a readable error. */
export function exceptionText(code: number): string {
  return `${EXCEPTIONS[code] ?? 'unknown error'} (code ${code.toString(16).padStart(2, '0').toUpperCase()})`;
}

/**
 * Check a complete reply against its request and turn it into text. Throws on an exception reply,
 * a wrong address or function, or a write echo that does not match what was sent.
 */
export function decodeReply(cmdText: string, address: number, c: ModbusCommand, request: Uint8Array, reply: Uint8Array): string {
  if (!crcOk(reply)) throw new Error(`Bad checksum in the reply to ${cmdText}`);
  if (reply[0] !== address) throw new Error(`Reply to ${cmdText} came from address ${reply[0]}, not ${address}`);
  const fn = request[1];
  if (reply[1] === (fn | 0x80)) throw new Error(`Pump ${address} refused ${cmdText}: ${exceptionText(reply[2])}`);
  if (reply[1] !== fn) throw new Error(`Reply to ${cmdText} has function ${reply[1]}, expected ${fn}`);
  if (c.kind === 'read') return String((reply[3] << 8) | reply[4]);
  if (c.kind === 'readFloat') return tidyFloat(bytesFloat(reply, 3));
  // 06 echoes the whole request; 10 echoes address, function, register and count.
  for (let i = 0; i < 6; i++) {
    if (reply[i] !== request[i]) throw new Error(`Pump ${address} did not echo ${cmdText} correctly`);
  }
  return 'OK';
}

/** How many bytes the reply in `buf` will have, once enough of it is in (undefined = not known yet). */
export function expectedLength(buf: number[], normal: number, fn: number): number | undefined {
  if (buf.length < 2) return undefined;
  if (buf[1] === (fn | 0x80)) return 5;
  return normal;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// One RS-485 cable = one port = one bus. Every card on the cable shares it.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const buses = new WeakMap<SerialPort, ModbusBus>();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class ModbusBus {
  /** Raw bytes of the last frame received, as hex (bench terminal). */
  lastRawHex = '';
  onLog?: (dir: 'tx' | 'rx' | 'info', text: string) => void;
  private users = new Set<ModbusTransport>();
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private readLoopDone?: Promise<void>;
  private rx: number[] = [];
  private waiting?: { want: () => boolean; resolve: () => void };
  private chain: Promise<unknown> = Promise.resolve();
  private opening?: Promise<void>;
  private closing = false;

  /** The bus for a port; every card on the same port gets the same one. */
  static for(port: SerialPort, options: SerialOptions, timeoutMs = 500): ModbusBus {
    let b = buses.get(port);
    if (!b) {
      b = new ModbusBus(port, options, timeoutMs);
      buses.set(port, b);
    }
    return b;
  }

  private constructor(
    readonly port: SerialPort,
    private options: SerialOptions,
    private timeoutMs: number,
  ) {}

  /** Character time at this baud rate (11 bits per byte with parity), ms. */
  private get charMs(): number {
    return (11 * 1000) / (this.options.baudRate || 9600);
  }

  async attach(user: ModbusTransport): Promise<void> {
    this.users.add(user);
    if (this.reader) return;
    this.opening ??= (async () => {
      if (!this.port.readable) await this.port.open(this.options);
      this.closing = false;
      this.reader = this.port.readable!.getReader();
      this.readLoopDone = this.readLoop();
    })();
    try {
      await this.opening;
    } finally {
      this.opening = undefined;
    }
  }

  async detach(user: ModbusTransport): Promise<void> {
    this.users.delete(user);
    if (this.users.size) return;
    this.closing = true;
    try {
      await this.reader?.cancel();
    } catch {
      /* already closed */
    }
    this.reader?.releaseLock();
    this.reader = undefined;
    await this.readLoopDone?.catch(() => {});
    try {
      await this.port.close();
    } catch {
      /* unplugged */
    }
  }

  get attached(): number {
    return this.users.size;
  }

  private async readLoop(): Promise<void> {
    try {
      while (this.reader) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (!value) continue;
        for (const b of value) this.rx.push(b);
        if (this.waiting?.want()) {
          const w = this.waiting;
          this.waiting = undefined;
          w.resolve();
        }
      }
    } catch (e) {
      this.onLog?.('info', `read error: ${(e as Error).message}`);
    }
    if (!this.closing) for (const u of [...this.users]) u.onDisconnect?.();
  }

  /** Send one command to one pump and wait for its reply. One frame on the wire at a time. */
  request(address: number, cmdText: string, log?: (dir: 'tx' | 'rx' | 'info', text: string) => void): Promise<string | null> {
    const run = async (): Promise<string | null> => {
      const c = parseCommand(cmdText);
      const { frame, replyLength } = encodeRequest(address, c);
      // RTU frames are separated by at least 3.5 characters of silence; leave a little more.
      await sleep(Math.max(5, Math.ceil(this.charMs * 4)));
      if (this.rx.length) {
        const junk = hex(this.rx);
        this.rx = [];
        (log ?? this.onLog)?.('info', `dropped bytes nobody asked for: ${junk}`);
      }
      const writable = this.port.writable;
      if (!writable) throw new Error('Port is not open');
      const writer = writable.getWriter();
      try {
        log?.('tx', `${cmdText}  [${hex(frame)}]`);
        await writer.write(frame);
      } finally {
        writer.releaseLock();
      }
      if (address === 0) {
        await sleep(50); // broadcast: no pump answers
        return null;
      }
      const fn = frame[1];
      const done = () => {
        const n = expectedLength(this.rx, replyLength, fn);
        return n !== undefined && this.rx.length >= n;
      };
      if (!done()) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => {
            this.waiting = undefined;
            const got = this.rx.length ? ` (got ${hex(this.rx)})` : '';
            this.rx = [];
            reject(new Error(`No reply from pump ${address} to ${cmdText}${got}`));
          }, this.timeoutMs);
          this.waiting = { want: done, resolve: () => { clearTimeout(t); resolve(); } };
        });
      }
      const n = expectedLength(this.rx, replyLength, fn)!;
      const reply = Uint8Array.from(this.rx.slice(0, n));
      this.rx = this.rx.slice(n);
      this.lastRawHex = hex(reply);
      const text = decodeReply(cmdText, address, c, frame, reply);
      log?.('rx', `${text}  [${this.lastRawHex}]`);
      return text;
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }
}

/** One pump on a bus: the Transport a card uses. */
export class ModbusTransport implements Transport {
  readonly kind = 'serial' as const;
  onDisconnect?: () => void;
  onLog?: (dir: 'tx' | 'rx' | 'info', text: string) => void;
  readonly bus: ModbusBus;
  private open_ = false;

  constructor(
    readonly port: SerialPort,
    options: SerialOptions,
    readonly address: number,
    timeoutMs?: number,
  ) {
    if (!Number.isInteger(address) || address < 1 || address > 32) throw new Error(`Pump address must be 1–32, not ${address}`);
    this.bus = ModbusBus.for(port, options, timeoutMs);
  }

  get lastRawHex(): string {
    return this.bus.lastRawHex;
  }

  async open(): Promise<void> {
    if (this.open_) return;
    await this.bus.attach(this);
    this.open_ = true;
  }

  async close(): Promise<void> {
    if (!this.open_) return;
    this.open_ = false;
    await this.bus.detach(this);
  }

  request(cmd: string, _expectReply: boolean): Promise<string | null> {
    return this.bus.request(this.address, cmd, this.onLog);
  }
}

export function hex(b: ArrayLike<number>): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}
