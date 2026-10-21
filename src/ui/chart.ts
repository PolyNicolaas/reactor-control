import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { App } from '../core/app';
import type { DeviceInstance } from '../core/device';
import { decimalsFor, fmt, h } from './dom';

// Channel colours inside a lane; a setpoint takes the colour of the reading it drives.
const CHANNEL_COLORS = ['#2f7de1', '#e0742f', '#2fa66a', '#a64fd6', '#d23f6b', '#1f9fb0'];
const RANGES = [
  { label: '5 min', min: 5 },
  { label: '15 min', min: 15 },
  { label: '30 min', min: 30 },
  { label: '1 h', min: 60 },
];
const STATE_KEY = 'ika-control.chart';
// Fixed axis widths + right padding keep every lane's plot area aligned on the shared time axis.
const AXIS_W = 72;
// Smallest y span per unit, so sensor noise is not blown up to fill the lane.
const MIN_SPAN: Record<string, number> = { '°C': 10, rpm: 100, Ncm: 5 };

function minSpan(min: number | null, max: number | null, span: number): [number, number] {
  if (min == null || max == null || !Number.isFinite(min) || !Number.isFinite(max)) return [0, span];
  const mid = (min + max) / 2;
  const half = Math.max((max - min) / 2 * 1.1, span / 2);
  const lo = min >= 0 && mid - half < 0 ? 0 : mid - half;
  return [lo, lo + Math.max(2 * half, max - lo)];
}

interface LaneSeries {
  key: string;          // row key in app.history
  short: string;        // "Speed", "Speed setpoint"
  unit: string;
  color: string;
  setpoint: boolean;
}

interface Lane {
  dev: DeviceInstance;
  series: LaneSeries[];
  shown: LaneSeries[];
  plot?: uPlot;
  plotHost: HTMLElement;
  chips: Map<string, HTMLElement>;
  el: HTMLElement;
}

interface ChartState {
  rangeMin: number;
  visible: Record<string, boolean>;   // series key -> shown (default: readings on, setpoints off)
  hiddenLanes: string[];              // device ids
}

function laneSeries(dev: DeviceInstance): LaneSeries[] {
  const colorOf: Record<string, string> = {};
  const out: LaneSeries[] = [];
  dev.driver.readings.forEach((r, i) => {
    colorOf[r.key] = CHANNEL_COLORS[i % CHANNEL_COLORS.length];
    if (r.chart) out.push({ key: `${dev.id}.${r.key}`, short: r.label, unit: r.unit, color: colorOf[r.key], setpoint: false });
  });
  for (const sp of dev.driver.setpoints) {
    out.push({
      key: `${dev.id}.sp.${sp.key}`,
      short: `${sp.label} setpoint`,
      unit: sp.unit,
      color: (sp.actualKey && colorOf[sp.actualKey]) || '#888',
      setpoint: true,
    });
  }
  return out;
}

/**
 * Live chart: one lane per device, all lanes on one shared time axis with a linked cursor.
 * Filters: time range, which lanes are shown, which channels are drawn in each lane.
 */
export function liveChart(app: App, host: HTMLElement): { rebuild: () => void } {
  const state: ChartState = loadState();
  let lanes: Lane[] = [];

  const rangeBar = h('div', { class: 'seg', role: 'group', 'aria-label': 'Time range' });
  const laneBar = h('div', { class: 'lane-filter', role: 'group', 'aria-label': 'Lanes' });
  const lanesEl = h('div', { class: 'lanes' });
  host.replaceChildren(h('div', { class: 'chart-tools' }, rangeBar, laneBar), lanesEl);

  const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
  const visible = (s: LaneSeries) => state.visible[s.key] ?? !s.setpoint;

  function save() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }

  function renderRangeBar() {
    rangeBar.replaceChildren(
      ...RANGES.map((r) =>
        h('button', {
          'aria-pressed': String(state.rangeMin === r.min),
          onclick: () => {
            state.rangeMin = r.min;
            save();
            renderRangeBar();
            for (const l of lanes) l.plot?.setData(data(l.shown), true);
          },
        }, r.label),
      ),
    );
  }

  function renderLaneBar() {
    laneBar.replaceChildren(
      ...(app.devices.length > 1
        ? app.devices.map((d) =>
            h('button', {
              class: 'lane-toggle',
              style: `--dev:${d.color}`,
              'aria-pressed': String(!state.hiddenLanes.includes(d.id)),
              onclick: () => {
                state.hiddenLanes = state.hiddenLanes.includes(d.id) ? state.hiddenLanes.filter((x) => x !== d.id) : [...state.hiddenLanes, d.id];
                save();
                rebuild();
              },
            }, h('span', { class: 'dot' }), d.label),
          )
        : []),
    );
  }

  function data(series: LaneSeries[]): uPlot.AlignedData {
    const hist = app.history;
    return [hist.map((r) => r.t / 1000), ...series.map((s) => hist.map((r) => r.v[s.key] ?? null))] as uPlot.AlignedData;
  }

  /** Most right-hand axes any lane has; lanes with fewer get padding so plot areas line up. */
  function maxRightAxes(): number {
    return Math.max(0, ...lanes.map((l) => new Set(l.series.filter(visible).map((s) => s.unit)).size - 1));
  }

  function buildPlot(lane: Lane, isLast: boolean) {
    lane.plot?.destroy();
    lane.plotHost.replaceChildren();
    const shown = lane.series.filter(visible);
    lane.shown = shown;
    if (!shown.length) {
      lane.plotHost.append(h('p', { class: 'empty small' }, 'No channels selected for this lane.'));
      lane.plot = undefined;
      return;
    }
    const ink = css('--ink-2');
    const grid = css('--grid');
    const units = [...new Set(shown.map((s) => s.unit))];
    const width = Math.max(280, lanesEl.clientWidth);
    lane.plot = new uPlot(
      {
        width,
        height: isLast ? 170 : 140,
        legend: { show: false },
        padding: [8, (maxRightAxes() - Math.max(0, units.length - 1)) * AXIS_W + 8, 0, units.length ? 0 : AXIS_W],
        cursor: { sync: { key: 'ika-lanes' }, drag: { x: false, y: false }, points: { size: 6 } },
        scales: {
          ...Object.fromEntries(units.map((u) => [u, { range: (_u: uPlot, min: number, max: number) => minSpan(min, max, MIN_SPAN[u] ?? 1) }])),
          x: {
            time: true,
            range: () => {
              const now = Date.now() / 1000;
              return [now - state.rangeMin * 60, now];
            },
          },
        },
        series: [
          {},
          ...shown.map((s) => ({
            label: s.short,
            scale: s.unit,
            stroke: s.color,
            width: s.setpoint ? 1.5 : 2,
            dash: s.setpoint ? [6, 4] : undefined,
            points: { show: false },
          })),
        ],
        axes: [
          {
            stroke: ink,
            grid: { stroke: grid, width: 1 },
            ticks: { stroke: grid },
            space: 90,
            size: isLast ? 36 : 6,
            values: (_u, splits) => (isLast ? splits.map((v) => new Date(v * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) : splits.map(() => '')),
          },
          ...units.map((u, i) => ({
            scale: u,
            side: i === 0 ? 3 : 1,
            stroke: ink,
            grid: { show: i === 0, stroke: grid, width: 1 },
            ticks: { stroke: grid },
            size: AXIS_W,
            values: (_u: uPlot, splits: number[]) => splits.map((v) => `${+v.toFixed(2)} ${u}`),
          })),
        ],
      },
      data(shown),
      lane.plotHost,
    );
  }

  function rebuild() {
    for (const l of lanes) l.plot?.destroy();
    renderRangeBar();
    renderLaneBar();
    const shownDevs = app.devices.filter((d) => !state.hiddenLanes.includes(d.id));
    if (!app.devices.length) {
      lanes = [];
      lanesEl.replaceChildren(h('p', { class: 'empty' }, 'Add a device to see live values here.'));
      return;
    }
    if (!shownDevs.length) {
      lanes = [];
      lanesEl.replaceChildren(h('p', { class: 'empty' }, 'All lanes are hidden. Turn one on above.'));
      return;
    }
    lanes = shownDevs.map((dev) => {
      const series = laneSeries(dev);
      const chips = new Map<string, HTMLElement>();
      const chipEls = series.map((s) => {
        const val = h('span', { class: 'chip-val' }, '—');
        chips.set(s.key, val);
        const b = h(
          'button',
          {
            class: `ch-chip${s.setpoint ? ' sp' : ''}`,
            style: `--c:${s.color}`,
            'aria-pressed': String(visible(s)),
            title: `Show or hide ${s.short.toLowerCase()}`,
            onclick: () => {
              state.visible[s.key] = !visible(s);
              save();
              b.setAttribute('aria-pressed', String(visible(s)));
              lanes.forEach((l, i) => buildPlot(l, i === lanes.length - 1));
            },
          },
          h('span', { class: 'swatch' }),
          h('span', {}, s.short),
          val,
        );
        return b;
      });
      const plotHost = h('div', { class: 'lane-plot' });
      const el = h(
        'div',
        { class: 'lane', style: `--dev:${dev.color}` },
        h('div', { class: 'lane-head' }, h('span', { class: 'lane-name' }, h('span', { class: 'dot' }), dev.label), h('div', { class: 'lane-chips' }, ...chipEls)),
        plotHost,
      );
      return { dev, series, shown: [], plotHost, chips, el } as Lane;
    });
    lanesEl.replaceChildren(...lanes.map((l) => l.el));
    lanes.forEach((l, i) => buildPlot(l, i === lanes.length - 1));
    updateChips();
  }

  function updateChips() {
    const last = app.history[app.history.length - 1];
    for (const l of lanes) {
      for (const s of l.series) {
        const v = last?.v[s.key];
        l.chips.get(s.key)!.textContent = v === undefined ? '—' : `${fmt(v, decimalsFor(s.unit))} ${s.unit}`;
      }
    }
  }

  app.sampled.on(() => {
    for (const l of lanes) {
      if (l.plot) l.plot.setData(data(l.shown), true);
    }
    updateChips();
  });

  new ResizeObserver(() => {
    const w = Math.max(280, lanesEl.clientWidth);
    for (const l of lanes) l.plot?.setSize({ width: w, height: l.plot.height });
  }).observe(lanesEl);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', rebuild);
  rebuild();
  return { rebuild };
}

function loadState(): ChartState {
  const fallback: ChartState = { rangeMin: 15, visible: {}, hiddenLanes: [] };
  try {
    const s = localStorage.getItem(STATE_KEY);
    return s ? { ...fallback, ...(JSON.parse(s) as Partial<ChartState>) } : fallback;
  } catch {
    return fallback;
  }
}
