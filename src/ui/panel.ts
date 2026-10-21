import type { App } from '../core/app';
import type { DeviceInstance } from '../core/device';
import { decimalsFor, fmt, h, openDialog, toast } from './dom';
import { openTerminal } from './terminal';

/** One generic panel, drawn entirely from the device's driver description. */
export function devicePanel(app: App, dev: DeviceInstance, onReconnect: (dev: DeviceInstance) => void): { el: HTMLElement; update: () => void; handle: HTMLElement } {
  const d = dev.driver;
  const statusEl = h('span', { class: 'status' });
  const titleEl = h('span', { class: 'dev-label' }, dev.label);
  const valueEls: Record<string, HTMLElement> = {};
  const spReadEls: Record<string, HTMLElement> = {};
  const spInputs: Record<string, HTMLInputElement> = {};
  const swEls: Record<string, HTMLButtonElement> = {};

  const menu = h(
    'details',
    { class: 'menu' },
    h('summary', { 'aria-label': 'Device menu' }, '⋯'),
    h(
      'div',
      { class: 'menu-items' },
      h('button', { onclick: () => { menu.open = false; app.moveDevice(dev, app.devices.indexOf(dev) - 1); } }, 'Move up'),
      h('button', { onclick: () => { menu.open = false; app.moveDevice(dev, app.devices.indexOf(dev) + 1); } }, 'Move down'),
      h('button', { onclick: () => rename() }, 'Rename'),
      h('button', { onclick: () => editLimits() }, 'Limits'),
      h('button', { onclick: () => openTerminal(app, dev) }, 'Bench terminal'),
      h('button', { class: 'danger-text', onclick: () => remove() }, 'Remove from page'),
    ),
  );

  // Close the menu after any choice, and when clicking anywhere else.
  menu.querySelector('.menu-items')!.addEventListener('click', () => (menu.open = false));
  document.addEventListener('click', (e) => {
    if (menu.open && !menu.contains(e.target as Node)) menu.open = false;
  });

  const tiles = h(
    'div',
    { class: 'tiles' },
    ...d.readings.map((r) => {
      const v = h('span', { class: 'tile-value' }, '—');
      valueEls[r.key] = v;
      return h('div', { class: `tile${r.primary ? ' primary' : ''}` }, h('span', { class: 'tile-label' }, `${r.label} (${r.unit})`), v);
    }),
  );

  const setpointRows = d.setpoints.map((sp) => {
    const input = h('input', {
      type: 'number', inputmode: 'decimal', min: sp.min, max: sp.max, step: sp.step,
      'aria-label': `${sp.label} setpoint (${sp.unit})`,
    }) as HTMLInputElement;
    spInputs[sp.key] = input;
    const read = h('span', { class: 'sp-read' });
    spReadEls[sp.key] = read;
    const apply = async () => {
      const value = Number(input.value);
      try {
        dev.checkSetpoint(sp.key, value);
        const current = dev.snapshot.setpoints[sp.key];
        if (sp.unit === '°C' && current !== undefined && value - current > 50 && !confirm(`Raise ${sp.label.toLowerCase()} from ${current} to ${value} ${sp.unit}?`)) return;
        await dev.setSetpoint(sp.key, value);
        app.note(`${dev.label}: ${sp.label.toLowerCase()} set to ${value} ${sp.unit}`);
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && apply());
    return h(
      'div',
      { class: 'sp-row' },
      h('label', {}, sp.label),
      h('div', { class: 'sp-input' }, input, h('span', { class: 'unit' }, sp.unit), h('button', { onclick: apply }, 'Apply')),
      read,
    );
  });

  const switchRow = h(
    'div',
    { class: 'switches' },
    ...d.switches.map((sw) => {
      const b = h('button', { class: 'switch', 'aria-pressed': 'false' }, sw.label) as HTMLButtonElement;
      b.addEventListener('click', async () => {
        const on = !dev.snapshot.switches[sw.key];
        if (on && sw.confirmOn && !confirm(sw.confirmOn)) return;
        try {
          await dev.setSwitch(sw.key, on);
          app.note(`${dev.label}: ${sw.label.toLowerCase()} ${on ? 'on' : 'off'}`);
        } catch (e) {
          toast((e as Error).message, 'error');
        }
      });
      swEls[sw.key] = b;
      return b;
    }),
  );

  const reconnectBtn = h('button', { class: 'primary', onclick: () => onReconnect(dev) }, 'Reconnect');
  const offline = h('div', { class: 'offline' }, h('p', {}, 'Not connected. Nothing is sent to this unit.'), reconnectBtn);

  const handle = h('button', { class: 'handle', 'aria-label': `Drag to reorder ${dev.label}`, title: 'Drag to reorder' }, '⠿');
  const el = h(
    'section',
    { class: 'panel', style: `--dev:${dev.color}`, 'data-id': dev.id },
    h(
      'header',
      {},
      handle,
      h('div', { class: 'dev-title' }, titleEl, h('span', { class: 'dev-model' }, `${d.displayName}${dev.transport.kind === 'sim' ? ' · simulated' : ''}`)),
      statusEl,
      menu,
    ),
    tiles,
    h('div', { class: 'setpoints' }, ...setpointRows),
    switchRow,
    offline,
  );

  function update() {
    const st = dev.status;
    statusEl.textContent = st;
    statusEl.dataset.state = st.toLowerCase().replace(/\s+/g, '-');
    titleEl.textContent = dev.label;
    el.classList.toggle('is-offline', !dev.connected);
    for (const r of d.readings) valueEls[r.key].textContent = fmt(dev.snapshot.values[r.key], decimalsFor(r.unit));
    for (const sp of d.setpoints) {
      const rb = dev.snapshot.setpoints[sp.key];
      const pend = dev.pending[sp.key];
      const readEl = spReadEls[sp.key];
      if (pend !== undefined) {
        readEl.textContent = `Sending ${fmt(pend, sp.decimals)}…`;
        readEl.dataset.state = 'pending';
      } else {
        readEl.textContent = rb === undefined ? 'Device: —' : `Device: ${fmt(rb, sp.decimals)} ${sp.unit} ✓`;
        readEl.dataset.state = 'ok';
      }
      const input = spInputs[sp.key];
      if (input.value === '' && document.activeElement !== input && rb !== undefined) input.value = String(rb);
    }
    for (const sw of d.switches) {
      const on = dev.snapshot.switches[sw.key];
      swEls[sw.key].setAttribute('aria-pressed', String(on));
      swEls[sw.key].textContent = `${sw.label}: ${on ? 'ON' : 'OFF'}`;
    }
  }

  async function rename() {
    menu.open = false;
    const name = prompt('Name for this unit', dev.label);
    if (name && name.trim()) {
      dev.label = name.trim();
      app.save();
      update();
    }
  }

  async function editLimits() {
    menu.open = false;
    await openDialog(`Limits — ${dev.label}`, (close) => {
      const inputs = d.setpoints.map((sp) => {
        const i = h('input', { type: 'number', min: sp.min, max: sp.max, step: sp.step, value: dev.limits[sp.key] ?? '' }) as HTMLInputElement;
        return { sp, i };
      });
      return h(
        'form',
        {
          class: 'form',
          onsubmit: (e: Event) => {
            e.preventDefault();
            for (const { sp, i } of inputs) dev.limits[sp.key] = i.value === '' ? undefined : Math.min(Number(i.value), sp.max);
            app.save();
            close(true);
          },
        },
        h('p', { class: 'hint' }, 'Setpoints above your limit are refused. Leave empty to use the device maximum.'),
        ...inputs.map(({ sp, i }) => h('label', {}, `Max ${sp.label.toLowerCase()} (${sp.unit}, device max ${sp.max})`, i)),
        h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'submit' }, 'Save')),
      );
    });
  }

  async function remove() {
    menu.open = false;
    const msg = app.run
      ? `Remove ${dev.label} during a recording? Its data so far stays in the run. The unit is released to local control (${d.releaseCommand ?? 'no command'}).`
      : `Remove ${dev.label} from this page? The unit is released to local control (${d.releaseCommand ?? 'no command'}).`;
    if (!confirm(msg)) return;
    await app.removeDevice(dev);
  }

  update();
  return { el, update, handle };
}
