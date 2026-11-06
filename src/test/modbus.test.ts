import { describe, expect, it } from 'vitest';
import { ModbusTransport, crc16, decodeReply, encodeRequest, hex, parseCommand, withCrc } from '../core/modbus';
import { ModbusSlave } from '../modules/shared/innofluid/modbusSim';
import { HandyPumpSim } from '../modules/innofluid-st-handypump/sim';
import { LabV1Sim } from '../modules/innofluid-labv1/sim';
import { portConflict, transportFor } from '../core/serialTransport';
import { MODBUS_LINK } from '../core/protocol';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frame = (s: string) => Uint8Array.from(s.trim().split(/\s+/).map((x) => parseInt(x, 16)));

describe('Modbus RTU frames against the manuals\' examples', () => {
  it('computes the CRC of the Innofluid standard sheet (p. 3–4)', () => {
    expect(hex(withCrc([0x01, 0x06, 0x03, 0xe8, 0x00, 0x01]))).toBe('01 06 03 E8 00 01 C8 7A'); // start
    expect(hex(withCrc([0x01, 0x06, 0x03, 0xe8, 0x00, 0x00]))).toBe('01 06 03 E8 00 00 09 BA'); // stop
    expect(hex(withCrc([0x01, 0x06, 0x03, 0xe9, 0x00, 0x01]))).toBe('01 06 03 E9 00 01 99 BA'); // clockwise
    expect(crc16([0x01, 0x10, 0x03, 0xea, 0x00, 0x02])).toEqual([0x60, 0x78]); // echo of a float write
  });

  it('builds the standard sheet\'s speed frame: 58.8 rpm, float sent most significant byte first', () => {
    const { frame: f } = encodeRequest(1, parseCommand('WF1002=58.8'));
    expect(hex(f)).toBe('01 10 03 EA 00 02 04 42 6B 33 33 58 29');
  });

  it('builds the LabV frames from Darwin\'s article (start 1008, flow 50.0 in 1004)', () => {
    expect(hex(encodeRequest(1, parseCommand('W1008=1')).frame)).toBe('01 06 03 F0 00 01 48 7D');
    expect(hex(encodeRequest(1, parseCommand('W1008=0')).frame)).toBe('01 06 03 F0 00 00 89 BD');
    expect(hex(encodeRequest(1, parseCommand('W1009=1')).frame)).toBe('01 06 03 F1 00 01 19 BD');
    expect(hex(encodeRequest(1, parseCommand('WF1004=50')).frame)).toBe('01 10 03 EC 00 02 04 42 48 00 00 7D 2C');
  });

  it('decodes write echoes, reads and exceptions', () => {
    const start = parseCommand('W1000=1');
    const req = encodeRequest(1, start).frame;
    expect(decodeReply('W1000=1', 1, start, req, frame('01 06 03 E8 00 01 C8 7A'))).toBe('OK');
    const sp = parseCommand('WF1002=58.8');
    expect(decodeReply('WF1002=58.8', 1, sp, encodeRequest(1, sp).frame, frame('01 10 03 EA 00 02 60 78'))).toBe('OK');
    const rd = parseCommand('RF1002');
    expect(decodeReply('RF1002', 1, rd, encodeRequest(1, rd).frame, withCrc([1, 3, 4, 0x42, 0x6b, 0x33, 0x33]))).toBe('58.8');
    expect(() => decodeReply('W1000=1', 1, start, req, withCrc([1, 0x86, 0x06]))).toThrow(/busy.*main screen/);
    expect(() => decodeReply('W1000=1', 1, start, req, withCrc([1, 0x86, 0x02]))).toThrow(/no such register/);
    expect(() => decodeReply('W1000=1', 1, start, req, frame('01 06 03 E8 00 01 C8 7B'))).toThrow(/checksum/);
    expect(() => decodeReply('W1000=1', 1, start, req, withCrc([2, 6, 3, 0xe8, 0, 1]))).toThrow(/address 2/);
    expect(() => decodeReply('W1000=1', 1, start, req, withCrc([1, 6, 3, 0xe8, 0, 0]))).toThrow(/echo/);
  });

  it('refuses commands that are not pump commands', () => {
    expect(() => parseCommand('START_4')).toThrow(/not a pump command/);
    expect(() => parseCommand('W1000')).toThrow(/needs a value/);
    expect(() => parseCommand('W1000=1.5')).toThrow(/whole number/);
    expect(() => parseCommand('R1000=1')).toThrow(/no value/);
    expect(parseCommand(' rf1002 ')).toEqual({ kind: 'readFloat', reg: 1002, value: undefined });
  });
});

/**
 * A fake RS-485 cable: every frame written reaches every pump; whoever is addressed answers, split into
 * small chunks as a USB adapter delivers them.
 */
function fakeBus(slaves: ModbusSlave[]) {
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const written: string[] = [];
  let opens = 0;
  let closes = 0;
  const port = {
    readable: null as ReadableStream<Uint8Array> | null,
    writable: null as WritableStream<Uint8Array> | null,
    open: async () => {
      opens++;
      port.readable = new ReadableStream<Uint8Array>({ start: (c) => { ctl = c; } });
      port.writable = new WritableStream<Uint8Array>({
        write: (b) => {
          written.push(hex(b));
          for (const s of slaves) {
            const r = s.handle(b);
            if (!r) continue;
            setTimeout(() => {
              ctl.enqueue(r.slice(0, 3));
              setTimeout(() => ctl.enqueue(r.slice(3)), 3);
            }, 4);
          }
        },
      });
    },
    close: async () => { closes++; port.readable = null; port.writable = null; },
    getInfo: () => ({ usbVendorId: 0x0403, usbProductId: 0x6001 }),
  };
  return { port: port as unknown as SerialPort, written, opens: () => opens, closes: () => closes, inject: (b: number[]) => ctl.enqueue(Uint8Array.from(b)) };
}

describe('two pumps on one RS-485 cable', () => {
  const setup = () => {
    const hp = new HandyPumpSim(1);
    const lv = new LabV1Sim(2);
    const bus = fakeBus([hp.slave, lv.slave]);
    const a = transportFor(bus.port, MODBUS_LINK(1), 200);
    const b = transportFor(bus.port, MODBUS_LINK(2), 200);
    return { hp, lv, bus, a, b };
  };

  it('share one port: opened once, closed when the last pump leaves', async () => {
    const { bus, a, b } = setup();
    expect(a).toBeInstanceOf(ModbusTransport);
    await a.open();
    await b.open();
    expect(bus.opens()).toBe(1);
    await a.close();
    expect(bus.closes()).toBe(0);
    await b.close();
    expect(bus.closes()).toBe(1);
  });

  it('each card talks to its own address, even with requests overlapping', async () => {
    const { hp, lv, a, b } = setup();
    await a.open();
    await b.open();
    const [r1, r2, r3, r4] = await Promise.all([
      a.request('RF1002', true),   // HandyPump speed
      b.request('RF1004', true),   // LabV flow
      a.request('W1000=1', true),  // start HandyPump
      b.request('R1020', true),    // LabV mode
    ]);
    expect([r1, r2, r3, r4]).toEqual(['100', '10', 'OK', '1']);
    expect(hp.slave.get(1000)).toBe(1);
    expect(lv.slave.get(1008)).toBe(0); // the other pump did not start
    await a.close();
    await b.close();
  });

  it('a silent pump times out without disturbing the next request', async () => {
    const { hp, a, b } = setup();
    await a.open();
    await b.open();
    hp.slave.fault = 'silent';
    await expect(a.request('R1000', true)).rejects.toThrow(/No reply from pump 1/);
    expect(await b.request('R1008', true)).toBe('0');
    await a.close();
    await b.close();
  });

  it('drops stray bytes left on the line before the next frame', async () => {
    const { bus, a } = setup();
    await a.open();
    bus.inject([0x01, 0x03]); // half a late reply
    await wait(2);
    expect(await a.request('R1001', true)).toBe('1');
    await a.close();
  });

  it('allows two cards on one port only at different addresses', () => {
    expect(portConflict(MODBUS_LINK(1), MODBUS_LINK(2))).toBe(false);
    expect(portConflict(MODBUS_LINK(1), MODBUS_LINK(1))).toBe(true);
    expect(portConflict(MODBUS_LINK(1), undefined)).toBe(true);
  });
});
