import { describe, expect, it } from 'vitest';
import { DeviceInstance } from '../core/device';
import { eurostar60 } from '../devices/eurostar60';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('changes the unit shows by itself (camera triggers)', () => {
  it('reports stirring starting and stopping from the speed reading', async () => {
    const dev = new DeviceInstance('st', eurostar60, 'Stirrer', '#000', eurostar60.simulate(), 100);
    const seen: string[] = [];
    dev.changes.on((t) => { seen.push(t); });
    await dev.connect();
    await wait(300);
    await dev.setSwitch('motor', true);
    await wait(2500);
    expect(seen.some((t) => t.startsWith('stirring started'))).toBe(true);
    await dev.setSwitch('motor', false);
    await wait(6000);
    expect(seen.some((t) => t.startsWith('stirring stopped'))).toBe(true);
    await dev.disconnect(false);
  }, 15_000);

  it('reports a setpoint changed outside the card, but not its own writes', { timeout: 10_000 }, async () => {
    const dev = new DeviceInstance('st', eurostar60, 'Stirrer', '#000', eurostar60.simulate(), 100);
    const seen: string[] = [];
    dev.changes.on((t) => { seen.push(t); });
    await dev.connect();
    await wait(300);
    await dev.setSetpoint('speed', 450);
    await wait(3500);
    expect(seen).toEqual([]);
    await dev.raw('OUT_SP_4 700'); // as if changed on the unit
    await wait(500);
    expect(seen).toContain('speed setpoint changed on the unit: 450 → 700 rpm');
    await dev.disconnect(false);
  });
});
