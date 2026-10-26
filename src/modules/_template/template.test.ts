import { describe, expect, it } from 'vitest';
import { DeviceInstance } from '../../core/device';
import { peer, runSafety, snap } from '../shared/testing';
import { templateModule } from './module';
import { templateSafety } from './safety';

// TEMPLATE tests. Keep both kinds for a new module:
// 1. the module against its simulator, the way the app uses it;
// 2. every safety rule on made-up timelines — one case where it must trip, one where it must not.

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('template module against its simulator', () => {
  it('connects, identifies, and confirms a setpoint by read-back', async () => {
    const dev = new DeviceInstance('x', templateModule, 'Block', '#000', templateModule.simulate(), 100);
    expect(await dev.connect()).toBe('EXAMPLE BLOCK');
    await dev.setSetpoint('temp', 80);
    await wait(300);
    expect(dev.snapshot.setpoints.temp).toBe(80);
    await dev.disconnect(true);
  });
});

describe('template safety rules', () => {
  it('Block maximum trips above the limit, not below', () => {
    expect(runSafety(templateSafety, () => snap({ temp: 120 }, {}, { heater: true }), 5).rule).toBeUndefined();
    expect(runSafety(templateSafety, () => snap({ temp: 160 }, {}, { heater: true }), 5).rule).toBe('overTemp');
  });

  it('Heat only while stirring is idle without a stirrer, trips when the stirrer stops', () => {
    const heating = () => snap({ temp: 60 }, {}, { heater: true });
    expect(runSafety(templateSafety, heating, 5).statuses.stirring.text).toBe('no peer');
    const hit = runSafety(templateSafety, heating, 30, { peers: (t) => [peer({ provides: ['stirrer'], active: { stirring: t < 10 } })] });
    expect(hit.rule).toBe('stirring');
    expect(hit.t).toBe(10);
  });
});
