import { describe, expect, it } from 'vitest';
import { peer, runSafety, snap } from '../shared/testing';
import { DeviceInstance } from '../../core/device';
import { DEFAULT_ML_PER_REV, handyPump } from './module';
import { handyPumpSafety } from './safety';
import { HandyPumpSim } from './sim';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const connect = async () => {
  const sim = new HandyPumpSim();
  const dev = new DeviceInstance('hp', handyPump, 'Pump A', '#000', sim.transport, 100);
  const sent: string[] = [];
  dev.events.on((e) => e.kind === 'tx' && !dev.isPollCommand(e.text) && sent.push(e.text));
  await dev.connect();
  return { dev, sim, sent };
};

describe('ST-HandyPump driver against the simulator (real Modbus frames)', () => {
  it('connects without changing anything on the pump (direction stays as set on the pump)', async () => {
    const { dev, sent, sim } = await connect();
    expect(sent).toEqual([]);
    await wait(250);
    expect(dev.snapshot.values.dir).toBe(1);
    expect(dev.snapshot.setpoints.speed).toBe(100);
    expect(sim.slave.get(1001)).toBe(1);
    await dev.disconnect(false);
  });

  it('sets a speed, runs, and turns rpm into mL/min with mL per revolution', async () => {
    const { dev, sim } = await connect();
    await dev.setSetpoint('speed', 58.8);
    expect(sim.slave.get(1002)).toBeCloseTo(58.8, 4);
    await dev.setSwitch('run', true);
    expect(sim.slave.get(1000)).toBe(1);
    await wait(500);
    expect(dev.snapshot.values.speed).toBe(58.8);
    expect(dev.snapshot.values.flow).toBeCloseTo(58.8 * DEFAULT_ML_PER_REV, 6);
    expect(dev.snapshot.values.dispensed).toBeGreaterThan(0);
    expect(dev.pending.speed).toBeUndefined();
    expect(dev.status).toBe('Pumping');
    dev.setSafetySetting('mlPerRev', 0.1);
    await wait(250);
    expect(dev.snapshot.values.flow).toBeCloseTo(5.88, 6);
    await dev.disconnect(true);
    expect(sim.slave.get(1000)).toBe(0); // removing the card stops the pump
  });

  it('refuses speeds outside 0.1–300 rpm before sending anything', async () => {
    const { dev } = await connect();
    expect(() => dev.checkSetpoint('speed', 350)).toThrow(/0\.1–300/);
    await dev.disconnect(false);
  });

  it('notices a stop made on the pump, and counts a start made on the pump', async () => {
    const { dev, sim } = await connect();
    await dev.setSwitch('run', true);
    sim.slave.set(1000, 0); // Stop pressed on the pump
    await wait(500);
    expect(dev.snapshot.switches.run).toBe(false);
    const before = dev.snapshot.values.dispensed ?? 0;
    sim.slave.set(1000, 1); // Start pressed on the pump
    await wait(400);
    expect(dev.snapshot.values.dispensed!).toBeGreaterThan(before);
    expect(dev.status).toBe('Pumping');
    await dev.disconnect(true);
  });

  it('one "stopped" poll that races a start does not switch the pump off, however long it sat idle', () => {
    const s = snap({ running: 0 }, { speed: 100 }, { run: false });
    for (let i = 0; i < 20; i++) handyPump.derive!(s, 1, { mlPerRev: 1 }); // idle for 20 polls
    s.switches.run = true; // Pump on from the card
    handyPump.derive!(s, 1, { mlPerRev: 1 }); // this poll read R1000 just before the start
    expect(s.switches.run).toBe(true);
    handyPump.derive!(s, 1, { mlPerRev: 1 });
    expect(s.switches.run).toBe(false); // twice while on: the pump really stopped
  });

  it('Dispensed errs high: a failed speed read uses the last speed, and a gap with no replies is counted', () => {
    const s = snap({ running: 1, dispensed: 0 }, { speed: 60 }, { run: true });
    handyPump.derive!(s, 1, { mlPerRev: 1 }); // 60 mL/min for 1 s = 1 mL
    expect(s.values.dispensed).toBeCloseTo(1, 6);
    s.setpoints.speed = undefined; // RF1002 timed out this poll
    handyPump.derive!(s, 1, { mlPerRev: 1 });
    expect(s.values.dispensed).toBeCloseTo(2, 6);
    handyPump.derive!(s, 30, { mlPerRev: 1 }); // 30 s without replies, then it answers again
    expect(s.values.dispensed).toBeCloseTo(32, 6);
    s.values.running = 0; // stopped some time in that gap: counted to this poll (high, not low)
    handyPump.derive!(s, 5, { mlPerRev: 1 });
    expect(s.values.dispensed).toBeCloseTo(37, 6);
    handyPump.derive!(s, 5, { mlPerRev: 1 });
    expect(s.values.dispensed).toBeCloseTo(37, 6);
  });

  it('shows the pump\'s refusal in words', async () => {
    const { dev } = await connect();
    await expect(dev.raw('W1500=1')).rejects.toThrow(/no such register/);
    await dev.disconnect(false);
  });
});

describe('ST-HandyPump safety', () => {
  const on = (v: Record<string, number | undefined>) => snap(v, { speed: 100 }, { run: true });

  it('Run reading: stops the pump when the pump stops reporting whether it runs (required)', () => {
    expect(handyPumpSafety.rules.find((r) => r.key === 'runReading')!.required).toBe(true);
    const hit = runSafety(handyPumpSafety, (t) => on({ running: t < 5 ? 1 : undefined }), 60);
    expect(hit.rule).toBe('runReading');
    expect(hit.t).toBe(14); // last seen at 4 s, 10 s default
    expect(runSafety(handyPumpSafety, () => on({ running: 1 }), 60).rule).toBeUndefined();
    // Switched off: nothing to watch, even without a reading.
    expect(runSafety(handyPumpSafety, () => snap({}, {}, { run: false }), 60).rule).toBeUndefined();
  });

  it('Volume limit: off by default; trips at the maximum, not below; reset starts the count again', async () => {
    expect(runSafety(handyPumpSafety, (t) => on({ running: 1, dispensed: t }), 30).statuses.volume.state).toBe('off');
    const hit = runSafety(handyPumpSafety, (t) => on({ running: 1, dispensed: t * 0.1 }), 200, { on: ['volume'], set: { volumeMax: 5 } });
    expect(hit.rule).toBe('volume');
    expect(hit.t).toBe(50);
    expect(runSafety(handyPumpSafety, (t) => on({ running: 1, dispensed: Math.min(4.9, t * 0.1) }), 200, { on: ['volume'], set: { volumeMax: 5 } }).rule).toBeUndefined();

    const { dev } = await connect();
    dev.setRuleOn('volume', true);
    dev.setSafetySetting('volumeMax', 0.5);
    dev.snapshot.values.dispensed = 0.6;
    await wait(300);
    expect(dev.tripped.volume).toBeTruthy();
    dev.resetSafety();
    expect(dev.snapshot.values.dispensed).toBeLessThan(0.5);
    await dev.disconnect(true);
  });

  it('Dose only while stirring: stops 5 s after nothing stirs; a keypad start counts as dosing', () => {
    const stirrer = (stirring: boolean) => [peer({ label: 'Stirrer', provides: ['stirrer'], active: { stirring } })];
    expect(runSafety(handyPumpSafety, () => on({ running: 1 }), 60, { peers: () => stirrer(true) }).rule).toBeUndefined();
    const keypad = () => snap({ running: 1 }, {}, { run: false });
    const hit = runSafety(handyPumpSafety, keypad, 60, { peers: (t) => stirrer(t < 20) });
    expect(hit.rule).toBe('noStirring');
    expect(hit.t).toBe(25);
    expect(runSafety(handyPumpSafety, () => snap({ running: 0 }, {}, { run: false }), 60, { peers: () => stirrer(false) }).rule).toBeUndefined();
  });
});
