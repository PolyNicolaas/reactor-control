import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { App, Column } from '../core/app';

const DASHES: number[][] = [[], [8, 4], [2, 4], [12, 4, 2, 4]];

/** Live chart: one colour per device, a dash style per channel, one axis per unit. */
export function liveChart(app: App, host: HTMLElement): { rebuild: () => void } {
  let plot: uPlot | undefined;
  let cols: Column[] = [];

  const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';

  function rebuild() {
    plot?.destroy();
    plot = undefined;
    host.replaceChildren();
    cols = app.columns().filter((c) => {
      if (c.kind === 'switch') return false;
      const dev = app.devices.find((d) => d.id === c.deviceId)!;
      if (c.kind === 'setpoint') return true;
      const key = c.key.slice(c.deviceId.length + 1);
      return dev.driver.readings.find((r) => r.key === key)?.chart;
    });
    if (!cols.length) {
      host.append(Object.assign(document.createElement('p'), { className: 'empty', textContent: 'Add a device to see live values here.' }));
      return;
    }
    const units = [...new Set(cols.map((c) => c.unit))];
    const ink = css('--ink-2');
    const grid = css('--grid');
    const channelIndex = new Map<string, number>();
    const series: uPlot.Series[] = [
      {},
      ...cols.map((c) => {
        const dev = app.devices.find((d) => d.id === c.deviceId)!;
        const n = channelIndex.get(c.deviceId) ?? 0;
        if (c.kind === 'actual') channelIndex.set(c.deviceId, n + 1);
        return {
          label: c.label,
          scale: c.unit,
          stroke: dev.color,
          width: c.kind === 'setpoint' ? 1 : 2,
          dash: c.kind === 'setpoint' ? [3, 3] : DASHES[n % DASHES.length],
          show: c.kind !== 'setpoint',
          spanGaps: false,
          value: (_u: uPlot, v: number | null) => (v == null ? '—' : v.toFixed(c.unit === 'rpm' ? 0 : 1)),
        } as uPlot.Series;
      }),
    ];
    const axes: uPlot.Axis[] = [
      {
        stroke: ink,
        grid: { stroke: grid, width: 1 },
        ticks: { stroke: grid },
        space: 90,
        values: (_u, splits) => splits.map((s) => new Date(s * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })),
      },
      ...units.map((u, i) => ({
        scale: u,
        label: u,
        side: i === 0 ? 3 : 1,
        stroke: ink,
        grid: { show: i === 0, stroke: grid, width: 1 },
        ticks: { stroke: grid },
        size: 52,
      })),
    ];
    const width = Math.max(300, host.clientWidth);
    plot = new uPlot(
      {
        width,
        height: Math.min(360, Math.max(220, Math.round(width * 0.4))),
        series,
        axes,
        scales: { x: { time: true } },
        legend: { live: true },
        cursor: { drag: { x: false, y: false } },
      },
      data(),
      host,
    );
  }

  function data(): uPlot.AlignedData {
    const h = app.history;
    return [h.map((r) => r.t / 1000), ...cols.map((c) => h.map((r) => r.v[c.key] ?? null))] as uPlot.AlignedData;
  }

  app.sampled.on(() => plot?.setData(data()));
  new ResizeObserver(() => plot && plot.setSize({ width: Math.max(300, host.clientWidth), height: plot.height })).observe(host);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', rebuild);
  rebuild();
  return { rebuild };
}
