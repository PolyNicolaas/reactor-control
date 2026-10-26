import { describe, expect, it } from 'vitest';
import { DeviceInstance } from '../../core/device';
import { runSafety, snap } from '../shared/testing';
import { eurostar60 } from './module';
import { eurostarSafety } from './safety';

// Tests for the EUROSTAR module: the card's set-vs-actual line against the simulator, and the
// torque rule on made-up timelines.

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('EUROSTAR set vs actual', () => {
  it('after Motor off/on the card says the unit dropped the speed, until Apply', async () => {
    const dev = new DeviceInstance('st', eurostar60, 'Stirrer', '#000', eurostar60.simulate(), 100);
    await dev.connect();
    expect(dev.tracking('speed').state).not.toBe('mismatch');
    await dev.setSetpoint('speed', 400);
    await dev.setSwitch('motor', true);
    await wait(6000);
    expect(dev.tracking('speed').state).toBe('ok');
    expect(dev.tracking('speed').text).toMatch(/Set 400 rpm · actual \d+ rpm ✓/);
    await dev.setSwitch('motor', false);
    await wait(300);
    await dev.setSwitch('motor', true);
    await wait(300);
    const tr = dev.tracking('speed');
    expect(tr.state).toBe('mismatch');
    expect(tr.text).toMatch(/set to 0 rpm, not the 400 rpm you applied/);
    await dev.setSetpoint('speed', 400);
    await wait(300);
    expect(dev.tracking('speed').state).toMatch(/moving|ok/);
    await dev.disconnect(true);
  }, 15000);

  it('flags a motor that is on but not turning after the grace time', async () => {
    const dev = new DeviceInstance('st', eurostar60, 'Stirrer', '#000', eurostar60.simulate(), 100);
    await dev.connect();
    await dev.setSetpoint('speed', 400);
    await dev.setSwitch('motor', true);
    await dev.raw('SIM_JAM 1');
    await wait(500);
    expect(dev.tracking('speed').state).toBe('moving');
    expect(dev.tracking('speed', Date.now() + 9000).state).toBe('stuck');
    expect(dev.tracking('speed', Date.now() + 9000).text).toMatch(/Motor is on but speed is \d+ rpm, not 400 rpm/);
    await dev.disconnect(true);
  });
});

describe('EUROSTAR safety: torque limit', () => {
  const es = (torque: number, motor = true) => snap({ torque }, {}, { motor });

  it('is off until a max torque is set', () => {
    expect(runSafety(eurostarSafety, () => es(50), 10).statuses.torque.state).toBe('off');
  });

  it('stops the motor after 3 s above the limit, not on one noisy reading', () => {
    expect(runSafety(eurostarSafety, (t) => es(t === 5 ? 40 : 10), 20, { set: { torqueMax: 30 } }).rule).toBeUndefined();
    const hit = runSafety(eurostarSafety, (t) => es(t < 10 ? 10 : 35), 30, { set: { torqueMax: 30 } });
    expect(hit.rule).toBe('torque');
    expect(hit.t).toBe(13);
  });

  it('a jammed shaft on the simulator trips it and stops the motor', async () => {
    const dev = new DeviceInstance('st', eurostar60, 'Stirrer', '#000', eurostar60.simulate(), 100);
    dev.safetySettings.torqueMax = 40;
    await dev.connect();
    await dev.setSetpoint('speed', 400);
    await dev.setSwitch('motor', true);
    await dev.raw('SIM_JAM 1');
    await wait(4000);
    expect(dev.tripped.torque).toMatch(/above the 40 Ncm limit/);
    expect(dev.snapshot.switches.motor).toBe(false);
    await dev.disconnect(true);
  });
});
