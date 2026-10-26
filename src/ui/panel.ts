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
  const tileEls: Record<string, HTMLElement> = {};
  const noteEls: Record<string, HTMLElement> = {};
  const tareBtns: Record<string, HTMLButtonElement> = {};
  const clearBtns: Record<string, HTMLButtonElement> = {};
  const spReadEls: Record<string, HTMLElement> = {};
  const spInputs: Record<string, HTMLInputElement> = {};
  const spApplyBtns: Record<string, HTMLButtonElement> = {};
  const swEls: Record<string, HTMLButtonElement> = {};
  const groupTitleEls: Record<string, HTMLElement> = {};
  const groupEls: Record<string, HTMLElement> = {};
  const grouped = !!d.groups?.length;

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
      grouped && h('button', { onclick: () => editGroupNames() }, 'Channel names'),
      h('button', { onclick: () => openTerminal(app, dev) }, 'Bench terminal'),
      h('button', { class: 'danger-text', onclick: () => remove() }, 'Remove from page'),
    ),
  );

  // Close the menu after any choice, and when clicking anywhere else.
  menu.querySelector('.menu-items')!.addEventListener('click', () => (menu.open = false));
  document.addEventListener('click', (e) => {
    if (menu.open && !menu.contains(e.target as Node)) menu.open = false;
  });

  const tileFor = (r: (typeof d.readings)[number]) => {
      const v = h('span', { class: 'tile-value' }, '—');
      valueEls[r.key] = v;
      const note = h('span', { class: 'tile-note' });
      noteEls[r.key] = note;
      let tools: HTMLElement | null = null;
      if (r.tareable) {
        const tare = h('button', { class: 'tare', type: 'button', title: `Zero the ${r.label.toLowerCase()} reading at its current value` }, 'Tare') as HTMLButtonElement;
        tare.addEventListener('click', () => {
          try {
            const g = dev.tare(r.key);
            app.note(`${dev.label}: ${r.label.toLowerCase()} tared at ${g} ${r.unit} gross`);
            toast(`${r.label} tared (${g} ${r.unit} on the plate)`);
          } catch (e) {
            toast((e as Error).message, 'error');
          }
        });
        const clear = h('button', { class: 'tare clear', type: 'button', title: 'Remove the tare and show the gross value' }, 'Clear') as HTMLButtonElement;
        clear.addEventListener('click', () => {
          dev.clearTare(r.key);
          app.note(`${dev.label}: ${r.label.toLowerCase()} tare cleared`);
        });
        tareBtns[r.key] = tare;
        clearBtns[r.key] = clear;
        tools = h('div', { class: 'tile-tools' }, tare, clear);
      }
      const tile = h('div', { class: `tile${r.primary ? ' primary' : ''}${r.tareable ? ' tareable' : ''}` }, h('span', { class: 'tile-label' }, r.unit === 'trend' ? r.label : `${r.label} (${r.unit})`), v, note, tools);
      tileEls[r.key] = tile;
      return tile;
  };
  const shownReadings = d.readings.filter((r) => !r.hidden);

  const spRowFor = (sp: (typeof d.setpoints)[number]) => {
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
        app.change(`${dev.label}: ${dev.specLabel(sp).toLowerCase()} set to ${value} ${sp.unit}`);
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && apply());
    return h(
      'div',
      { class: 'sp-row' },
      h('label', {}, sp.label),
      h('div', { class: 'sp-input' }, input, h('span', { class: 'unit' }, sp.unit), (spApplyBtns[sp.key] = h('button', { onclick: apply }, 'Apply') as HTMLButtonElement)),
      read,
    );
  };

  const switchFor = (sw: (typeof d.switches)[number]) => {
      const b = h('button', { class: 'switch', 'aria-pressed': 'false' }, sw.label) as HTMLButtonElement;
      b.addEventListener('click', async () => {
        const on = !dev.snapshot.switches[sw.key];
        if (on && sw.confirmOn && !confirm(sw.confirmOn)) return;
        try {
          await dev.setSwitch(sw.key, on);
          app.change(`${dev.label}: ${dev.specLabel(sw).toLowerCase()} ${on ? 'on' : 'off'}`);
        } catch (e) {
          toast((e as Error).message, 'error');
        }
      });
      swEls[sw.key] = b;
      return b;
  };

  // Interlock: an alarm banner while tripped, and one line saying what is enforced.
  const ilocks = d.interlocks ?? [];
  const alarmText = h('span', { class: 'alarm-text' });
  const resetBtn = h('button', { type: 'button' }, 'Reset interlock') as HTMLButtonElement;
  resetBtn.addEventListener('click', () => {
    try {
      for (const il of ilocks) dev.resetInterlock(il.key);
      app.change(`${dev.label}: interlock reset`);
      toast('Interlock reset. The heater can be switched on again.');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
    update();
  });
  const alarm = h('div', { class: 'alarm', role: 'alert', hidden: true }, h('strong', {}, 'Heater locked out'), alarmText, resetBtn);
  const guardLine = h('div', { class: 'guard-line' });
  dev.tripped$.on((text) => toast(`INTERLOCK — ${text}`, 'error'));

  // Devices with groups (pump channels) get one compact block per group; others get the
  // classic row: tiles | setpoints | switches.
  const body: (HTMLElement | false)[] = grouped
    ? [
        h(
          'div',
          { class: 'groups' },
          ...d.groups!.map((g) => {
            const title = h('span', { class: 'group-title' }, dev.groupLabel(g.key) ?? g.label);
            groupTitleEls[g.key] = title;
            const block = h(
              'div',
              { class: 'group' },
              h('div', { class: 'group-head' }, h('span', { class: 'dot' }), title),
              h('div', { class: 'tiles' }, ...shownReadings.filter((r) => r.group === g.key).map(tileFor)),
              ...d.setpoints.filter((sp) => sp.group === g.key).map(spRowFor),
              ...d.switches.filter((sw) => sw.group === g.key).map(switchFor),
            );
            groupEls[g.key] = block;
            return block;
          }),
        ),
        shownReadings.some((r) => !r.group) && h('div', { class: 'tiles' }, ...shownReadings.filter((r) => !r.group).map(tileFor)),
      ]
    : [
        h('div', { class: 'tiles' }, ...shownReadings.map(tileFor)),
        h('div', { class: 'setpoints' }, ...d.setpoints.map(spRowFor)),
        h('div', { class: 'switches' }, ...d.switches.map(switchFor)),
      ];
  if (ilocks.length) body.unshift(alarm), body.push(guardLine);

  const reconnectBtn = h('button', { class: 'primary', onclick: () => onReconnect(dev) }, 'Reconnect');
  const offline = h('div', { class: 'offline' }, h('p', {}, 'Not connected. Nothing is sent to this unit.'), reconnectBtn);

  const handle = h('button', { class: 'handle', 'aria-label': `Drag to reorder ${dev.label}`, title: 'Drag to reorder' }, '⠿');
  const el = h(
    'section',
    { class: `panel${grouped ? ' is-grouped' : ''}`, style: `--dev:${dev.color}`, 'data-id': dev.id },
    h(
      'header',
      {},
      handle,
      h('div', { class: 'dev-title' }, titleEl, h('span', { class: 'dev-model' }, `${d.displayName}${dev.transport.kind === 'sim' ? ' · simulated' : ''}`)),
      statusEl,
      menu,
    ),
    ...body,
    offline,
  );

  function update() {
    const st = dev.status;
    statusEl.textContent = st;
    statusEl.dataset.state = st.toLowerCase().replace(/\s+/g, '-');
    titleEl.textContent = dev.label;
    el.classList.toggle('is-offline', !dev.connected);
    for (const r of shownReadings) {
      const valid = dev.isValid(r.key);
      const dec = r.decimals ?? decimalsFor(r.unit);
      const missing = valid && !!dev.missing[r.key];
      valueEls[r.key].textContent = valid ? fmt(dev.snapshot.values[r.key], dec) : '—';
      tileEls[r.key].classList.toggle('invalid', !valid || missing);
      let note = !valid ? r.invalidNote ?? 'Not available' : missing ? r.optional?.missingNote ?? 'No reading' : '';
      if (valid && !missing && r.tareable) {
        const t = dev.tares[r.key];
        note = t === undefined ? 'Gross (no tare)' : `Net · tare ${fmt(t, dec)} ${r.unit}`;
        if (!dev.isStable(r.key)) note += ' · settling…';
      }
      noteEls[r.key].textContent = note;
      if (r.tareable) {
        tareBtns[r.key].disabled = !valid || missing || dev.snapshot.gross[r.key] === undefined || !dev.isStable(r.key);
        clearBtns[r.key].hidden = dev.tares[r.key] === undefined;
      }
    }
    for (const sp of d.setpoints) {
      const rb = dev.snapshot.setpoints[sp.key];
      const pend = dev.pending[sp.key];
      const readEl = spReadEls[sp.key];
      if (pend !== undefined) {
        readEl.textContent = `Sending ${fmt(pend, sp.decimals)}…`;
        readEl.dataset.state = 'pending';
      } else if (sp.switchKey || sp.actualKey) {
        // Set value vs actual, so a unit that is on but not following (or dropped its setpoint) is obvious.
        const tr = dev.tracking(sp.key);
        readEl.textContent = tr.text;
        readEl.dataset.state = tr.state;
      } else {
        readEl.textContent = rb === undefined ? 'Device: —' : `Device: ${fmt(rb, sp.decimals)} ${sp.unit} ✓`;
        readEl.dataset.state = 'ok';
      }
      const st = readEl.dataset.state;
      spApplyBtns[sp.key].classList.toggle('attention', st === 'mismatch' || st === 'stuck');
      const input = spInputs[sp.key];
      if (input.value === '' && document.activeElement !== input && rb !== undefined) input.value = String(rb);
    }
    for (const sw of d.switches) {
      const on = dev.snapshot.switches[sw.key];
      swEls[sw.key].setAttribute('aria-pressed', String(on));
      swEls[sw.key].textContent = `${sw.label}: ${on ? 'ON' : 'OFF'}`;
      const lock = dev.lockedBy(sw.key);
      swEls[sw.key].classList.toggle('locked', !!lock);
      swEls[sw.key].title = lock ? `Locked out: ${lock}` : '';
    }
    if (ilocks.length) {
      const reasons = ilocks.map((il) => dev.tripped[il.key]).filter(Boolean);
      alarm.hidden = !reasons.length;
      alarmText.textContent = reasons.join(' · ');
      guardLine.textContent = ilocks.map((il) => il.describe?.(dev.snapshot, dev.interlockValues(il.key)) ?? il.label).join(' · ');
    }
    for (const g of d.groups ?? []) {
      groupTitleEls[g.key].textContent = dev.groupLabel(g.key) ?? g.label;
      groupEls[g.key].classList.toggle('is-on', d.switches.some((sw) => sw.group === g.key && dev.snapshot.switches[sw.key]));
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
      const ilInputs = ilocks.flatMap((il) =>
        il.settings.map((st) => ({
          k: `${il.key}.${st.key}`,
          st,
          i: h('input', { type: 'number', min: st.min, max: st.max, step: st.step, value: dev.interlockValues(il.key)[st.key] }) as HTMLInputElement,
        })),
      );
      return h(
        'form',
        {
          class: 'form',
          onsubmit: (e: Event) => {
            e.preventDefault();
            for (const { sp, i } of inputs) dev.limits[sp.key] = i.value === '' ? undefined : Math.min(Number(i.value), sp.max);
            for (const { k, st, i } of ilInputs) {
              const v = Number(i.value);
              if (i.value === '' || !Number.isFinite(v) || v === st.default) delete dev.interlockSettings[k];
              else dev.interlockSettings[k] = Math.min(st.max, Math.max(st.min, v));
            }
            if (ilInputs.length) app.change(`${dev.label}: interlock settings ${ilInputs.map(({ st, k }) => `${st.label.toLowerCase()} ${dev.interlockSettings[k] ?? st.default} ${st.unit}`).join(', ')}`);
            app.save();
            update();
            close(true);
          },
        },
        h('p', { class: 'hint' }, 'Setpoints above your limit are refused. Leave empty to use the device maximum.'),
        ...inputs.map(({ sp, i }) => h('label', {}, `Max ${sp.label.toLowerCase()} (${sp.unit}, device max ${sp.max})`, i)),
        ilInputs.length > 0 && h('h3', {}, 'Heater interlock'),
        ilInputs.length > 0 && h('p', { class: 'hint' }, 'The app switches the heater off and locks it out when a rule trips. It only works while this page is open; set the safety limit on the unit itself as the backstop.'),
        ...ilInputs.map(({ st, i }) => h('label', {}, `${st.label} (${st.unit})`, i, st.hint && h('span', { class: 'hint' }, st.hint))),
        h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'submit' }, 'Save')),
      );
    });
  }

  async function editGroupNames() {
    menu.open = false;
    await openDialog(`Channel names — ${dev.label}`, (close) => {
      const inputs = d.groups!.map((g) => ({ g, i: h('input', { type: 'text', placeholder: g.label, value: dev.groupLabels[g.key] ?? '' }) as HTMLInputElement }));
      return h(
        'form',
        {
          class: 'form',
          onsubmit: (e: Event) => {
            e.preventDefault();
            for (const { g, i } of inputs) {
              if (i.value.trim()) dev.groupLabels[g.key] = i.value.trim();
              else delete dev.groupLabels[g.key];
            }
            app.save();
            app.changed.emit();
            close(true);
          },
        },
        h('p', { class: 'hint' }, 'Name each channel after what it pumps, e.g. "Reagent A". Names show on the card, the chart and in recordings. Programs still address channels as ch1, ch2…'),
        ...inputs.map(({ g, i }) => h('label', {}, g.label, i)),
        h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'submit' }, 'Save')),
      );
    });
    update();
  }

  async function remove() {
    menu.open = false;
    const msg = app.run
      ? `Remove ${dev.label} during a recording? Its data so far stays in the run. The unit is stopped and released to local control.`
      : `Remove ${dev.label} from this page? The unit is stopped and released to local control.`;
    if (!confirm(msg)) return;
    await app.removeDevice(dev);
  }

  update();
  return { el, update, handle };
}
