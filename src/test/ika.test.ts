import { describe, expect, it } from 'vitest';
import { DeviceInstance } from '../core/device';
import { eurostar60 } from '../devices/eurostar60';
import { retControlVisc } from '../devices/retControlVisc';
import { detectDriver } from '../devices/registry';
import { ISMATEC, NAMUR } from '../core/protocol';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('driver detection', () => {
  it('maps name replies to drivers', () => {
    expect(detectDriver('IKA ES 60')?.model).toBe('eurostar60');
    expect(detectDriver('RET control-visc')?.model).toBe('retControlVisc');
    expect(detectDriver('REGLO ICC 0208 406')?.model).toBe('regloIcc');
    expect(detectDriver('something else')).toBeUndefined();
  });
});

describe('protocols', () => {
  it('NAMUR: only IN_ commands expect a reply; writes are not acknowledged', () => {
    expect(NAMUR.expectsReply('IN_PV_4')).toBe(true);
    expect(NAMUR.expectsReply('OUT_SP_4 300')).toBe(false);
    expect(() => NAMUR.checkAck('START_4', null)).not.toThrow();
  });
  it('Ismatec: # and - are refusals', () => {
    expect(() => ISMATEC.checkAck('1H', '*')).not.toThrow();
    expect(() => ISMATEC.checkAck('1f5000+0', '5000E+0')).not.toThrow();
    expect(() => ISMATEC.checkAck('1H', '#')).toThrow(/refused/);
    expect(() => ISMATEC.checkAck('1H', '-')).toThrow(/can't run/);
  });
});

describe('IKA drivers against the simulator', () => {
  it('EUROSTAR 60: set speed is confirmed by read-back', async () => {
    const dev = new DeviceInstance('st', eurostar60, 'Stirrer', '#000', eurostar60.simulate(), 100);
    expect(await dev.connect()).toBe('IKA ES 60');
    await dev.setSetpoint('speed', 450);
    await dev.setSwitch('motor', true);
    await wait(400);
    expect(dev.snapshot.setpoints.speed).toBe(450);
    expect(dev.pending.speed).toBeUndefined();
    expect(dev.status).toBe('Stirring');
    expect(() => dev.checkSetpoint('speed', 5000)).toThrow(/30–2000/);
    await dev.disconnect(true);
  });

  it('RET control-visc: user limit is enforced', async () => {
    const dev = new DeviceInstance('hp', retControlVisc, 'Hotplate', '#000', retControlVisc.simulate(), 100);
    await dev.connect();
    dev.limits.temp = 80;
    expect(() => dev.checkSetpoint('temp', 120)).toThrow(/your limit/);
    await dev.disconnect(true);
  });
});
