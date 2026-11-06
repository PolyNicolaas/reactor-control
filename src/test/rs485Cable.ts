import { hex } from '../core/modbus';
import type { ModbusSlave } from '../modules/shared/innofluid/modbusSim';

/**
 * A simulated RS-485 cable behind a fake Web Serial port, for tests that run the real ModbusTransport.
 *
 * It behaves like the wire, not like a mock:
 * - every frame reaches every pump; the addressed one answers after `latencyMs`, its bytes paced at
 *   9600 baud (≈1.15 ms per byte, 11 bits) and handed to the reader in USB-sized chunks;
 * - it records **collisions** (the master sending while a pump is still answering) and **gaps** shorter
 *   than 3.5 characters between a reply and the next request, both of which corrupt a real bus;
 * - faults: unplug (reads end with an error, writes fail), noise bytes, a corrupted next reply, a slow
 *   next reply; pumps themselves can be silent or busy (ModbusSlave.fault).
 */
export class Rs485Cable {
  readonly frames: { t: number; addr: number; text: string }[] = [];
  readonly collisions: string[] = [];
  readonly shortGaps: string[] = [];
  opens = 0;
  closes = 0;
  latencyMs = 3;
  private ctl?: ReadableStreamDefaultController<Uint8Array>;
  private busyUntil = 0; // a pump is transmitting until then
  private lastRxEnd = 0;
  private corruptNext = false;
  private slowNextMs = 0;
  private unplugged = false;
  private pending: ReturnType<typeof setTimeout>[] = [];
  readonly port: SerialPort;

  static readonly BYTE_MS = 11 / 9.6; // 11 bits at 9600 baud

  constructor(readonly slaves: ModbusSlave[], readonly usb = { usbVendorId: 0x0403, usbProductId: 0x6001 }) {
    const self = this;
    const p = {
      readable: null as ReadableStream<Uint8Array> | null,
      writable: null as WritableStream<Uint8Array> | null,
      async open(opts: SerialOptions) {
        if (self.unplugged) throw new Error('NetworkError: device unplugged');
        if (p.readable) throw new Error('InvalidStateError: The port is already open.');
        if (opts.parity !== 'even' || opts.baudRate !== 9600 || opts.dataBits !== 8) {
          throw new Error(`test cable is 9600 8E1, opened as ${opts.baudRate} ${opts.dataBits}${opts.parity}`);
        }
        self.opens++;
        p.readable = new ReadableStream<Uint8Array>({ start: (c) => { self.ctl = c; } });
        p.writable = new WritableStream<Uint8Array>({ write: (b) => self.onWrite(b) });
      },
      async close() {
        if (!p.readable) throw new Error('InvalidStateError: The port is already closed.');
        if (p.readable.locked) throw new Error('InvalidStateError: readable is locked');
        self.closes++;
        for (const t of self.pending) clearTimeout(t);
        self.pending = [];
        p.readable = null;
        p.writable = null;
        self.ctl = undefined;
      },
      getInfo: () => this.usb,
    };
    this.port = p as unknown as SerialPort;
  }

  get isOpen(): boolean {
    return !!(this.port as unknown as { readable: unknown }).readable;
  }

  slave(addr: number): ModbusSlave {
    return this.slaves.find((s) => s.address === addr)!;
  }

  /** Frames written to one address, as text commands are not visible on the wire: raw hex. */
  sentTo(addr: number): string[] {
    return this.frames.filter((f) => f.addr === addr).map((f) => f.text);
  }

  noise(bytes: number[]): void {
    this.deliver(Uint8Array.from(bytes), 0);
  }

  corruptNextReply(): void {
    this.corruptNext = true;
  }

  slowNextReply(ms: number): void {
    this.slowNextMs = ms;
  }

  /** The USB adapter pulled out: the reader errors, the port is gone until replugged. */
  unplug(): void {
    this.unplugged = true;
    for (const t of this.pending) clearTimeout(t);
    this.pending = [];
    try {
      this.ctl?.error(new Error('NetworkError: The device has been lost.'));
    } catch {
      /* already closed */
    }
    const p = this.port as unknown as { readable: unknown; writable: unknown };
    p.writable = null;
  }

  replug(): void {
    this.unplugged = false;
    const p = this.port as unknown as { readable: unknown; writable: unknown };
    p.readable = null;
    p.writable = null;
  }

  private onWrite(b: Uint8Array): void {
    if (this.unplugged) throw new Error('NetworkError: device unplugged');
    const now = performance.now();
    const text = hex(b);
    this.frames.push({ t: now, addr: b[0], text });
    if (now < this.busyUntil - 0.5) this.collisions.push(`${text} sent ${(this.busyUntil - now).toFixed(1)} ms before the previous reply ended`);
    else if (this.lastRxEnd && now - this.lastRxEnd < 3.5 * Rs485Cable.BYTE_MS - 0.5) {
      this.shortGaps.push(`${text} only ${(now - this.lastRxEnd).toFixed(2)} ms after the last reply`);
    }
    // The master's own frame occupies the line too.
    const txEnd = now + b.length * Rs485Cable.BYTE_MS;
    for (const s of this.slaves) {
      const r = s.handle(b);
      if (!r) continue;
      let reply = r;
      if (this.corruptNext) {
        this.corruptNext = false;
        reply = Uint8Array.from(r);
        reply[reply.length - 3] ^= 0x10; // one bit flipped in the data
      }
      const start = this.slowNextMs || this.latencyMs;
      this.slowNextMs = 0;
      this.deliver(reply, txEnd - now + start);
    }
  }

  /** Bytes appear on the reader paced at 9600 baud, in chunks of up to 4 (as a USB adapter delivers them). */
  private deliver(bytes: Uint8Array, afterMs: number): void {
    const t0 = performance.now() + afterMs;
    const end = t0 + bytes.length * Rs485Cable.BYTE_MS;
    this.busyUntil = Math.max(this.busyUntil, end);
    for (let i = 0; i < bytes.length; i += 4) {
      const chunk = bytes.slice(i, i + 4);
      const at = afterMs + (i + chunk.length) * Rs485Cable.BYTE_MS;
      const ctl = this.ctl;
      this.pending.push(
        setTimeout(() => {
          try {
            ctl?.enqueue(chunk);
          } catch {
            /* port closed meanwhile: bytes lost, as on the wire */
          }
          this.lastRxEnd = performance.now();
        }, at),
      );
    }
  }
}

/** A navigator.serial stand-in for restore(): the ports this site was granted. */
export function grantPorts(ports: SerialPort[]): () => void {
  const nav = globalThis.navigator as unknown as { serial?: unknown };
  const had = Object.getOwnPropertyDescriptor(nav, 'serial');
  Object.defineProperty(nav, 'serial', { configurable: true, value: { getPorts: async () => ports } });
  return () => {
    if (had) Object.defineProperty(nav, 'serial', had);
    else delete nav.serial;
  };
}
