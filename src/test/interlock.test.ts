import { describe, expect, it } from 'vitest';
import { DeviceInstance } from '../core/device';
import type { DeviceSnapshot } from '../core/types';
import { retControlVisc } from '../devices/retControlVisc';
import { plateProbeInterlock as il } from '../devices/retInterlock';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const defaults = Object.fromEntries(il.settings.map((s) => [s.key, s.default]));
const snap = (plate: number, probe: number, sp = 50, heater = true): DeviceSnapshot => ({
  values: { plate, probe }, gross: {}, setpoints: { temp: sp }, switches: { heater, stirrer: false },
});

/** Feed one sample per second; return the first reason (and the second it came) or undefined. */
function run(samples: (t: number) => DeviceSnapshot, seconds: number, set = defaults) {
  const mem = {};
  for (let t = 0; t <= seconds; t++) {
    const r = il.check(samples(t), set, mem, t * 1000);
    if (r) return { t, r };
  }
  return undefined;
}

describe('RET plate/probe interlock rules', () => {
  it('trips at once above the absolute plate maximum', () => {
    expect(run(() => snap(260, 250, 240), 0)?.r).toMatch(/above the 250 °C maximum/);
  });

  it('probe out of the medium: trips when the plate runs 30 °C past the setpoint', () => {
    // Probe stays at 22 °C; plate climbs 15 °C/min from 22 °C.
    const hit = run((t) => snap(22 + t * 0.25, 22, 50), 900, { ...defaults, probeGap: 0 });
    expect(hit?.r).toMatch(/more than 30 °C above the 50 °C setpoint/);
    expect(22 + hit!.t * 0.25).toBeGreaterThan(80);
    expect(22 + hit!.t * 0.25).toBeLessThan(82);
  });

  it('probe check catches a flat probe before the plate gets very hot (high setpoint)', () => {
    const hit = run((t) => snap(Math.min(340, 22 + t * 0.25), 22, 200), 1800);
    expect(hit?.r).toMatch(/Probe rose only 0 °C in 5 min/);
    expect(22 + hit!.t * 0.25).toBeLessThan(200); // well before setpoint + 30
  });

  it('normal heat-up with the probe in the medium does not trip', () => {
    // Plate leads the probe by ~15 °C and settles 10 °C above a 120 °C setpoint.
    const plate = (t: number) => Math.min(130, 22 + t * 0.25);
    const probe = (t: number) => Math.min(120, 22 + Math.max(0, t - 60) * 0.25);
    expect(run((t) => snap(plate(t), probe(t), 120), 3600)).toBeUndefined();
  });

  it('lowering the setpoint while the plate is hot does not trip (plate cooling)', () => {
    // Was at 150 °C; setpoint drops to 50; plate cools 0.1 °C/s from 170.
    expect(run((t) => snap(170 - t * 0.1, 150 - t * 0.05, 50), 600, { ...defaults, probeGap: 0 })).toBeUndefined();
  });

  it('probe check ignores a plate held hot by a keypad-off heater that is cooling', () => {
    expect(run((t) => snap(130 - t * 0.02, 80 - t * 0.01, 100, false), 900, { ...defaults, plateAbove: 100 })).toBeUndefined();
  });
});

describe('interlock on a connected (simulated) RET', () => {
  it('switches the heater off, locks it out, and only resets once the plate is safe', async () => {
    const dev = new DeviceInstance('hp', retControlVisc, 'Hotplate', '#000', retControlVisc.simulate(), 100);
    await dev.connect();
    await dev.setSwitch('heater', true);
    const trips: string[] = [];
    dev.tripped$.on((t) => trips.push(t));
    await dev.raw('SIM_PIN 2 300'); // plate at 300 °C
    await wait(500);
    expect(dev.tripped.plate).toMatch(/300 °C is above the 250 °C maximum/);
    expect(dev.snapshot.switches.heater).toBe(false);
    expect(dev.status).toBe('Interlock');
    expect(trips).toHaveLength(1);
    await expect(dev.setSwitch('heater', true)).rejects.toThrow(/locked out/);
    expect(() => dev.resetInterlock('plate')).toThrow(/Cannot reset yet/);

    await dev.raw('SIM_PIN 2 40');
    await wait(400);
    dev.resetInterlock('plate');
    expect(dev.tripped.plate).toBeUndefined();
    await dev.setSwitch('heater', true);
    expect(dev.snapshot.switches.heater).toBe(true);
    await dev.disconnect(true);
  });

  it('user settings override the defaults', async () => {
    const dev = new DeviceInstance('hp', retControlVisc, 'Hotplate', '#000', retControlVisc.simulate(), 100);
    dev.interlockSettings['plate.plateMax'] = 320;
    expect(dev.interlockValues('plate').plateMax).toBe(320);
    expect(dev.interlockValues('plate').plateAbove).toBe(30);
  });
});

describe('set vs actual line', () => {
  it('EUROSTAR: after Motor off/on the card says the unit dropped the speed, until Apply', async () => {
    const { eurostar60 } = await import('../devices/eurostar60');
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

  it('flags a function that is on but not following after the grace time', async () => {
    const { eurostar60 } = await import('../devices/eurostar60');
    const dev = new DeviceInstance('st', eurostar60, 'Stirrer', '#000', eurostar60.simulate(), 100);
    await dev.connect();
    await dev.setSetpoint('speed', 400);
    await dev.setSwitch('motor', true);
    await dev.raw('SIM_PIN 4 0'); // motor blocked
    await wait(500);
    expect(dev.tracking('speed').state).toBe('moving');
    expect(dev.tracking('speed', Date.now() + 9000).state).toBe('stuck');
    expect(dev.tracking('speed', Date.now() + 9000).text).toMatch(/Motor is on but speed is 0 rpm, not 400 rpm/);
    await dev.disconnect(true);
  });
});

describe('dynamic plate/probe rules', () => {
  const at = (plate: number, probe: number | undefined, sp = 120, heater = true): DeviceSnapshot => ({
    values: { plate, probe }, gross: {}, setpoints: { temp: sp }, switches: { heater, stirrer: false },
  });
  const runSnap = (f: (t: number) => DeviceSnapshot, seconds: number, set = defaults) => {
    const mem = {};
    for (let t = 0; t <= seconds; t++) {
      const r = il.check(f(t), set, mem, t * 1000);
      if (r) return { t, r, mem };
    }
    return { t: -1, r: undefined, mem };
  };

  it('probe pulled out mid-run (falls fast, setpoint unchanged) trips within seconds', () => {
    // Holding 120 °C with the plate at 135; at t=300 the probe is lifted into air and cools 0.5 °C/s.
    const hit = runSnap((t) => at(135, t < 300 ? 120 : Math.max(25, 120 - (t - 300) * 0.5)), 600);
    expect(hit.r).toMatch(/Probe fell 10 °C/);
    expect(hit.t).toBeLessThan(330);
  });

  it('lowering the setpoint does not count as a probe drop', () => {
    const hit = runSnap((t) => at(Math.max(60, 135 - t * 0.2), Math.max(55, 120 - t * 0.2), t < 10 ? 120 : 50, true), 600, { ...defaults, gapGrowth: 0 });
    expect(hit.r).toBeUndefined();
  });

  it('probe reading lost while heating trips after 10 s; never seen (plate-only use) does not', () => {
    const lost = runSnap((t) => at(100, t < 60 ? 80 : undefined), 200);
    expect(lost.r).toMatch(/Probe reading lost/);
    expect(lost.t).toBe(70);
    expect(runSnap(() => at(100, undefined), 200).r).toBeUndefined();
    // Implausible values count as lost.
    expect(runSnap((t) => at(100, t < 60 ? 80 : -273), 200).r).toMatch(/reads -273/);
  });

  it('learns the steady gap at setpoint and trips when it grows (boiling dry)', () => {
    // Holds 120 °C with plate at 132 (gap 12). From t=600 the probe stalls and the plate climbs 0.1 °C/s.
    const plate = (t: number) => (t < 600 ? 132 : Math.min(149, 132 + (t - 600) * 0.1));
    const hit = runSnap((t) => at(plate(t), 120), 1500);
    expect(hit.r).toMatch(/gap grew to .* held the setpoint at 12 °C/);
    expect(il.describe!(at(132, 120), defaults, hit.mem)).toMatch(/steady gap 12 °C/);
  });

  it('a probe hanging in warm air (slow rise) fails the gap-scaled response check', () => {
    // Plate climbs to 250 °C; the probe creeps up 0.3 °C/min. Old fixed 1 °C/5 min check would pass.
    const hit = runSnap((t) => at(Math.min(240, 22 + t * 0.25), 40 + (t / 60) * 0.3, 200), 1800, { ...defaults, plateMax: 340, plateAbove: 200 });
    expect(hit.r).toMatch(/Probe rose only/);
  });
});

describe('HOT state and solvent list', () => {
  it('shows HOT while the plate is ≥ 50 °C, MAY BE HOT after a disconnect, nothing when cool', async () => {
    const dev = new DeviceInstance('hp', retControlVisc, 'Hotplate', '#000', retControlVisc.simulate(), 100);
    await dev.connect();
    await dev.raw('SIM_PIN 2 30');
    await wait(300);
    expect(dev.hotState).toBeUndefined();
    await dev.raw('SIM_PIN 2 120');
    await wait(300);
    expect(dev.hotState?.state).toBe('hot');
    await dev.disconnect(false);
    expect(dev.hotState?.state).toBe('maybe');
    expect(dev.hotState?.v).toBe(120);
  });

  it('flags solvents the plate may reach with the current settings', async () => {
    const { solventCaution } = await import('../devices/solvents');
    const s: DeviceSnapshot = { values: { plate: 40 }, gross: {}, setpoints: { temp: 150 }, switches: {} };
    const ref = solventCaution.reference(s, () => defaults);
    expect(ref.value).toBe(180); // setpoint 150 + 30
    const flagged = solventCaution.items.filter((i) => i.value <= ref.value).map((i) => i.name);
    expect(flagged).toEqual(['Carbon disulfide', 'Diethyl ether', 'Acetaldehyde', '1,4-Dioxane']);
  });
});
