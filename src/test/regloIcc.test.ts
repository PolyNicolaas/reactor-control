import { describe, expect, it } from 'vitest';
import { DeviceInstance } from '../core/device';
import { parseVolumeType1, regloIcc, volumeType2 } from '../devices/regloIcc';

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
