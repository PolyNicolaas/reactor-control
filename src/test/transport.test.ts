import { describe, expect, it } from 'vitest';
import { SerialTransport } from '../core/serialTransport';
import { DeviceInstance } from '../core/device';
import { NAMUR } from '../core/protocol';
import { eurostar60 } from '../modules/eurostar-60-control/module';

// Regressions from the 2026-10-28 bug review: replies out of step, duplicate poll loops,
// half-connected units, and stops that failed but showed as done.

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakePort() {
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const written: string[] = [];
  const port = {
    readable: new ReadableStream<Uint8Array>({ start: (c) => { ctl = c; } }),
    writable: new WritableStream<Uint8Array>({ write: (b) => { written.push(new TextDecoder().decode(b)); } }),
    open: async () => {}, close: async () => {}, getInfo: () => ({}),
  } as unknown as SerialPort;
  return { port, written, send: (s: string) => ctl.enqueue(new TextEncoder().encode(s)) };
}

/** A transport that answers everything and counts the reads. */
class CountingTransport {
  kind = 'sim' as const;
  onDisconnect?: () => void;
  onLog?: () => void;
  count = 0;
  failIdentify = false;
  failWrites = false;
  async open() {}
  async close() {}
  async request(cmd: string, expectReply: boolean) {
    if (cmd === 'IN_NAME') {
      if (this.failIdentify) throw new Error('No reply to IN_NAME');
      return 'IKA ES 60';
    }
    if (!expectReply) {
      if (this.failWrites) throw new Error('Port is not open');
      return null;
    }
    this.count++;
    await wait(1);
    const ch = /_(\d+)$/.exec(cmd)?.[1] ?? '4';
    return `100 ${ch}`;
  }
}

describe('serial transport: replies stay in step', () => {
  it('a reply that comes after its timeout is not handed to the next command', async () => {
    const f = fakePort();
    const t = new SerialTransport(f.port, {} as SerialOptions, '\r\n', 50);
    await t.open();
    await expect(t.request('IN_PV_4', true)).rejects.toThrow(/No reply/);
    const next = t.request('IN_SP_4', true);
    await wait(5);
    f.send('300 4\r\n'); // the late answer to IN_PV_4
    while (!f.written.some((w) => w.startsWith('IN_SP_4'))) await wait(2); // sent once the line is quiet
    f.send('450 4\r\n'); // the real answer to IN_SP_4
    expect(await next).toBe('450 4');
    await t.close();
  });

  it('NAMUR: a reply for another channel, or an echoed write, does not fit the command', () => {
    expect(NAMUR.replyFits('IN_PV_4', '400.0 4')).toBe(true);
    expect(NAMUR.replyFits('IN_PV_5', '400.0 4')).toBe(false);
    expect(NAMUR.replyFits('IN_PV_5', '22.1')).toBe(true); // no channel in the reply: accepted
    expect(NAMUR.replyFits('IN_NAME', 'START_4')).toBe(false);
    expect(NAMUR.replyFits('IN_NAME', 'IKA ES 60')).toBe(true);
  });
});

describe('device: connection life cycle', () => {
  it('a reconnect while the poll loop sleeps does not leave two loops running', async () => {
    const d = new DeviceInstance('x', eurostar60, 'S', '#000', new CountingTransport(), 200);
    await d.connect();
    await wait(50); // first poll done, loop now asleep
    const t2 = new CountingTransport();
    await d.replaceTransport(t2);
    await wait(1000);
    await d.disconnect(false);
    const perPoll = eurostar60.readings.filter((r) => r.cmd && !r.everyN && !r.optional).length + eurostar60.setpoints.filter((s) => s.readCmd).length;
    expect(t2.count).toBeLessThanOrEqual(perPoll * 6 + 2); // one loop: about 5 polls in 1 s at 200 ms
  });

  it('a unit that does not identify is not shown as connected', async () => {
    const t = new CountingTransport();
    t.failIdentify = true;
    const d = new DeviceInstance('x', eurostar60, 'S', '#000', t, 100);
    await expect(d.connect()).rejects.toThrow(/IN_NAME/);
    expect(d.connected).toBe(false);
    expect(d.status).toBe('Disconnected');
  });

  it('Stop all reports a stop that failed and does not show the unit as off', async () => {
    const t = new CountingTransport();
    const d = new DeviceInstance('x', eurostar60, 'S', '#000', t, 100);
    await d.connect();
    await d.setSwitch('motor', true);
    t.failWrites = true;
    expect(await d.stopAll()).toEqual(['STOP_4']);
    expect(d.snapshot.switches.motor).toBe(true);
    t.failWrites = false;
    expect(await d.stopAll()).toEqual([]);
    expect(d.snapshot.switches.motor).toBe(false);
    await d.disconnect(false);
  });
});
