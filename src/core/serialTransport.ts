import type { Transport } from './types';

/**
 * Web Serial transport for IKA NAMUR devices.
 * - One command in flight at a time (IKA replies carry no request id).
 * - Lines end with CR LF.
 * - Commands without a reply (OUT_SP_*, START_*, STOP_*) get a short settle delay;
 *   any echo the device sends in that window is logged and discarded.
 */
export class SerialTransport implements Transport {
  readonly kind = 'serial' as const;
  onDisconnect?: () => void;
  onLog?: (dir: 'tx' | 'rx' | 'info', text: string) => void;

  private reader?: ReadableStreamDefaultReader<string>;
  private readLoopDone?: Promise<void>;
  private pipeDone?: Promise<void>;
  private buffer = '';
  private waiting?: { resolve: (line: string) => void };
  private chain: Promise<unknown> = Promise.resolve();
  private closing = false;

  constructor(
    readonly port: SerialPort,
    private options: SerialOptions,
    private lineEnd = '\r\n',
    private timeoutMs = 1000,
    private settleMs = 120,
  ) {}

  async open(): Promise<void> {
    // A port remembered from a previous session may already be open in this tab.
    if (!this.port.readable) await this.port.open(this.options);
    this.closing = false;
    const decoder = new TextDecoderStream();
    this.pipeDone = this.port.readable!.pipeTo(decoder.writable as WritableStream<Uint8Array>).catch(() => {});
    this.reader = decoder.readable.getReader();
    this.readLoopDone = this.readLoop();
  }

  private async readLoop(): Promise<void> {
    try {
      while (this.reader) {
        const { value, done } = await this.reader.read();
        if (done) break;
        this.buffer += value;
        let idx: number;
        while ((idx = this.buffer.search(/\r?\n/)) >= 0) {
          const line = this.buffer.slice(0, idx).trim();
          this.buffer = this.buffer.slice(this.buffer[idx] === '\r' ? idx + 2 : idx + 1);
          if (!line) continue;
          this.onLog?.('rx', line);
          if (this.waiting) {
            const w = this.waiting;
            this.waiting = undefined;
            w.resolve(line);
          }
        }
      }
    } catch (e) {
      this.onLog?.('info', `read error: ${(e as Error).message}`);
    }
    if (!this.closing) this.onDisconnect?.();
  }

  request(cmd: string, expectReply: boolean): Promise<string | null> {
    const run = async (): Promise<string | null> => {
      await this.write(cmd);
      if (!expectReply) {
        await sleep(this.settleMs);
        return null;
      }
      return await new Promise<string>((resolve, reject) => {
        const t = setTimeout(() => {
          this.waiting = undefined;
          reject(new Error(`No reply to ${cmd}`));
        }, this.timeoutMs);
        this.waiting = {
          resolve: (line) => {
            clearTimeout(t);
            resolve(line);
          },
        };
      });
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  private async write(cmd: string): Promise<void> {
    const writable = this.port.writable;
    if (!writable) throw new Error('Port is not open');
    const writer = writable.getWriter();
    try {
      this.onLog?.('tx', cmd);
      await writer.write(new TextEncoder().encode(cmd + this.lineEnd));
    } finally {
      writer.releaseLock();
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    try {
      await this.reader?.cancel();
    } catch {
      /* already closed */
    }
    this.reader = undefined;
    await this.readLoopDone?.catch(() => {});
    await this.pipeDone;
    try {
      await this.port.close();
    } catch {
      /* unplugged */
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function serialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

export function describePort(port: SerialPort): string {
  const info = port.getInfo();
  if (info.usbVendorId === undefined) return 'Serial port';
  const hex = (n?: number) => (n ?? 0).toString(16).padStart(4, '0');
  return `USB ${hex(info.usbVendorId)}:${hex(info.usbProductId)}`;
}
