// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../core/app';
import type { DeviceInstance } from '../core/device';
import { MODBUS_LINK } from '../core/protocol';
import { transportFor } from '../core/serialTransport';
import { HandyPumpSim } from '../modules/innofluid-st-handypump/sim';
import { LabV1Sim } from '../modules/innofluid-labv1/sim';
import { Rs485Cable, grantPorts } from './rs485Cable';

// End to end: the real App, DeviceInstance, ModbusTransport and ModbusBus, with three pumps on one
// simulated RS-485 cable (two ST-HandyPumps at addresses 1 and 2, a LabV1-III at 3), as in the
// RS-485 adapter guide. Only the wire and the pumps are simulated.

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms = 5000, what = 'condition') => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await wait(20);
  }
};

function bench() {
  const hpA = new HandyPumpSim(1).slave;
  const hpB = new HandyPumpSim(2).slave;
  const lv = new LabV1Sim(3).slave;
  lv.set(1000, 7); // head code, distinct from every other register value used here
  const cable = new Rs485Cable([hpA, hpB, lv]);
  const app = new App();
  const add = async (model: 'innofluidHandyPump' | 'innofluidLabV1', addr: number, label: string) => {
    const link = MODBUS_LINK(addr);
    const dev = await app.addDevice({ model, label, transport: transportFor(cable.port, link), link });
    dev.pollMs = 100;
    return dev;
  };
  const all = async () => [await add('innofluidHandyPump', 1, 'Pump A'), await add('innofluidHandyPump', 2, 'Pump B'), await add('innofluidLabV1', 3, 'Pump C')] as const;
  return { hpA, hpB, lv, cable, app, add, all };
}

const apps: App[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) for (const d of [...app.devices]) await app.removeDevice(d).catch(() => {});
  localStorage.clear();
});

const track = (b: ReturnType<typeof bench>) => (apps.push(b.app), b);

describe('three Innofluid pumps on one RS-485 cable (whole app)', () => {
  it('poll together over one port, with no collisions and the RTU gap kept', async () => {
    const b = track(bench());
    const [a, bb, c] = await b.all();
    await wait(1500);
    expect(b.cable.opens).toBe(1);
    for (const d of [a, bb, c]) expect(d.connected && d.responding, d.label).toBe(true);
    expect(a.snapshot.setpoints.speed).toBe(100);
    expect(bb.snapshot.values.dir).toBe(1);
    expect(c.snapshot.values.mode).toBe(0); // set by the LabV's init command
    expect(c.snapshot.values.tubing).toBe(25);
    expect(c.snapshot.values.head).toBe(7);
    expect(b.cable.collisions).toEqual([]);
    expect(b.cable.shortGaps).toEqual([]);
    // Every pump was polled several times.
    for (const addr of [1, 2, 3]) expect(b.cable.sentTo(addr).length, `address ${addr}`).toBeGreaterThan(10);
  });

  it('send each command to its own pump only', async () => {
    const b = track(bench());
    const [, bb, c] = await b.all();
    await bb.setSwitch('run', true);
    await c.setSetpoint('flow', 50);
    expect(b.hpB.get(1000)).toBe(1);
    expect(b.hpA.get(1000)).toBe(0);
    expect(b.lv.get(1008)).toBe(0);
    expect(b.lv.get(1004)).toBe(50);
    expect(b.hpA.get(1002)).toBe(100);
  });

  it('a safety trip on one pump stops that pump and no other', async () => {
    const b = track(bench());
    const [a, bb, c] = await b.all();
    for (const d of [a, bb, c]) await d.setSwitch('run', true);
    b.lv.set(1020, 1); // someone picks Fixed volume on the LabV's keypad while it runs
    await until(() => !!c.tripped.transferMode, 3000, 'Transfer mode trip');
    await until(() => b.lv.get(1008) === 0, 2000, 'LabV stopped');
    expect(b.hpA.get(1000)).toBe(1);
    expect(b.hpB.get(1000)).toBe(1);
    expect(a.tripped).toEqual({});
  });

  it('Stop all stops every pump on the cable', async () => {
    const b = track(bench());
    const devs = await b.all();
    for (const d of devs) await d.setSwitch('run', true);
    const r = await b.app.stopAll();
    expect(r.failed).toEqual([]);
    expect([b.hpA.get(1000), b.hpB.get(1000), b.lv.get(1008)]).toEqual([0, 0, 0]);
  });

  it('removing one card leaves the others running on the open port; removing the last closes it', async () => {
    const b = track(bench());
    const [a, bb, c] = await b.all();
    await a.setSwitch('run', true);
    await b.app.removeDevice(bb);
    expect(b.cable.isOpen).toBe(true);
    const n = b.cable.sentTo(2).length;
    const nA = b.cable.sentTo(1).length;
    await wait(600);
    expect(b.cable.sentTo(2).length).toBe(n); // nothing more to the removed pump
    expect(b.cable.sentTo(1).length).toBeGreaterThan(nA);
    expect(b.hpA.get(1000)).toBe(1); // removing B did not stop A
    expect(b.hpB.get(1000)).toBe(0); // and B was stopped when its card was removed
    await b.app.removeDevice(a);
    await b.app.removeDevice(c);
    expect(b.cable.isOpen).toBe(false);
    expect(b.cable.closes).toBe(1);
  });

  it('refuses a second card at an address already used on the cable, allows a new address', async () => {
    const b = track(bench());
    const [a] = await b.all();
    expect(b.app.portOwner(b.cable.port, MODBUS_LINK(1))).toBe(a);
    expect(b.app.portOwner(b.cable.port, MODBUS_LINK(4))).toBeUndefined();
    expect(b.app.portOwner(b.cable.port)).toBeDefined(); // an IKA unit cannot take a pump bus port
  });

  it('one silent pump does not starve the others: they keep polling at a useful rate', async () => {
    const b = track(bench());
    const [, bb, c] = await b.all();
    await wait(500);
    b.hpB.fault = 'silent'; // its cable pulled at the pump
    await until(() => !bb.responding, 5000, 'B not responding');
    const n = b.cable.sentTo(3).length;
    await wait(3000);
    const perSecond = (b.cable.sentTo(3).length - n) / 3;
    expect(c.responding).toBe(true);
    // The LabV is polled ~2–3 commands per cycle; at 100 ms that is > 20/s when the bus is free.
    // With a dead neighbour it must still be polled at least once a second (rules run per poll).
    expect(perSecond).toBeGreaterThan(2);
  }, 15000);

  it('a pump that stops answering while on trips Run reading, even though nothing else answers either', async () => {
    const b = track(bench());
    const [a] = await b.all();
    a.setSafetySetting('runLostS', 3);
    await a.setSwitch('run', true);
    b.hpA.fault = 'silent';
    await until(() => !!a.tripped.runReading, 8000, 'Run reading trip');
    expect(b.hpA.get(1000)).toBe(1); // the stop could not reach it yet
    b.hpA.fault = undefined; // the cable is back: the repeated stop goes through
    await until(() => b.hpA.get(1000) === 0, 8000, 'pump stopped once it answers');
  }, 20000);

  it('a silent pump that is switched off does not trip Run reading', async () => {
    const b = track(bench());
    const [a] = await b.all();
    a.setSafetySetting('runLostS', 3);
    b.hpA.fault = 'silent';
    await wait(4500);
    expect(a.responding).toBe(false);
    expect(a.tripped).toEqual({});
    expect(a.ruleStatus.runReading?.state).toBe('idle');
  }, 15000);

  it('a pump that cannot read its run register trips Run reading', async () => {
    const b = track(bench());
    const [a] = await b.all();
    a.setSafetySetting('runLostS', 3);
    await a.setSwitch('run', true);
    b.hpA.regs.delete(1000); // R1000 now answers "illegal data address"; writes to it still work
    b.hpA.map[1000] = { min: 0, max: 1 };
    await until(() => !!a.tripped.runReading, 8000, 'Run reading trip');
    expect(a.responding).toBe(true);
  }, 15000);

  it('Dispensed counts a gap with no replies while the pump ran (errs high, not low)', async () => {
    const b = track(bench());
    const [a] = await b.all();
    a.setSafetySetting('runLostS', 60);
    a.setSafetySetting('mlPerRev', 1);
    await a.setSetpoint('speed', 60); // 60 mL/min = 1 mL/s
    const t0 = Date.now();
    await a.setSwitch('run', true);
    await wait(1000);
    b.hpA.fault = 'silent';
    await wait(2500);
    b.hpA.fault = undefined;
    await until(() => a.responding, 5000, 'answering again');
    await wait(600);
    const ran = (Date.now() - t0) / 1000;
    expect(a.snapshot.values.dispensed!).toBeGreaterThan(ran * 0.85);
  }, 15000);

  it('noise and a corrupted reply never put a wrong number in a reading', async () => {
    const b = track(bench());
    const [a, , c] = await b.all();
    const seen = { run: new Set<number | undefined>(), mode: new Set<number | undefined>(), tubing: new Set<number | undefined>(), head: new Set<number | undefined>(), speedSet: new Set<number | undefined>() };
    const sample = setInterval(() => {
      seen.run.add(a.snapshot.values.running);
      seen.speedSet.add(a.snapshot.setpoints.speed);
      seen.mode.add(c.snapshot.values.mode);
      seen.tubing.add(c.snapshot.values.tubing);
      seen.head.add(c.snapshot.values.head);
    }, 5);
    for (let i = 0; i < 10; i++) {
      await wait(150);
      if (i % 3 === 0) b.cable.corruptNextReply();
      if (i % 3 === 1) b.cable.noise([0x03, 0x03, 0x02, 0x00, 0x19]);
      if (i % 3 === 2) b.cable.slowNextReply(360); // arrives just after its 300 ms timeout
    }
    // A late reply or noise overlaps the master's next frame on any real bus; what matters is that the
    // app recovers: once the faults stop, the line is clean again.
    await wait(800);
    const afterFaults = b.cable.collisions.length;
    await wait(800);
    clearInterval(sample);
    const legit = (s: Set<number | undefined>, ok: (number | undefined)[]) => [...s].filter((v) => !ok.includes(v));
    expect(legit(seen.run, [0, undefined])).toEqual([]);
    expect(legit(seen.speedSet, [100, undefined])).toEqual([]);
    expect(legit(seen.mode, [0, undefined])).toEqual([]);
    expect(legit(seen.tubing, [25, undefined])).toEqual([]);
    expect(legit(seen.head, [7, undefined])).toEqual([]);
    expect(b.cable.collisions.slice(afterFaults)).toEqual([]);
    expect(a.responding && c.responding).toBe(true);
  }, 15000);

  it('unplugging the adapter disconnects every pump card; Reconnect brings each back', async () => {
    const b = track(bench());
    const devs = await b.all();
    b.cable.unplug();
    await until(() => devs.every((d) => !d.connected), 3000, 'all disconnected');
    b.cable.replug();
    for (const [d, addr] of [[devs[0], 1], [devs[1], 2], [devs[2], 3]] as [DeviceInstance, number][]) {
      await d.replaceTransport(transportFor(b.cable.port, MODBUS_LINK(addr)));
    }
    await wait(500);
    for (const d of devs) expect(d.connected && d.responding, d.label).toBe(true);
    expect(b.cable.opens).toBe(2);
    expect(b.cable.collisions).toEqual([]);
  }, 15000);

  it('a saved page comes back: every pump on its address, one port, settings kept', async () => {
    const b = track(bench());
    const tmp = new App();
    apps.push(tmp);
    for (const [model, addr, label] of [['innofluidHandyPump', 1, 'Pump A'], ['innofluidHandyPump', 2, 'Pump B'], ['innofluidLabV1', 3, 'Pump C']] as const) {
      await tmp.addDevice({ model, label, transport: transportFor(b.cable.port, MODBUS_LINK(addr)), link: MODBUS_LINK(addr), safety: addr === 1 ? { mlPerRev: 0.25 } : undefined });
    }
    tmp.save();
    // The page is closed: the cards go without stopping anything, the port closes.
    for (const d of [...tmp.devices]) await d.disconnect(false);
    tmp.devices.length = 0;
    expect(b.cable.isOpen).toBe(false);
    const restoreGrant = grantPorts([b.cable.port]);
    try {
      const app2 = new App();
      apps.push(app2);
      const missing = await app2.restore();
      expect(missing).toEqual([]);
      expect(app2.devices.map((d) => [d.label, d.link?.address])).toEqual([['Pump A', 1], ['Pump B', 2], ['Pump C', 3]]);
      expect(app2.devices[0].safetySettings.mlPerRev).toBe(0.25);
      for (const d of app2.devices) d.pollMs = 100;
      await wait(500);
      for (const d of app2.devices) expect(d.connected && d.responding, d.label).toBe(true);
      expect(b.cable.collisions).toEqual([]);
    } finally {
      restoreGrant();
    }
  }, 20000);

  it('restoring a page where one pump is switched off brings back the others and lists it as missing', async () => {
    const b = track(bench());
    const tmp = new App();
    apps.push(tmp);
    for (const [model, addr, label] of [['innofluidHandyPump', 1, 'Pump A'], ['innofluidHandyPump', 2, 'Pump B'], ['innofluidLabV1', 3, 'Pump C']] as const) {
      await tmp.addDevice({ model, label, transport: transportFor(b.cable.port, MODBUS_LINK(addr)), link: MODBUS_LINK(addr) });
    }
    tmp.save();
    for (const d of [...tmp.devices]) await d.disconnect(false);
    tmp.devices.length = 0;
    b.hpB.fault = 'silent';
    const restoreGrant = grantPorts([b.cable.port]);
    try {
      const app2 = new App();
      apps.push(app2);
      const missing = await app2.restore();
      expect(missing.map((m) => m.label)).toEqual(['Pump B']);
      expect(app2.devices.map((d) => d.label)).toEqual(['Pump A', 'Pump C']);
    } finally {
      restoreGrant();
    }
  }, 20000);
});
