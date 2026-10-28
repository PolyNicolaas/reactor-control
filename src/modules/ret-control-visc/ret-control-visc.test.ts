import { describe, expect, it } from 'vitest';
import { DeviceInstance } from '../../core/device';
import { savedSafety } from '../../core/app';
import { defaultsOf, peer, runSafety, snap } from '../shared/testing';
import { eurostar60 } from '../eurostar-60-control/module';
import { retControlVisc } from './module';
import { retSafety } from './safety';
import { solventCaution } from './solvents';

// Tests for the RET module. The safety rules are tested on made-up timelines (runSafety: one poll per
// second, no waiting); the last blocks run the module against its simulator like the app does.

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ret = (plate: number, probe: number | undefined, sp = 50, heater = true) => snap({ plate, probe }, { temp: sp }, { heater, stirrer: false });

describe('RET safety: static rules', () => {
  it('Plate maximum trips at once above 250 °C', () => {
    const hit = runSafety(retSafety, () => ret(260, 250, 240), 0);
    expect(hit.rule).toBe('plateMax');
    expect(hit.text).toMatch(/above the 250 °C maximum/);
  });

  it('probe out of the medium: Plate above setpoint trips 30 °C past the setpoint', () => {
    // Probe stays at 22 °C; plate climbs 15 °C/min from 22 °C.
    const hit = runSafety(retSafety, (t) => ret(22 + t * 0.25, 22, 50), 900, { only: ['plateAbove'] });
    expect(hit.text).toMatch(/more than 30 °C above the 50 °C setpoint/);
    expect(22 + hit.t * 0.25).toBeGreaterThan(80);
    expect(22 + hit.t * 0.25).toBeLessThan(82);
  });

  it('lowering the setpoint while the plate is hot does not trip (plate cooling)', () => {
    const hit = runSafety(retSafety, (t) => ret(170 - t * 0.1, 150 - t * 0.05, 50), 600, { off: ['probeResponse'] });
    expect(hit.rule).toBeUndefined();
  });
});

describe('RET safety: dynamic rules', () => {
  it('normal heat-up with the probe in the medium trips nothing, and learns the steady gap', () => {
    const plate = (t: number) => Math.min(130, 22 + t * 0.25);
    const probe = (t: number) => Math.min(120, 22 + Math.max(0, t - 60) * 0.25);
    const hit = runSafety(retSafety, (t) => ret(plate(t), probe(t), 120), 3600);
    expect(hit.rule).toBeUndefined();
    expect(hit.statuses.steadyGap.text).toMatch(/learned 10 °C/);
  });

  it('Probe responds catches a flat probe long before setpoint + 30 at a high setpoint', () => {
    const hit = runSafety(retSafety, (t) => ret(Math.min(340, 22 + t * 0.25), 22, 200), 1800);
    expect(hit.rule).toBe('probeResponse');
    expect(22 + hit.t * 0.25).toBeLessThan(200);
  });

  it('Probe responds: a probe in warm air (slow rise) fails the gap-scaled check', () => {
    const hit = runSafety(retSafety, (t) => ret(Math.min(240, 22 + t * 0.25), 40 + (t / 60) * 0.3, 200), 1800, { set: { plateMax: 340, plateAbove: 200 } });
    expect(hit.rule).toBe('probeResponse');
  });

  it('Probe responds ignores a cooling plate with the heater off', () => {
    const hit = runSafety(retSafety, (t) => ret(130 - t * 0.02, 80 - t * 0.01, 100, false), 900, { set: { plateAbove: 100 } });
    expect(hit.rule).toBeUndefined();
  });

  it('Probe drop: probe pulled out mid-run trips within seconds', () => {
    const hit = runSafety(retSafety, (t) => ret(135, t < 300 ? 120 : Math.max(25, 120 - (t - 300) * 0.5), 120), 600);
    expect(hit.rule).toBe('probeDrop');
    expect(hit.t).toBeLessThan(330);
  });

  it('Probe drop: lowering the setpoint is not a drop', () => {
    const hit = runSafety(retSafety, (t) => ret(Math.max(60, 135 - t * 0.2), Math.max(55, 120 - t * 0.2), t < 10 ? 120 : 50), 600, { off: ['steadyGap'] });
    expect(hit.rule).toBeUndefined();
  });

  it('Probe present: a lost probe trips after 10 s of heating; plate-only use never trips', () => {
    const lost = runSafety(retSafety, (t) => ret(100, t < 60 ? 80 : undefined, 120), 200);
    expect(lost.rule).toBe('probeLost');
    expect(lost.t).toBe(70);
    expect(runSafety(retSafety, () => ret(100, undefined, 120), 200).rule).toBeUndefined();
    expect(runSafety(retSafety, (t) => ret(100, t < 60 ? 80 : -273, 120), 200).text).toMatch(/reads -273/);
  });

  it('Steady gap: learns at setpoint, trips when the gap grows (boiling dry)', () => {
    const plate = (t: number) => (t < 600 ? 132 : Math.min(149, 132 + (t - 600) * 0.1));
    const hit = runSafety(retSafety, (t) => ret(plate(t), 120, 120), 1500);
    expect(hit.rule).toBe('steadyGap');
    expect(hit.text).toMatch(/held the setpoint at 12 °C/);
  });

  it('Plate reading: a lost plate reading with the heater on trips after 10 s; heater off never trips', () => {
    const lost = runSafety(retSafety, (t) => snap({ plate: t < 60 ? 100 : undefined, probe: 40 }, { temp: 120 }, { heater: true }), 200);
    expect(lost.rule).toBe('plateLost');
    expect(lost.t).toBe(70);
    const off = runSafety(retSafety, (t) => snap({ plate: t < 60 ? 100 : undefined, probe: 40 }, { temp: 120 }, { heater: false }), 200);
    expect(off.rule).toBeUndefined();
  });

  it('one failed setpoint read does not blind Probe drop or make Steady gap relearn', () => {
    // Probe pulled out at 300 s, one IN_SP_1 timeout at 290 s: still trips within seconds.
    const drop = runSafety(retSafety, (t) => snap({ plate: 135, probe: t < 300 ? 120 : Math.max(25, 120 - (t - 300) * 0.5) }, { temp: t === 290 ? undefined : 120 }, { heater: true }), 600);
    expect(drop.rule).toBe('probeDrop');
    expect(drop.t).toBeLessThan(330);
    // Boiling dry, with one failed setpoint read at 700 s: trips as early as without it.
    const plate = (t: number) => (t < 600 ? 132 : Math.min(149, 132 + (t - 600) * 0.1));
    const clean = runSafety(retSafety, (t) => ret(plate(t), 120, 120), 1500);
    const gappy = runSafety(retSafety, (t) => snap({ plate: plate(t), probe: 120 }, { temp: t === 700 ? undefined : 120 }, { heater: true }), 1500);
    expect(gappy.rule).toBe('steadyGap');
    expect(gappy.t).toBe(clean.t);
  });

  it('Steady gap still learns when polls are 3 s apart', () => {
    const slow = (t: number) => (t % 3 === 0 ? ret(132, 120, 120) : snap({}, {}, { heater: true }));
    const r = runSafety(retSafety, slow, 399, { only: ['steadyGap'] }); // ends on a poll
    expect(r.statuses.steadyGap.text).toMatch(/learned 12 °C/);
  });

  it('every rule reports a live status line', () => {
    const r = runSafety(retSafety, () => ret(60, 55, 60), 10);
    for (const rule of retSafety.rules) expect(r.statuses[rule.key]?.text, rule.key).toBeTruthy();
  });
});

describe('RET safety: rule that watches another module (overhead stirrer)', () => {
  const stirrer = (stirring: boolean, live = true) => [peer({ id: 'st', label: 'Stirrer', provides: ['stirrer', 'overhead-stirrer'], live, active: { stirring } })];

  it('is idle with no overhead stirrer on the page', () => {
    const r = runSafety(retSafety, () => ret(60, 50, 60), 30, { only: ['stirringLost'] });
    expect(r.statuses.stirringLost.state).toBe('idle');
  });

  it('heater off 5 s after the stirrer stops while heating', () => {
    const hit = runSafety(retSafety, () => ret(70, 55, 60), 200, { only: ['stirringLost'], peers: (t) => stirrer(t < 100) });
    expect(hit.rule).toBe('stirringLost');
    expect(hit.t).toBe(105);
    expect(hit.text).toMatch(/Stirrer stopped while heating/);
  });

  it('heater off when the stirrer stops answering', () => {
    const hit = runSafety(retSafety, () => ret(70, 55, 60), 200, { only: ['stirringLost'], peers: (t) => stirrer(t < 100, t < 100) });
    expect(hit.text).toMatch(/not answering/);
  });

  it('heating before the stirrer ever ran only warns', () => {
    const r = runSafety(retSafety, () => ret(70, 55, 60), 60, { only: ['stirringLost'], peers: () => stirrer(false) });
    expect(r.rule).toBeUndefined();
    expect(r.statuses.stirringLost.state).toBe('near');
  });

  it('a magnetic-only stirrer does not arm it (it watches "overhead-stirrer")', () => {
    const r = runSafety(retSafety, () => ret(70, 55, 60), 60, { only: ['stirringLost'], peers: () => [peer({ provides: ['stirrer'] })] });
    expect(r.statuses.stirringLost.text).toBe('no peer');
  });
});

describe('RET against its simulator', () => {
  it('a trip switches the heater off, locks it out, and resets only once safe', async () => {
    const dev = new DeviceInstance('hp', retControlVisc, 'Hotplate', '#000', retControlVisc.simulate(), 100);
    await dev.connect();
    await dev.setSwitch('heater', true);
    const trips: string[] = [];
    dev.tripped$.on((t) => trips.push(t));
    await dev.raw('SIM_PIN 2 300');
    await wait(500);
    expect(dev.tripped.plateMax).toMatch(/300 °C is above the 250 °C maximum/);
    expect(dev.snapshot.switches.heater).toBe(false);
    expect(dev.status).toBe('Safety stop');
    expect(dev.ruleStatus.plateMax.state).toBe('trip');
    expect(trips).toHaveLength(1);
    await expect(dev.setSwitch('heater', true)).rejects.toThrow(/locked out/);
    expect(() => dev.resetSafety()).toThrow(/Cannot reset yet/);
    await dev.raw('SIM_PIN 2 40');
    await wait(400);
    dev.resetSafety();
    await dev.setSwitch('heater', true);
    expect(dev.snapshot.switches.heater).toBe(true);
    await dev.disconnect(true);
  });

  it('arms the stirring rule when a stirrer joins the page, and logs it', async () => {
    const hp = new DeviceInstance('hp', retControlVisc, 'Hotplate', '#000', retControlVisc.simulate(), 100);
    const st = new DeviceInstance('st', eurostar60, 'Stirrer', '#000', eurostar60.simulate(), 100);
    const page = [hp];
    hp.peers = () => page;
    const log: string[] = [];
    hp.events.on((e) => e.kind === 'info' && log.push(e.text));
    await hp.connect();
    await wait(300);
    expect(hp.ruleStatus.stirringLost.state).toBe('idle');
    page.push(st);
    await st.connect();
    await wait(300);
    expect(log.some((l) => /"Overhead stirring" armed \(with Stirrer\)/.test(l))).toBe(true);
    expect(hp.ruleStatus.stirringLost.text).toMatch(/watching Stirrer/);
    page.pop();
    await wait(300);
    expect(log.some((l) => /disarmed/.test(l))).toBe(true);
    await hp.disconnect(true);
    await st.disconnect(true);
  });

  it('HOT from 50 °C, MAY BE HOT after a disconnect', async () => {
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
  });

  it('settings: user values override defaults; pages saved before the rename keep theirs', () => {
    const dev = new DeviceInstance('hp', retControlVisc, 'Hotplate', '#000', retControlVisc.simulate(), 100);
    dev.safetySettings.plateMax = 320;
    expect(dev.safetyValues().plateMax).toBe(320);
    expect(dev.safetyValues().plateAbove).toBe(30);
    expect(savedSafety({ id: 'x', model: 'retControlVisc', label: '', color: '', sim: true, interlocks: { 'plate.plateAbove': 45 } })).toEqual({ plateAbove: 45 });
  });
});

describe('RET solvent list', () => {
  it('flags solvents the plate may reach with the current settings', () => {
    const ref = solventCaution.reference(snap({ plate: 40 }, { temp: 150 }), defaultsOf(retSafety));
    expect(ref.value).toBe(180); // setpoint 150 + 30
    const flagged = solventCaution.items.filter((i) => i.value <= ref.value).map((i) => i.name);
    expect(flagged).toEqual(['Carbon disulfide', 'Diethyl ether', 'Acetaldehyde', '1,4-Dioxane']);
  });
});

describe('RET safety: turning rules on and off', () => {
  it('required rules cannot be turned off; a tripped rule must be reset first; choices are kept', async () => {
    const dev = new DeviceInstance('hp', retControlVisc, 'Hotplate', '#000', retControlVisc.simulate(), 100);
    expect(() => dev.setRuleOn('plateMax', false)).toThrow(/cannot be turned off/);
    dev.setRuleOn('probeDrop', false);
    expect(dev.isRuleOn(retSafety.rules.find((r) => r.key === 'probeDrop')!)).toBe(false);
    expect(dev.rulesOn).toEqual({ probeDrop: false });
    dev.setRuleOn('probeDrop', true);
    expect(dev.rulesOn).toEqual({}); // back to its default: nothing to save
    await dev.connect();
    await dev.raw('SIM_PIN 2 300');
    await wait(400);
    expect(() => dev.setRuleOn('plateAbove', false)).toThrow(/cannot be turned off/);
    await dev.disconnect(true);
  });

  it('a rule turned off reports Off and never trips', async () => {
    const dev = new DeviceInstance('hp', retControlVisc, 'Hotplate', '#000', retControlVisc.simulate(), 100);
    dev.setRuleOn('probeLost', false);
    await dev.connect();
    await wait(300);
    expect(dev.ruleStatus.probeLost).toEqual({ state: 'off', text: 'Turned off' });
    await dev.disconnect(true);
  });

  it('settings are clamped to their range and saved only when not the default', () => {
    const dev = new DeviceInstance('hp', retControlVisc, 'Hotplate', '#000', retControlVisc.simulate(), 100);
    expect(dev.setSafetySetting('plateAbove', 999)).toBe(200);
    expect(dev.setSafetySetting('plateAbove', 30)).toBe(30);
    expect(dev.safetySettings.plateAbove).toBeUndefined();
  });
});

describe('Watched by', () => {
  it('the stirrer card lists the hotplate rule that watches it, and warns before Motor off while it is active', async () => {
    const hp = new DeviceInstance('hp', retControlVisc, 'Hotplate', '#000', retControlVisc.simulate(), 100);
    const st = new DeviceInstance('st', eurostar60, 'Stirrer', '#000', eurostar60.simulate(), 100);
    const page = [hp, st];
    hp.peers = st.peers = () => page;
    const w = st.watchedBy();
    expect(w.map((x) => `${x.dev.label} › ${x.rule.label}`)).toEqual(['Hotplate › Overhead stirring']);
    expect(w[0].note).toBe('Stopping stirring for 5 s while the hotplate heats turns its heater off.');
    hp.setSafetySetting('stirLostS', 12);
    expect(st.watchedBy()[0].note).toMatch(/for 12 s/);
    // Not heating: the rule is on standby, so Motor off triggers nothing.
    hp.ruleStatus.stirringLost = { state: 'idle', text: 'Not heating' };
    expect(st.watchersOfSwitch('motor')).toEqual([]);
    // Heating and stirring: Motor off would trip it.
    hp.ruleStatus.stirringLost = { state: 'ok', text: 'Stirrer stirring' };
    expect(st.watchersOfSwitch('motor').map((x) => x.rule.key)).toEqual(['stirringLost']);
    // The hotplate's own switches are not watched by anything here.
    expect(hp.watchersOfSwitch('heater')).toEqual([]);
  });
});
