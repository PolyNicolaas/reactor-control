import { describe, expect, it } from 'vitest';
import { crcOk, decodeReply, encodeRequest, parseCommand, tidyFloat, withCrc, type ModbusCommand } from '../core/modbus';
import { ModbusSlave, type RegisterSpec } from '../modules/shared/innofluid/modbusSim';

// Property tests for the Modbus codec: thousands of random commands, replies and corruptions, with a
// fixed seed so a failure can be replayed.

function rng(seed: number) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 2 ** 32;
  };
}
const R = rng(20261106);
const int = (lo: number, hi: number) => lo + Math.floor(R() * (hi - lo + 1));

/** A pump with every register 0–65535 present, floats at even registers from 1000 up. */
function wideSlave(address: number) {
  const map: Record<number, RegisterSpec> = {};
  return new ModbusSlave(address, new Proxy(map, { get: (_t, k) => ({ float: Number(k) >= 1000 && Number(k) % 2 === 0 && Number(k) < 2000 }) as RegisterSpec, has: () => true }));
}

function roundTrip(address: number, cmdText: string, slave: ModbusSlave) {
  const c = parseCommand(cmdText);
  const { frame, replyLength } = encodeRequest(address, c);
  const reply = slave.handle(frame)!;
  expect(reply.length, cmdText).toBe(replyLength);
  return { c, frame, reply, text: decodeReply(cmdText, address, c, frame, reply) };
}

describe('Modbus codec, random inputs', () => {
  it('every 16-bit write then read returns the value, at any address and register', () => {
    for (let i = 0; i < 2000; i++) {
      const addr = int(1, 32);
      const reg = int(0, 999);
      const v = int(0, 0xffff);
      const s = wideSlave(addr);
      s.regs.set(reg, 0);
      expect(roundTrip(addr, `W${reg}=${v}`, s).text).toBe('OK');
      expect(roundTrip(addr, `R${reg}`, s).text).toBe(String(v));
    }
  });

  it('every float the cards can set comes back as typed (0.1–999.9 rpm, 0.001–645 mL/min)', () => {
    for (let i = 0; i < 3000; i++) {
      const addr = int(1, 32);
      const decimals = int(0, 3);
      const v = Number((R() * 999 + 0.001).toFixed(decimals));
      if (v <= 0) continue;
      const s = wideSlave(addr);
      s.regs.set(1002, 0);
      s.regs.set(1003, 0);
      expect(roundTrip(addr, `WF1002=${v}`, s).text).toBe('OK');
      expect(Number(roundTrip(addr, 'RF1002', s).text), `${v}`).toBe(v);
    }
  });

  it('tidyFloat shows a float32 without noise and without losing a typed digit', () => {
    for (let i = 0; i < 5000; i++) {
      const v = Number((R() * 1000).toFixed(int(0, 3)));
      expect(Number(tidyFloat(Math.fround(v)))).toBe(v);
    }
  });

  it('a single flipped bit anywhere in a reply is always caught', () => {
    for (let i = 0; i < 300; i++) {
      const addr = int(1, 32);
      const s = wideSlave(addr);
      const reg = int(0, 999);
      s.regs.set(reg, int(0, 0xffff));
      const cmd = R() < 0.5 ? `R${reg}` : `W${reg}=${int(0, 0xffff)}`;
      const c = parseCommand(cmd);
      const { frame } = encodeRequest(addr, c);
      const good = s.handle(frame)!;
      for (let bit = 0; bit < good.length * 8; bit++) {
        const bad = Uint8Array.from(good);
        bad[bit >> 3] ^= 1 << (bit & 7);
        expect(() => decodeReply(cmd, addr, c, frame, bad), `${cmd} bit ${bit}`).toThrow();
      }
    }
  });

  it('random bytes are never taken as a reply', () => {
    let passed = 0;
    for (let i = 0; i < 20000; i++) {
      const c: ModbusCommand = { kind: 'read', reg: 1000 };
      const { frame } = encodeRequest(1, c);
      const junk = Uint8Array.from({ length: 7 }, () => int(0, 255));
      try {
        decodeReply('R1000', 1, c, frame, junk);
        passed++;
      } catch {
        /* expected */
      }
    }
    // Only a junk frame that happens to have address 1, function 3, two data bytes AND a valid CRC
    // (about 1 in 2^40) could pass.
    expect(passed).toBe(0);
  });

  it('a reply from another pump, or to another command, is refused even with a valid CRC', () => {
    for (let i = 0; i < 1000; i++) {
      const addr = int(1, 31);
      const c = parseCommand(`R${int(0, 999)}`);
      const { frame } = encodeRequest(addr, c);
      const other = withCrc([addr + 1, 3, 2, int(0, 255), int(0, 255)]);
      expect(() => decodeReply('R', addr, c, frame, other)).toThrow(/address/);
      const float = withCrc([addr, 3, 4, 1, 2, 3, 4]);
      expect(() => decodeReply('R', addr, c, frame, float)).toThrow(/data bytes/);
      const write = withCrc([addr, 6, ...frame.slice(2, 6)]);
      expect(() => decodeReply('R', addr, c, frame, write)).toThrow(/function/);
    }
  });

  it('the command parser either returns a valid command or throws an Error, for any text', () => {
    const alphabet = 'RWFrwf0123456789=.-+ eE\t#*';
    for (let i = 0; i < 20000; i++) {
      const t = Array.from({ length: int(0, 14) }, () => alphabet[int(0, alphabet.length - 1)]).join('');
      let c: ModbusCommand | undefined;
      try {
        c = parseCommand(t);
      } catch (e) {
        expect(e, t).toBeInstanceOf(Error);
        continue;
      }
      expect(c.reg).toBeGreaterThanOrEqual(0);
      expect(c.reg).toBeLessThanOrEqual(0xffff);
      if (c.kind === 'write') expect(Number.isInteger(c.value) && c.value! >= 0 && c.value! <= 0xffff, t).toBe(true);
      if (c.kind === 'writeFloat') expect(Number.isFinite(c.value), t).toBe(true);
      // Whatever parses must encode to a frame with a valid CRC.
      expect(crcOk(encodeRequest(1, c).frame)).toBe(true);
    }
  });
});
