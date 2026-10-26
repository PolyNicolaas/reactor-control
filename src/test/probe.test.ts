import { describe, expect, it } from 'vitest';
import { probeName, recognises } from '../core/probe';
import { retControlVisc } from '../modules/ret-control-visc/module';

/** A fake Web Serial port that answers NAMUR commands from a table of raw byte replies. */
function fakePort(replies: Record<string, number[]>): SerialPort {
  let ctl: ReadableStreamDefaultController<Uint8Array> | undefined;
  const port = {
    readable: null as ReadableStream<Uint8Array> | null,
    writable: null as WritableStream<Uint8Array> | null,
    getInfo: () => ({ usbVendorId: 0x0483, usbProductId: 0x5740 }),
    async open() {
      port.readable = new ReadableStream({ start: (c) => void (ctl = c) });
      let buf = '';
      port.writable = new WritableStream({
        write(chunk) {
          buf += new TextDecoder().decode(chunk);
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const cmd = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            const r = replies[cmd];
            if (r) setTimeout(() => ctl?.enqueue(new Uint8Array(r)), 5);
          }
        },
      });
    },
    async close() {
      try { ctl?.close(); } catch { /* closed */ }
      port.readable = null;
      port.writable = null;
    },
  };
  return port as unknown as SerialPort;
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

describe('probe', () => {
  it('a unit whose stored name is blank (ff bytes) is reported as blankName, not as no reply', async () => {
    // What our RET control-visc sent on 2026-10-22: seven 0xFF bytes, then CR LF, at every setting.
    const port = fakePort({ IN_NAME: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0d, 0x0a] });
    const r = await probeName(port);
    expect(r.blankName).toBe(true);
    expect(r.link.protocol).toBe('namur');
    expect(r.attempts.join('\n')).toMatch(/IN_TYPE/);
  });

  it('a blank-named unit is still recognised if IN_TYPE names it', async () => {
    const port = fakePort({
      IN_NAME: [0xff, 0xff, 0xff, 0x0d, 0x0a],
      IN_TYPE: [...ascii('IKARET'), 0x0d, 0x0a],
    });
    const r = await probeName(port);
    expect(r.blankName).toBe(true);
    expect(recognises(retControlVisc.identify, r)).toBe(true);
  });
});
