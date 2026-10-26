import type { App } from '../core/app';
import type { DeviceInstance } from '../core/device';
import { decimalsFor, fmt, h, openDialog, toast } from './dom';
import { openTerminal } from './terminal';
import type { CautionList, RuleState } from '../core/types';

/** Where each module's folder (code + README) can be read. */
const MODULES_URL = 'https://github.com/PolyNicolaas/reactor-control/tree/main/src/modules';

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
      d.source && h('a', { class: 'menu-link', href: `${MODULES_URL}/${d.source}`, target: '_blank', rel: 'noopener' }, 'How this module works ↗'),
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

  // Safety: an alarm banner while a rule has tripped, and the module's rules live on the card.
  const rules = d.safety?.rules ?? [];
  const alarmTitle = h('strong', {});
  const alarmText = h('span', { class: 'alarm-text' });
  const resetBtn = h('button', { type: 'button' }, 'Reset safety stop') as HTMLButtonElement;
  resetBtn.addEventListener('click', () => {
    try {
      dev.resetSafety();
      app.change(`${dev.label}: safety stop reset`);
      toast('Safety stop reset. The unit can be switched on again.');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
    update();
  });
  const alarm = h('div', { class: 'alarm', role: 'alert', hidden: true }, alarmTitle, alarmText, resetBtn);
  const safety = safetyBlock(dev, () => editLimits());
  const hotEl = h('span', { class: 'hot-badge', role: 'status', hidden: true });
  const cautions = (d.cautions ?? []).map((c) => cautionBlock(app, dev, c));
  dev.tripped$.on((text) => toast(`SAFETY STOP — ${text}`, 'error'));

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
  body.unshift(alarm);
  body.push(safety.el, ...cautions.map((c) => c.el));

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
      hotEl,
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
    const hs = dev.hotState;
    hotEl.hidden = !hs;
    hotEl.textContent = hotText(hs);
    hotEl.dataset.state = hs?.state ?? '';
    hotEl.title = hs ? 'The plate is hot. Do not touch it, even with the heater off.' : '';
    el.classList.toggle('is-hot', !!hs);
    for (const c of cautions) c.update();
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
    const trips = rules.filter((r) => dev.tripped[r.key]);
    alarm.hidden = !trips.length;
    if (trips.length) {
      const sws = [...new Set(trips.flatMap((r) => r.switches))].map((k) => d.switches.find((x) => x.key === k)?.label ?? k);
      alarmTitle.textContent = `Safety stop · ${sws.join(', ')} locked out`;
      alarmText.textContent = trips.map((r) => `${r.label}: ${dev.tripped[r.key]}`).join(' · ');
    }
    safety.update();
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
      // Safety settings, grouped under the rule they belong to.
      const values = dev.safetyValues();
      const ruleInputs = rules
        .filter((r) => r.settings?.length)
        .map((r) => ({
          r,
          fields: r.settings!.map((st) => ({ st, i: h('input', { type: 'number', min: st.min, max: st.max, step: st.step, value: values[st.key] }) as HTMLInputElement })),
        }));
      const ilInputs = ruleInputs.flatMap((x) => x.fields);
      return h(
        'form',
        {
          class: 'form',
          onsubmit: (e: Event) => {
            e.preventDefault();
            for (const { sp, i } of inputs) dev.limits[sp.key] = i.value === '' ? undefined : Math.min(Number(i.value), sp.max);
            const changed: string[] = [];
            for (const { st, i } of ilInputs) {
              const before = values[st.key];
              const v = Number(i.value);
              if (i.value === '' || !Number.isFinite(v) || v === st.default) delete dev.safetySettings[st.key];
              else dev.safetySettings[st.key] = Math.min(st.max, Math.max(st.min, v));
              const after = dev.safetySettings[st.key] ?? st.default;
              if (after !== before) changed.push(`${st.label.toLowerCase()} ${before} → ${after} ${st.unit}`);
            }
            if (changed.length) app.change(`${dev.label}: safety settings ${changed.join(', ')}`);
            app.save();
            update();
            close(true);
          },
        },
        h('p', { class: 'hint' }, 'Setpoints above your limit are refused. Leave empty to use the device maximum.'),
        ...inputs.map(({ sp, i }) => h('label', {}, `Max ${sp.label.toLowerCase()} (${sp.unit}, device max ${sp.max})`, i)),
        ruleInputs.length > 0 && h('h3', {}, 'Safety rules'),
        ruleInputs.length > 0 && h('p', { class: 'hint' }, 'When a rule trips, the app switches off what it guards and locks it out until you reset it on the card. This only works while this page is open and the unit answers; the unit\'s own limits are the backstop.'),
        ...ruleInputs.flatMap(({ r, fields }) => [
          h('h4', {}, r.label),
          ...fields.map(({ st, i }) => h('label', {}, `${st.label} (${st.unit})`, i, st.hint && h('span', { class: 'hint' }, st.hint))),
        ]),
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

/** Text for a HOT badge, or '' when not hot. Used on live cards and on cards of units not connected. */
export function hotText(h: { state: 'hot' | 'maybe'; v: number; t: number } | undefined): string {
  if (!h) return '';
  if (h.state === 'hot') return `HOT ${Math.round(h.v)} °C`;
  const at = new Date(h.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `MAY BE HOT · ${Math.round(h.v)} °C at ${at}`;
}

/** The caution icon and its expandable list (e.g. solvent autoignition temperatures). */
function cautionBlock(app: App, dev: DeviceInstance, c: CautionList): { el: HTMLElement; update: () => void } {
  const count = h('span', { class: 'caution-count' });
  const refEl = h('p', { class: 'caution-ref' });
  const tbody = h('tbody');
  const el = h(
    'details',
    { class: 'caution' },
    h('summary', { title: c.title }, h('span', { class: 'caution-icon', 'aria-hidden': 'true' }, '⚠'), h('span', {}, c.title), count),
    h('p', { class: 'hint' }, c.intro),
    refEl,
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Substance'), h('th', {}, `Ignites at (${c.unit})`), h('th', {}, 'Source / note'), c.cap ? h('th', {}, '') : false)), tbody),
    h('p', { class: 'hint caution-src' }, `Sources: ${c.sources}.`),
  ) as HTMLDetailsElement;
  let lastKey = '';
  function update() {
    const ref = c.reference(dev.snapshot, dev.safetyValues());
    refEl.textContent = ref.label;
    const flagged = c.items.filter((it) => it.value <= ref.value).length;
    const near = c.items.filter((it) => it.value > ref.value && it.value <= ref.value + c.nearBy).length;
    count.textContent = flagged ? ` · ${flagged} at risk` : near ? ` · ${near} within ${c.nearBy} ${c.unit}` : '';
    el.dataset.level = flagged ? 'danger' : near ? 'near' : 'ok';
    const capNow = c.cap ? dev.safetyValues()[c.cap.setting] : undefined;
    const key = `${Math.round(ref.value)}|${capNow}`;
    if (key === lastKey) return; // rebuild rows only when something visible changes
    lastKey = key;
    tbody.replaceChildren(
      ...c.items.map((it) => {
        const level = it.value <= ref.value ? 'danger' : it.value <= ref.value + c.nearBy ? 'near' : '';
        let btn: HTMLElement | false = false;
        if (c.cap) {
          const capV = Math.floor((it.value - c.cap.margin) / 5) * 5;
          const st = dev.driver.safety?.rules.flatMap((r) => r.settings ?? []).find((x) => x.key === c.cap!.setting);
          if (st && capNow !== undefined && capV < capNow && capV >= st.min) {
            btn = h('button', {
              type: 'button',
              class: 'small',
              title: `Set "${st.label}" to ${capV} ${st.unit} (${c.cap.margin} ${st.unit} below ${it.name})`,
              onclick: () => {
                if (!confirm(`Set "${st.label}" for ${dev.label} to ${capV} ${st.unit}, ${c.cap!.margin} ${st.unit} below the autoignition temperature of ${it.name}?`)) return;
                dev.safetySettings[c.cap!.setting] = capV;
                app.change(`${dev.label}: ${st.label.toLowerCase()} set to ${capV} ${st.unit} for ${it.name}`);
                app.save();
                toast(`${st.label}: ${capV} ${st.unit}`);
                update();
              },
            }, c.cap.label(capV));
          }
        }
        return h('tr', { 'data-level': level }, h('td', {}, it.name), h('td', { class: 'num' }, String(it.value)), h('td', { class: 'note' }, it.note ?? ''), c.cap ? h('td', {}, btn) : false);
      }),
    );
  }
  return { el, update };
}

const STATE_LABEL: Record<RuleState, string> = { off: 'Off', idle: 'Idle', learning: 'Learning', ok: 'OK', near: 'Close', trip: 'STOP' };

/**
 * The module's safety rules, live: one row per rule with its state, its numbers, and (on demand) why it
 * exists. Every card has this section, so anyone can see what guards the unit and how close it is.
 */
function safetyBlock(dev: DeviceInstance, openSettings: () => void): { el: HTMLElement; update: () => void } {
  const rules = dev.driver.safety?.rules ?? [];
  const sum = h('span', { class: 'safety-sum' });
  const line = h('span', { class: 'safety-line' });
  const rows: { el: HTMLElement; chip: HTMLElement; text: HTMLElement; key: string }[] = [];
  const list = h('div', { class: 'safety-rules' });
  for (const r of rules) {
    const chip = h('span', { class: 'rule-chip' });
    const text = h('span', { class: 'rule-text' });
    const el = h(
      'details',
      { class: 'rule' },
      h('summary', {}, chip, h('span', { class: 'rule-label' }, r.label, r.withPeer ? h('span', { class: 'rule-peer', title: `Watches any module that provides "${r.withPeer}"` }, ` with ${r.withPeer}`) : false), text),
      h('p', { class: 'rule-why' }, r.why),
    );
    rows.push({ el, chip, text, key: r.key });
    list.append(el);
  }
  const el = h(
    'details',
    { class: 'safety' },
    h('summary', {}, h('span', { class: 'safety-icon', 'aria-hidden': 'true' }, '⛨'), h('span', {}, 'Safety'), sum, line),
    rules.length
      ? list
      : h('p', { class: 'hint' }, 'This module has no safety rules yet. See src/modules/README.md for how to add one.'),
    rules.some((r) => r.settings?.length) ? h('div', { class: 'safety-actions' }, h('button', { type: 'button', class: 'small', onclick: openSettings }, 'Safety settings…')) : false,
  ) as HTMLDetailsElement;
  function update() {
    const counts: Partial<Record<RuleState, number>> = {};
    for (const row of rows) {
      const st = dev.ruleStatus[row.key] ?? { state: 'idle' as RuleState, text: dev.connected ? 'Waiting for the first poll' : 'Not connected' };
      const state = dev.tripped[row.key] ? 'trip' : st.state;
      counts[state] = (counts[state] ?? 0) + 1;
      row.el.dataset.state = state;
      row.chip.textContent = STATE_LABEL[state];
      row.text.textContent = dev.tripped[row.key] ?? st.text;
    }
    const armed = rules.length - (counts.off ?? 0);
    sum.textContent = !rules.length
      ? ' · no rules'
      : counts.trip ? ` · ${counts.trip} STOPPED` : counts.near ? ` · ${counts.near} close to stopping` : ` · ${armed} of ${rules.length} rules on · all OK`;
    el.dataset.state = counts.trip ? 'trip' : counts.near ? 'near' : 'ok';
    const sumFn = dev.driver.safety?.summary;
    line.textContent = sumFn ? ` · ${sumFn(dev.snapshot, dev.safetyValues())}` : '';
  }
  return { el, update };
}
