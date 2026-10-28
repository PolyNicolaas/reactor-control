import { describe, expect, it } from 'vitest';
import { peer, runSafety, snap } from '../shared/testing';
import { regloSafety } from './safety';
import { DeviceInstance } from '../../core/device';
import { parseVolumeType1, regloIcc, volumeType2 } from './module';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Reglo ICC number formats (manual p. 19, 28)', () => {
  it('writes Volume Type 2 like the manual examples', () => {
    expect(volumeType2(0.0013)).toBe('1300-3');
    expect(volumeType2(300)).toBe('3000+2');
    expect(volumeType2(5)).toBe('5000+0');
  });
  it('reads Volume Type 1', () => {
    expect(parseVolumeType1('3250E+1')).toBe(32.5);
    expect(parseVolumeType1('1300E-3')).toBeCloseTo(0.0013);
    expect(parseVolumeType1('12.30')).toBeUndefined();
  });
  it('parses status and data replies', () => {
    expect(regloIcc.parse!('+')).toBe(1);
    expect(regloIcc.parse!('-')).toBe(0);
    expect(regloIcc.parse!('3.17 mm')).toBe(3.17);
  });
});

describe('Reglo ICC driver against the simulator', () => {
  const connect = async () => {
    const dev = new DeviceInstance('pump', regloIcc, 'Pump', '#000', regloIcc.simulate(), 100);
    const sent: string[] = [];
    dev.events.on((e) => e.kind === 'tx' && !dev.isPollCommand(e.text) && sent.push(e.text));
    const name = await dev.connect();
    return { dev, sent, name };
  };

  it('identifies, turns on channel addressing first and sets flow mode', async () => {
    const { dev, sent, name } = await connect();
    expect(name).toMatch(/REGLO/);
    expect(sent.slice(0, 2)).toEqual(['1~1', '1xE0']);
    expect(sent).toContain('4M');
    await dev.disconnect(false);
  });

  it('sets a flow, runs a channel and integrates dispensed volume', async () => {
    const { dev } = await connect();
    await dev.setSetpoint('flow1', 6);
    await dev.setSwitch('run1', true);
    await wait(700);
    expect(dev.snapshot.values.flow1).toBe(6);
    expect(dev.snapshot.values.flow2).toBe(0);
    expect(dev.snapshot.values.dispensed1).toBeGreaterThan(0);
    expect(dev.pending.flow1).toBeUndefined();
    expect(dev.status).toBe('Pumping');
    await dev.disconnect(true);
  });

  it('reports a refused start (flow above what the tubing allows)', async () => {
    const { dev } = await connect();
    await dev.setSetpoint('flow2', 5); // sim ch2 tubing 0.76 mm, max 3.6 mL/min
    await expect(dev.setSwitch('run2', true)).rejects.toThrow(/can't run "2H"/);
    expect(dev.snapshot.switches.run2).toBe(false);
    await dev.disconnect(false);
  });

  it('notices when the pump stops on its own', async () => {
    const { dev } = await connect();
    await dev.setSetpoint('flow1', 1);
    await dev.setSwitch('run1', true);
    await dev.raw('1I'); // as if Run/Stop was pressed on the pump
    await wait(600);
    expect(dev.snapshot.switches.run1).toBe(false);
    await dev.disconnect(false);
  });

  it('stops every channel and hands back the keypad when removed', async () => {
    const { dev, sent } = await connect();
    await dev.disconnect(true);
    expect(sent.slice(-5)).toEqual(['1I', '2I', '3I', '4I', '1A']);
  });
});

describe('Reglo safety', () => {
  const pump = (dispensed: number, run = true) => snap({ dispensed1: dispensed }, {}, { run1: run });

  it('every channel has its own volume limit: trips its own channel at its maximum, not below', () => {
    for (const n of [1, 2, 3, 4]) {
      const ch = (v: number) => snap({ [`dispensed${n}`]: v }, {}, { [`run${n}`]: true });
      const hit = runSafety(regloSafety, (t) => ch(t * 0.1), 200, { on: [`volume${n}`], set: { [`volumeMax${n}`]: 5 } });
      expect(hit.rule, `ch ${n}`).toBe(`volume${n}`);
      expect(hit.t, `ch ${n}`).toBe(50);
      expect(regloSafety.rules.find((r) => r.key === `volume${n}`)!.switches).toEqual([`run${n}`]);
      expect(runSafety(regloSafety, (t) => ch(Math.min(4.9, t * 0.1)), 200, { on: [`volume${n}`], set: { [`volumeMax${n}`]: 5 } }).rule, `ch ${n}`).toBeUndefined();
    }
  });

  it('a volume-limit trip can be reset: the reset starts the count again', async () => {
    const dev = new DeviceInstance('p', regloIcc, 'Pump', '#000', regloIcc.simulate(), 100);
    await dev.connect();
    dev.setRuleOn('volume1', true);
    dev.setSafetySetting('volumeMax1', 0.5);
    dev.snapshot.values.dispensed1 = 0.6;
    await wait(300);
    expect(dev.tripped.volume1).toBeTruthy();
    dev.resetSafety();
    expect(dev.tripped.volume1).toBeUndefined();
    expect(dev.snapshot.values.dispensed1).toBeLessThan(0.5);
    await dev.disconnect(true);
  });

  it('Dose only while stirring: keeps dosing while something stirs; a start on the pump keypad counts as dosing', () => {
    const stirrer = (stirring: boolean) => [peer({ label: 'Stirrer', provides: ['stirrer', 'overhead-stirrer'], active: { stirring } })];
    expect(runSafety(regloSafety, () => pump(1), 100, { peers: () => stirrer(true) }).rule).toBeUndefined();
    const keypad = () => snap({ dispensed1: 0, running: 1 }, {}, { run1: false });
    const hit = runSafety(regloSafety, keypad, 100, { peers: (t) => stirrer(t < 20) });
    expect(hit.rule).toBe('noStirring');
    expect(hit.t).toBe(25);
    expect(runSafety(regloSafety, () => snap({ running: 0 }, {}, { run1: false }), 100, { peers: () => stirrer(false) }).rule).toBeUndefined();
  });

  it('volume limit stops the channel at its maximum (off by default)', () => {
    expect(runSafety(regloSafety, (t) => pump(t * 0.1), 100).statuses.volume1.state).toBe('off');
    const hit = runSafety(regloSafety, (t) => pump(t * 0.1), 200, { on: ['volume1'], set: { volumeMax1: 5 } });
    expect(hit.rule).toBe('volume1');
    expect(hit.t).toBe(50);
  });

  it('dosing stops 5 s after nothing on the page is stirring; any "stirrer" counts', () => {
    const magnetic = (stirring: boolean) => [peer({ label: 'Hotplate', provides: ['stirrer', 'magnetic-stirrer'], active: { stirring } })];
    const hit = runSafety(regloSafety, () => pump(1), 100, { peers: (t) => magnetic(t < 30) });
    expect(hit.rule).toBe('noStirring');
    expect(hit.t).toBe(35);
    expect(runSafety(regloSafety, () => pump(1), 100).statuses.noStirring.text).toBe('no peer');
  });
});
