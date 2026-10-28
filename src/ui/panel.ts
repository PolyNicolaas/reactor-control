import type { App } from '../core/app';
import type { DeviceInstance } from '../core/device';
import { decimalsFor, fmt, h, openDialog, toast } from './dom';
import { openTerminal } from './terminal';
import type { CautionList, FunctionGroup, RuleState, SafetyRule } from '../core/types';

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
  const channels = (d.groups ?? []).filter((g) => g.channel);

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
      channels.length > 0 && h('button', { onclick: () => editGroupNames() }, 'Channel names'),
      h('button', { onclick: () => openTerminal(app, dev) }, 'Bench terminal'),
      d.source && h('a', { class: 'menu-link', href: `${MODULES_URL}/${d.source}`, target: '_blank', rel: 'noopener' }, 'How this module works ↗'),
      h('button', { class: 'danger-text', onclick: () => remove() }, 'Remove from page'),
    ),
  );

  // Close the menu after any choice, and when clicking anywhere else.
  menu.querySelector('.menu-items')!.addEventListener('click', () => (menu.open = false));
  // Removed again once the card leaves the page, so removed cards are not kept alive by the listener.
  const onDocClick = (e: MouseEvent) => {
    if (!el.isConnected && !app.devices.includes(dev)) return document.removeEventListener('click', onDocClick);
    if (menu.open && !menu.contains(e.target as Node)) menu.open = false;
  };
  document.addEventListener('click', onDocClick);

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
      // An empty box would read as 0 (Number('') === 0) and send 0 to the unit.
      const value = input.value.trim() === '' ? NaN : Number(input.value);
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
      h('div', { class: 'sp-input' }, input, h('span', { class: 'unit' }, sp.unit), (spApplyBtns[sp.key] = h('button', { class: 'sp-apply', onclick: apply }, 'Set') as HTMLButtonElement)),
      read,
    );
  };

  const switchFor = (sw: (typeof d.switches)[number]) => {
      const b = h('button', { class: 'switch', role: 'switch', 'aria-checked': 'false', 'aria-label': sw.label },
        h('span', { class: 'switch-label' }, sw.label),
        h('span', { class: 'switch-track', 'aria-hidden': 'true' }, h('span', { class: 'switch-state' }, 'OFF'), h('span', { class: 'switch-knob' })),
      ) as HTMLButtonElement;
      b.addEventListener('click', async () => {
        const on = !dev.snapshot.switches[sw.key];
        if (on && sw.confirmOn && !confirm(sw.confirmOn)) return;
        // Other modules' safety rules that depend on this switch (e.g. the hotplate watches stirring).
        const watchers = on ? [] : dev.watchersOfSwitch(sw.key);
        if (watchers.length && !confirm(`Turning ${sw.label.toLowerCase()} off will trigger:\n\n${watchers.map((w) => `• ${w.dev.label} › ${w.rule.label}: ${w.note}`).join('\n')}\n\nTurn it off anyway?`)) return;
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

  // Safety: an alarm banner while a rule has tripped, a summary chip in the header, and each
  // function's rules inside its section.
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
  const hotEl = h('span', { class: 'hot-badge', role: 'status', hidden: true });
  const safetyChip = h('span', { class: 'safety-chip', title: 'Safety rules on this unit' });
  dev.tripped$.on((text) => toast(`SAFETY STOP — ${text}`, 'error'));

  // ── Functions ───────────────────────────────────────────────────────────────────────────────────
  // One section per function of the unit (Heating, Stirring, Weighing; pump channels), holding
  // everything about it: readings, setpoint, switch, safety rules, caution lists, and the rules on
  // other units that watch it. These are also what methods address ("Hotplate › Heating › Temperature").
  // Anything a module did not put in a function goes in a last "Unit" section.
  const fnDefs: FunctionGroup[] = [...(d.groups ?? [])];
  const restKey = '_unit';
  const fnOf = (g?: string) => (g && fnDefs.some((x) => x.key === g) ? g : restKey);
  const ruleFn = (r: SafetyRule) => fnOf(r.group ?? d.switches.find((x) => x.key === r.switches[0])?.group);
  const cautionSpecs = d.cautions ?? [];
  const inFn = (k: string) =>
    shownReadings.some((r) => fnOf(r.group) === k) ||
    d.setpoints.some((sp) => fnOf(sp.group) === k) ||
    d.switches.some((sw) => fnOf(sw.group) === k) ||
    rules.some((r) => ruleFn(r) === k) ||
    cautionSpecs.some((c) => fnOf(c.group) === k);
  if (inFn(restKey)) fnDefs.push({ key: restKey, label: fnDefs.length ? 'Unit' : d.kind });
  const firstFn = fnDefs.find((f) => inFn(f.key))?.key;
  const sectionUpdates: (() => void)[] = [];

  const sections = fnDefs.filter((f) => inFn(f.key)).map((f) => {
    const title = h('span', { class: 'fn-title' }, dev.groupLabel(f.key) ?? f.label);
    groupTitleEls[f.key] = title;
    const sws = d.switches.filter((sw) => fnOf(sw.group) === f.key).map(switchFor);
    const tiles = shownReadings.filter((r) => fnOf(r.group) === f.key).map(tileFor);
    const sps = d.setpoints.filter((sp) => fnOf(sp.group) === f.key).map(spRowFor);
    const rb = rulesBlock(app, dev, rules.filter((r) => ruleFn(r) === f.key));
    const cbs = cautionSpecs.filter((c) => fnOf(c.group) === f.key).map((c) => cautionBlock(app, dev, c));
    // Rules elsewhere that watch an activity of this function (stirring); others go to the first section.
    const acts = d.readings.filter((r) => fnOf(r.group) === f.key && r.activity).map((r) => r.activity!.name);
    const wb = watchedBlock(dev, (w) => (w.rule.watchesActivity ? acts.includes(w.rule.watchesActivity) : f.key === firstFn));
    sectionUpdates.push(() => {
      rb?.update();
      for (const c of cbs) c.update();
      wb.update();
    });
    const section = h(
      'section',
      { class: 'fn', 'data-fn': f.key },
      // One row per function (D57): name and switch | values | setpoints | safety, cautions, watched by.
      // Every column is always there (empty or not) so the columns line up from row to row.
      h('header', { class: 'fn-head' }, h('span', { class: 'fn-name' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), title), sws.length ? h('div', { class: 'fn-switches' }, ...sws) : false),
      h('div', { class: 'fn-values' }, tiles.length ? h('div', { class: 'tiles' }, ...tiles) : false),
      h('div', { class: 'fn-set' }, ...sps),
      h('div', { class: 'fn-extra' }, rb ? rb.el : false, ...cbs.map((c) => c.el), wb.el),
    );
    groupEls[f.key] = section;
    return section;
  });

  const body: (HTMLElement | false)[] = [alarm, h('div', { class: 'fns' }, ...sections)];

  const reconnectBtn = h('button', { class: 'primary', onclick: () => onReconnect(dev) }, 'Reconnect');
  const offline = h('div', { class: 'offline' }, h('p', {}, 'Not connected. Nothing is sent to this unit.'), reconnectBtn);

  const handle = h('button', { class: 'handle', 'aria-label': `Drag to reorder ${dev.label}`, title: 'Drag to reorder' }, '⠿');
  const el = h(
    'section',
    { class: 'panel device-panel', style: `--dev:${dev.color}`, 'data-id': dev.id },
    h(
      'header',
      {},
      handle,
      h('div', { class: 'dev-title' }, titleEl, h('span', { class: 'dev-model' }, `${d.displayName}${dev.transport.kind === 'sim' ? ' · simulated' : ''}`)),
      h('div', { class: 'dev-badges' }, hotEl, statusEl, rules.length ? safetyChip : false),
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
      swEls[sw.key].setAttribute('aria-checked', String(on));
      swEls[sw.key].querySelector('.switch-state')!.textContent = on ? 'ON' : 'OFF';
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
    for (const f of fnDefs) {
      if (!groupEls[f.key]) continue;
      groupTitleEls[f.key].textContent = dev.groupLabel(f.key) ?? f.label;
      groupEls[f.key].classList.toggle('is-on', d.switches.some((sw) => fnOf(sw.group) === f.key && dev.snapshot.switches[sw.key]));
      groupEls[f.key].classList.toggle('is-tripped', rules.some((r) => ruleFn(r) === f.key && dev.tripped[r.key]));
    }
    for (const u of sectionUpdates) u();
    // Header chip: the worst state across the unit's rules.
    if (rules.length) {
      const states = rules.map((r) => (dev.tripped[r.key] ? 'trip' : dev.isRuleOn(r) ? dev.ruleStatus[r.key]?.state ?? 'idle' : 'off'));
      const n = (s: RuleState) => states.filter((x) => x === s).length;
      const worst: RuleState = n('trip') ? 'trip' : n('near') ? 'near' : 'ok';
      safetyChip.dataset.state = worst;
      safetyChip.textContent = worst === 'trip' ? `⛨ ${n('trip')} tripped` : worst === 'near' ? `⛨ ${n('near')} close` : n('ok') ? `⛨ ${n('ok')} active` : '⛨ standby';
      const sumFn = d.safety?.summary;
      safetyChip.title = `Safety: ${rules.filter((r) => dev.isRuleOn(r)).length} of ${rules.length} rules on, ${n('ok')} active${sumFn ? ` · ${sumFn(dev.snapshot, dev.safetyValues())}` : ''}`;
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
            update();
            close(true);
          },
        },
        h('p', { class: 'hint' }, 'Setpoints above your limit are refused. Leave empty to use the device maximum.'),
        ...inputs.map(({ sp, i }) => h('label', {}, `Max ${sp.label.toLowerCase()} (${sp.unit}, device max ${sp.max})`, i)),
        rules.length > 0 && h('p', { class: 'hint' }, 'Safety rules and their settings are in the Safety section on the card.'),
        h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'submit' }, 'Save')),
      );
    });
  }

  async function editGroupNames() {
    menu.open = false;
    await openDialog(`Channel names — ${dev.label}`, (close) => {
      const inputs = channels.map((g) => ({ g, i: h('input', { type: 'text', placeholder: g.label, value: dev.groupLabels[g.key] ?? '' }) as HTMLInputElement }));
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
        h('p', { class: 'hint' }, 'Name each channel after what it pumps, e.g. "Reagent A". Names show on the card, the chart and in recordings. Methods still address channels as ch1, ch2…'),
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
                dev.setSafetySetting(c.cap!.setting, capV); // same path as typing it: clamped, saved, re-drawn
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

/** What each rule state is called on the card. */
const STATE_LABEL: Record<RuleState, string> = { off: 'Off', idle: 'Standby', learning: 'Learning', ok: 'Active', near: 'Close', trip: 'Tripped' };
const STATE_HINT: Record<RuleState, string> = {
  off: 'Turned off: this rule does nothing',
  idle: 'On, nothing to watch right now',
  learning: 'On, collecting data before it can judge',
  ok: 'On and watching: all fine',
  near: 'On and watching: getting close to tripping',
  trip: 'Tripped: what it guards is off and locked until reset',
};

/**
 * Safety rules of one function, live. One row per rule: state, name, on/off toggle, live line; open the
 * row for why it exists, what it stops, which module it watches, and its settings (edited in place, logged).
 * Returns null when the function has no rules.
 */
function rulesBlock(app: App, dev: DeviceInstance, rules: SafetyRule[]): { el: HTMLElement; update: () => void } | null {
  if (!rules.length) return null;
  const d = dev.driver;
  const sum = h('span', { class: 'safety-sum' });
  const swLabel = (k: string) => d.switches.find((x) => x.key === k)?.label ?? k;
  const rows: { el: HTMLElement; chip: HTMLElement; text: HTMLElement; toggle: HTMLInputElement; watches?: HTMLElement; inputs: Record<string, HTMLInputElement>; rule: SafetyRule }[] = [];
  const list = h('div', { class: 'safety-rules' });

  for (const r of rules) {
    const chip = h('span', { class: 'rule-chip' });
    const text = h('span', { class: 'rule-text' });
    const toggle = h('input', { type: 'checkbox', role: 'switch', 'aria-label': `${r.label} on/off` }) as HTMLInputElement;
    toggle.disabled = !!r.required;
    toggle.title = r.required ? 'Always on: this rule is the floor the others build on' : 'Turn this rule on or off';
    toggle.addEventListener('click', (e) => e.stopPropagation()); // don't open the row
    toggle.addEventListener('change', () => {
      const on = toggle.checked;
      if (!on && !confirm(`Turn off "${r.label}" on ${dev.label}?\n\n${r.why}`)) {
        toggle.checked = true;
        return;
      }
      try {
        dev.setRuleOn(r.key, on);
        app.change(`${dev.label}: safety rule "${r.label}" ${on ? 'on' : 'off'}`);
        app.save();
      } catch (e) {
        toggle.checked = !on;
        toast((e as Error).message, 'error');
      }
      update();
    });
    const inputs: Record<string, HTMLInputElement> = {};
    const settingEls = (r.settings ?? []).map((st) => {
      const i = h('input', { type: 'number', min: st.min, max: st.max, step: st.step, 'aria-label': st.label }) as HTMLInputElement;
      inputs[st.key] = i;
      i.addEventListener('change', () => {
        const before = dev.safetyValues()[st.key];
        try {
          const v = dev.setSafetySetting(st.key, Number(i.value));
          i.value = String(v);
          if (v !== before) {
            app.change(`${dev.label}: ${r.label} — ${st.label.toLowerCase()} ${before} → ${v} ${st.unit}`);
            app.save();
          }
        } catch (e) {
          i.value = String(before);
          toast((e as Error).message, 'error');
        }
      });
      i.addEventListener('keydown', (e) => e.key === 'Enter' && i.blur());
      return h('label', { class: 'rule-setting' }, h('span', {}, st.label), h('span', { class: 'rule-input' }, i, h('span', { class: 'unit' }, st.unit)), st.hint && h('span', { class: 'hint' }, st.hint));
    });
    const watches = r.withPeer ? h('dd', {}) : undefined;
    const el = h(
      'details',
      { class: 'rule' },
      h('summary', {}, chip, h('span', { class: 'rule-label' }, r.label), h('span', { class: 'rule-toggle' }, toggle), text),
      h(
        'div',
        { class: 'rule-body' },
        h('p', { class: 'rule-why' }, r.why),
        h(
          'dl',
          { class: 'rule-facts' },
          h('dt', {}, 'Stops'),
          h('dd', {}, [...new Set(r.switches.map(swLabel))].join(', ')),
          ...(watches ? [h('dt', {}, 'Watches'), watches] : []),
          h('dt', {}, 'On/off'),
          h('dd', {}, r.required ? 'Always on' : (r.defaultOn ?? true) ? 'On by default' : 'Off by default; turn on when you have set it for this run'),
        ),
        settingEls.length ? h('div', { class: 'rule-settings' }, ...settingEls) : false,
      ),
    );
    rows.push({ el, chip, text, toggle, watches, inputs, rule: r });
    list.append(el);
  }

  const el = h(
    'details',
    { class: 'safety' },
    h('summary', {}, h('span', { class: 'safety-icon', 'aria-hidden': 'true' }, '⛨'), h('span', {}, 'Safety'), sum),
    list,
  ) as HTMLDetailsElement;

  function update() {
    const counts: Partial<Record<RuleState, number>> = {};
    const set = dev.safetyValues();
    for (const row of rows) {
      const on = dev.isRuleOn(row.rule);
      const st = dev.ruleStatus[row.rule.key] ?? { state: (on ? 'idle' : 'off') as RuleState, text: on ? (dev.connected ? 'Waiting for the first poll' : 'Not connected') : 'Turned off' };
      const state: RuleState = dev.tripped[row.rule.key] ? 'trip' : on ? st.state : 'off';
      counts[state] = (counts[state] ?? 0) + 1;
      row.el.dataset.state = state;
      row.chip.textContent = STATE_LABEL[state];
      row.chip.title = STATE_HINT[state];
      row.text.textContent = dev.tripped[row.rule.key] ?? st.text;
      row.toggle.checked = on;
      for (const [k, i] of Object.entries(row.inputs)) if (document.activeElement !== i) i.value = set[k] === undefined ? '' : String(set[k]);
      if (row.watches) {
        const peers = dev.peers().filter((p) => p !== dev && (p.driver.provides ?? []).includes(row.rule.withPeer!));
        row.watches.textContent = peers.length
          ? peers.map((p) => `${p.label} (${p.driver.displayName})`).join(', ')
          : `Any module that provides "${row.rule.withPeer}" — none on this page, so this rule is on standby`;
      }
    }
    const on = rules.filter((r) => dev.isRuleOn(r)).length;
    sum.textContent = counts.trip
      ? ` · ${counts.trip} tripped`
      : counts.near
        ? ` · ${counts.near} close to tripping`
        : ` · ${on} of ${rules.length} on · ${counts.ok ?? 0} active`;
    el.dataset.state = counts.trip ? 'trip' : counts.near ? 'near' : 'ok';
  }
  return { el, update };
}

/** "Watched by": rules on OTHER units of this page that depend on this function, with their state. */
function watchedBlock(dev: DeviceInstance, include: (w: ReturnType<DeviceInstance['watchedBy']>[number]) => boolean): { el: HTMLElement; update: () => void } {
  const list = h('div', { class: 'watched-list' });
  const el = h('div', { class: 'watched', hidden: true }, h('h4', {}, 'Watched by'), list);
  let key = '';
  function update() {
    const w = dev.watchedBy().filter(include);
    el.hidden = !w.length;
    const k = w.map((x) => `${x.dev.id}.${x.rule.key}`).join('|');
    if (k !== key) {
      key = k;
      list.replaceChildren(
        ...w.map((x) =>
          h('div', { class: 'watched-item', 'data-dev': x.dev.id, 'data-rule': x.rule.key },
            h('span', { class: 'rule-chip' }),
            h('span', {}, h('strong', {}, `${x.dev.label} › ${x.rule.label}`), h('span', { class: 'watched-note' })),
          ),
        ),
      );
    }
    for (const x of w) {
      const item = list.querySelector<HTMLElement>(`[data-dev="${x.dev.id}"][data-rule="${x.rule.key}"]`);
      if (!item) continue;
      const state: RuleState = x.dev.tripped[x.rule.key] ? 'trip' : x.on ? x.status?.state ?? 'idle' : 'off';
      item.dataset.state = state;
      const chip = item.querySelector<HTMLElement>('.rule-chip')!;
      chip.textContent = STATE_LABEL[state];
      chip.title = STATE_HINT[state];
      item.querySelector('.watched-note')!.textContent = ` — ${x.note}`;
    }
  }
  return { el, update };
}
