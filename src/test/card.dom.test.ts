// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { App } from '../core/app';
import { drivers } from '../modules';
import { devicePanel } from '../ui/panel';

// Smoke test of the device card: every module's card renders, with its Safety section, and a
// cross-module rule arms when a partner joins the page.

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('device card', () => {
  it('every module draws a card with a Safety section listing its rules', async () => {
    const app = new App();
    for (const d of drivers) {
      const dev = await app.addDevice({ model: d.model, label: d.displayName, transport: d.simulate() });
      const card = devicePanel(app, dev, () => {});
      await wait(1300);
      card.update();
      const rows = card.el.querySelectorAll('.safety .rule');
      expect(rows.length, d.model).toBe(d.safety?.rules.length ?? 0);
      expect(card.el.querySelector('.safety > summary')?.textContent, d.model).toMatch(/Safety/);
      for (const r of rows) expect(r.querySelector('.rule-text')?.textContent, d.model).not.toBe('');
    }
    for (const dev of [...app.devices]) await app.removeDevice(dev);
  });

  it('the RET card shows its stirring rule armed once an overhead stirrer is on the page', async () => {
    const app = new App();
    const hp = await app.addDevice({ model: 'retControlVisc', label: 'Hotplate', transport: drivers.find((d) => d.model === 'retControlVisc')!.simulate() });
    const card = devicePanel(app, hp, () => {});
    await wait(1300);
    card.update();
    const row = () => card.el.querySelector<HTMLElement>('.rule:last-child')!;
    expect(row().dataset.state).toBe('idle');
    expect(row().textContent).toMatch(/Armed when a module that provides "overhead-stirrer" is on this page/);
    await app.addDevice({ model: 'eurostar60', label: 'Stirrer', transport: drivers.find((d) => d.model === 'eurostar60')!.simulate() });
    await wait(1300); // the hotplate polls once a second
    card.update();
    expect(row().textContent).toMatch(/watching Stirrer/);
    for (const dev of [...app.devices]) await app.removeDevice(dev);
  });
});
