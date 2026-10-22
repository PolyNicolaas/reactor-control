import './styles.css';
import { App, type Run } from './core/app';
import type { DeviceInstance } from './core/device';
import { serialSupported } from './core/serialTransport';
import { openAddDevice, reconnectDevice, reconnectSaved } from './ui/addDevice';
import { liveChart } from './ui/chart';
import { eventsCsv, runFileStem, samplesCsv } from './ui/csv';
import { download, h, toast } from './ui/dom';
import { devicePanel } from './ui/panel';
import { getDriver } from './devices/registry';

const app = new App();
let lastRun: Run | undefined;

// ---------- layout ----------
const chips = h('div', { class: 'chips' });
const stopBtn = h('button', { class: 'stop-all', onclick: () => stopAll() }, 'STOP ALL');
const recBtn = h('button', { class: 'rec', onclick: () => toggleRecording() }, 'Start recording');
const recState = h('span', { class: 'rec-state' }, 'Not recording');
const dlBtn = h('button', { onclick: () => downloadRun(), disabled: true }, 'Download CSV') as HTMLButtonElement;
const noteInput = h('input', { type: 'text', placeholder: 'Add a note, e.g. "added reagent B"', 'aria-label': 'Note' }) as HTMLInputElement;
const panels = h('div', { class: 'panels' });
const chartHost = h('div', { class: 'chart' });
const logList = h('ol', { class: 'log' });

document.getElementById('app')!.replaceChildren(
  h(
    'header',
    { class: 'topbar' },
    h('div', { class: 'brand' }, h('strong', {}, 'Reactor Control'), h('span', { class: 'sub' }, 'Lab device control over Web Serial')),
    chips,
    stopBtn,
  ),
  serialSupported() ? '' :
    h('div', { class: 'banner' }, 'This browser has no Web Serial, so real units cannot connect here. Open this page in Chrome or Edge on a computer, or Chromium on the Raspberry Pi. Simulated devices still work.'),
  h(
    'main',
    {},
    h('section', { class: 'card chart-card' }, h('h2', {}, 'Live chart'), h('p', { class: 'hint' }, 'One lane per device on a shared time axis. Tap a channel to show or hide it; setpoints are dashed and hidden at first.'), chartHost),
    h('section', { class: 'devices' }, h('div', { class: 'section-head' }, h('h2', {}, 'Devices'), h('span', { class: 'hint' }, 'Drag ⠿ to reorder; the chart lanes follow.')), panels),
  ),
  h(
    'footer',
    { class: 'runbar' },
    recBtn,
    recState,
    dlBtn,
    h('form', { class: 'note-form', onsubmit: (e: Event) => { e.preventDefault(); addNote(); } }, noteInput, h('button', { type: 'submit' }, 'Add note')),
  ),
  h('details', { class: 'card log-card' }, h('summary', {}, 'Event log'), logList),
);

const chart = liveChart(app, chartHost);

// ---------- panels ----------
const views = new Map<DeviceInstance, ReturnType<typeof devicePanel>>();
let lastIds = '';

function renderPanels() {
  const ids = app.devices.map((d) => `${d.id}:${d.label}:${JSON.stringify(d.groupLabels)}`).join('|') + '#' + app.missing.map((m) => m.id).join('|');
  if (ids !== lastIds) {
    lastIds = ids;
    for (const dev of [...views.keys()]) if (!app.devices.includes(dev)) views.delete(dev);
    const els: Node[] = [];
    for (const dev of app.devices) {
      if (!views.has(dev)) {
        const v = devicePanel(app, dev, (d) => reconnectDevice(app, d));
        enableReorder(v.handle, v.el, dev);
        views.set(dev, v);
      }
      els.push(views.get(dev)!.el);
    }
    for (const m of app.missing) {
      els.push(
        h(
          'section',
          { class: 'panel is-missing', style: `--dev:${m.color}` },
          h('header', {}, h('span', { class: 'dot' }), h('div', { class: 'dev-title' }, h('span', { class: 'dev-label' }, m.label), h('span', { class: 'dev-model' }, getDriver(m.model).displayName))),
          h('p', {}, 'Saved on this page, but its USB port is not connected or not yet allowed in this browser.'),
          h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => reconnectSaved(app, m) }, 'Reconnect'), h('button', { onclick: () => app.forgetMissing(m.id) }, 'Forget')),
        ),
      );
    }
    els.push(h('button', { class: 'add-tile', onclick: () => openAddDevice(app) }, h('span', { class: 'plus' }, '+'), 'Add device'));
    panels.replaceChildren(...els);
    chart.rebuild();
  }
  for (const v of views.values()) v.update();
  chips.replaceChildren(
    ...app.devices.map((d) => h('span', { class: 'chip', style: `--dev:${d.color}`, 'data-state': d.status.toLowerCase().replace(/\s+/g, '-') }, h('span', { class: 'dot' }), `${d.label}: ${d.status}`)),
  );
  recBtn.textContent = app.run ? 'Stop recording' : 'Start recording';
  recBtn.classList.toggle('on', !!app.run);
}

/** Drag a card by its handle (mouse, touch or pen); arrow keys on the handle also move it. */
function enableReorder(handle: HTMLElement, card: HTMLElement, dev: DeviceInstance) {
  let targetIndex = -1;
  const cards = () => [...panels.querySelectorAll<HTMLElement>('.panel[data-id]')];
  const clearMarks = () => cards().forEach((c) => c.classList.remove('drop-before', 'drop-after'));

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    card.classList.add('dragging');
    targetIndex = app.devices.indexOf(dev);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!card.classList.contains('dragging')) return;
    const others = cards().filter((c) => c !== card);
    clearMarks();
    let idx = others.findIndex((c) => {
      const r = c.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    if (idx === -1) {
      idx = others.length;
      others.at(-1)?.classList.add('drop-after');
    } else {
      others[idx].classList.add('drop-before');
    }
    targetIndex = idx;
  });
  const end = () => {
    if (!card.classList.contains('dragging')) return;
    card.classList.remove('dragging');
    clearMarks();
    if (targetIndex >= 0) app.moveDevice(dev, targetIndex);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('keydown', (e) => {
    const i = app.devices.indexOf(dev);
    if (e.key === 'ArrowUp') app.moveDevice(dev, i - 1);
    else if (e.key === 'ArrowDown') app.moveDevice(dev, i + 1);
    else return;
    e.preventDefault();
    requestAnimationFrame(() => views.get(dev)?.handle.focus());
  });
}

let raf = 0;
app.changed.on(() => {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(renderPanels);
});

app.sampled.on(() => {
  if (app.run) {
    const s = Math.round((Date.now() - app.run.startedAt) / 1000);
    recState.textContent = `Recording ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · ${app.run.rows.length} rows`;
  }
});

app.logged.on((e) => {
  const dev = app.devices.find((d) => d.id === e.deviceId);
  logList.prepend(h('li', { class: e.kind }, h('time', {}, new Date(e.t).toLocaleTimeString()), dev ? ` ${dev.label}: ` : ' ', e.text));
  while (logList.children.length > 300) logList.lastChild!.remove();
});

// ---------- actions ----------
async function stopAll() {
  await app.stopAll();
  toast('Stop all sent to every connected unit');
}

function toggleRecording() {
  if (app.run) {
    lastRun = app.stopRun();
    recState.textContent = lastRun ? `Stopped · ${lastRun.rows.length} rows ready to download` : 'Not recording';
    dlBtn.disabled = !lastRun;
  } else {
    app.startRun();
    dlBtn.disabled = true;
  }
}

function downloadRun() {
  if (!lastRun) return;
  const stem = runFileStem(lastRun);
  download(`${stem}_samples.csv`, samplesCsv(lastRun));
  setTimeout(() => download(`${stem}_events.csv`, eventsCsv(lastRun!)), 300);
}

function addNote() {
  const t = noteInput.value.trim();
  if (!t) return;
  app.note(t);
  noteInput.value = '';
  toast(app.run ? 'Note added to the recording' : 'Note added to the log (not recording)');
}

window.addEventListener('beforeunload', (e) => {
  if (app.anyRunning || app.run) {
    e.preventDefault();
    e.returnValue = '';
  }
});

if (serialSupported()) {
  navigator.serial.addEventListener('connect', () => toast('A USB serial device was plugged in. Use Reconnect or Add device.'));
}

// ---------- start ----------
renderPanels();
void app.restore().then((missing) => {
  if (missing.length) toast(`${missing.length} saved device(s) need Reconnect`);
});
