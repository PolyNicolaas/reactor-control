import { describe, expect, it } from 'vitest';
import { peer, runSafety, snap } from '../shared/testing';
import { DeviceInstance } from '../../core/device';
import { labV1 } from './module';
import { labV1Safety } from './safety';
import { LabV1Sim, SIM_ML_PER_REV } from './sim';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const connect = async () => {
  const sim = new LabV1Sim();
  const dev = new DeviceInstance('lv', labV1, 'Pump B', '#000', sim.transport, 100);
  const sent: string[] = [];
  dev.events.on((e) => e.kind === 'tx' && !dev.isPollCommand(e.text) && sent.push(e.text));
  await dev.connect();
  return { dev, sim, sent };
};

describe('LabV1-III driver against the simulator (real Modbus frames)', () => {
  it('puts the pump in Transferring mode on connect, and changes nothing else', async () => {
    const { dev, sim, sent } = await connect();
    expect(sent).toEqual(['W1020=0']);
    expect(sim.slave.get(1020)).toBe(0);
    await wait(250);
    expect(dev.snapshot.values.mode).toBe(0);
    expect(dev.snapshot.values.tubing).toBe(25);
    expect(dev.snapshot.values.dir).toBe(1);
    await dev.disconnect(false);
  });

  it('sets a flow in mL/min, reads back the speed the pump chose, and integrates Dispensed', async () => {
    const { dev, sim } = await connect();
    await dev.setSetpoint('flow', 50);
    expect(sim.slave.get(1004)).toBe(50);
    await dev.setSwitch('run', true);
    expect(sim.slave.get(1008)).toBe(1);
    await wait(500);
    expect(dev.snapshot.values.flow).toBe(50);
    expect(dev.snapshot.values.speed).toBeCloseTo(50 / SIM_ML_PER_REV, 3);
    expect(dev.snapshot.values.dispensed).toBeGreaterThan(0);
    expect(dev.pending.flow).toBeUndefined();
    await dev.disconnect(true);
    expect(sim.slave.get(1008)).toBe(0);
  });

  it('notices a stop made on the pump', async () => {
    const { dev, sim } = await connect();
    await dev.setSwitch('run', true);
    sim.slave.set(1008, 0);
    await wait(500);
    expect(dev.snapshot.switches.run).toBe(false);
    await dev.disconnect(false);
  });

  it('a pump left in a menu answers "busy", and the card says so', async () => {
    const { dev, sim } = await connect();
    sim.slave.fault = 'busy';
    await expect(dev.setSwitch('run', true)).rejects.toThrow(/main screen/);
    expect(dev.snapshot.switches.run).toBe(false);
    await dev.disconnect(false);
  });
});

describe('LabV1-III safety', () => {
  const s = (v: Record<string, number | undefined>, run = true) => snap(v, { flow: 10 }, { run });

  it('Transfer mode: stops the pump when its mode is changed to a dispensing mode while it runs', () => {
    const hit = runSafety(labV1Safety, (t) => s({ running: 1, mode: t < 10 ? 0 : 1 }), 60);
    expect(hit.rule).toBe('transferMode');
    expect(hit.t).toBe(10);
    expect(runSafety(labV1Safety, () => s({ running: 1, mode: 0 }), 60).rule).toBeUndefined();
    // Stopped in the wrong mode: a warning, not a trip.
    const idle = runSafety(labV1Safety, () => s({ running: 0, mode: 2 }, false), 10);
    expect(idle.rule).toBeUndefined();
    expect(idle.statuses.transferMode.state).toBe('near');
  });

  it('Run reading: stops the pump when its run report stays missing', () => {
    expect(runSafety(labV1Safety, (t) => s({ running: t < 3 ? 1 : undefined, mode: 0 }), 60).rule).toBe('runReading');
    expect(runSafety(labV1Safety, () => s({ running: 1, mode: 0 }), 60).rule).toBeUndefined();
  });

  it('Volume limit trips at the maximum, not below (off by default)', () => {
    expect(runSafety(labV1Safety, (t) => s({ running: 1, mode: 0, dispensed: t }), 20).statuses.volume.state).toBe('off');
    expect(runSafety(labV1Safety, (t) => s({ running: 1, mode: 0, dispensed: t }), 60, { on: ['volume'], set: { volumeMax: 20 } }).t).toBe(20);
    expect(runSafety(labV1Safety, () => s({ running: 1, mode: 0, dispensed: 19 }), 60, { on: ['volume'], set: { volumeMax: 20 } }).rule).toBeUndefined();
  });

  it('Dose only while stirring: any stirrer counts', () => {
    const magnetic = (stirring: boolean) => [peer({ label: 'Hotplate', provides: ['stirrer', 'magnetic-stirrer'], active: { stirring } })];
    const hit = runSafety(labV1Safety, () => s({ running: 1, mode: 0 }), 60, { peers: (t) => magnetic(t < 30) });
    expect(hit.rule).toBe('noStirring');
    expect(hit.t).toBe(35);
    expect(runSafety(labV1Safety, () => s({ running: 1, mode: 0 }), 60, { peers: () => magnetic(true) }).rule).toBeUndefined();
  });
});
