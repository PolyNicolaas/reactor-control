import { DeviceInstance, type DeviceEvent } from './device';
import { Emitter } from './emitter';
import { SerialTransport } from './serialTransport';
import { getDriver } from '../devices/registry';
import { SimTransport } from '../devices/simulator';
import type { Transport } from './types';

export const DEVICE_COLORS = ['#2f7de1', '#e0742f', '#2fa66a', '#a64fd6', '#d23f6b', '#1f9fb0', '#b28a12', '#6d7a8a'];

export interface SavedDevice {
  id: string;
  model: string;
  label: string;
  color: string;
  sim: boolean;
  usbVendorId?: number;
  usbProductId?: number;
  limits?: Record<string, number | undefined>;
}

export interface PageConfig {
  name: string;
  devices: SavedDevice[];
}

export interface Column {
  key: string;          // "<deviceId>.<reading>" or "<deviceId>.sp.<setpoint>"
  deviceId: string;
  label: string;        // "Hotplate probe"
  unit: string;
  kind: 'actual' | 'setpoint' | 'switch';
}

export interface Row {
  t: number;            // epoch ms
  v: Record<string, number | undefined>;
}

export interface Note {
  t: number;
  text: string;
}

export interface Run {
  startedAt: number;
  endedAt?: number;
  rows: Row[];
  events: DeviceEvent[];
  notes: Note[];
  columns: Column[];
  devices: { id: string; label: string; model: string; nameReply: string }[];
}

const CONFIG_KEY = 'ika-control.page';
const HISTORY_MS = 60 * 60 * 1000;

/** App state: devices on the page, a 1 s sampler for chart and recording, the event log. */
export class App {
  readonly devices: DeviceInstance[] = [];
  readonly changed = new Emitter<void>();
  readonly sampled = new Emitter<Row>();
  readonly logged = new Emitter<DeviceEvent>();
  history: Row[] = [];
  /** Saved devices whose port is not available yet (shown as "Reconnect" cards). */
  missing: SavedDevice[] = [];
  run?: Run;
  config: PageConfig = { name: 'Control page', devices: [] };

  constructor() {
    setInterval(() => this.sample(), 1000);
  }

  // ----- devices -----

  nextColor(): string {
    const used = new Set(this.devices.map((d) => d.color));
    return DEVICE_COLORS.find((c) => !used.has(c)) ?? DEVICE_COLORS[this.devices.length % DEVICE_COLORS.length];
  }

  newId(model: string): string {
    let i = 1;
    while (this.devices.some((d) => d.id === `${model}-${i}`)) i++;
    return `${model}-${i}`;
  }

  /** Create a device instance, connect it and add it to the page. */
  async addDevice(opts: { model: string; label: string; transport: Transport; id?: string; color?: string; limits?: SavedDevice['limits'] }): Promise<DeviceInstance> {
    const driver = getDriver(opts.model);
    const dev = new DeviceInstance(opts.id ?? this.newId(driver.model), driver, opts.label, opts.color ?? this.nextColor(), opts.transport);
    if (opts.limits) dev.limits = { ...opts.limits };
    dev.changed.on(() => this.changed.emit());
    dev.events.on((e) => {
      // Keep writes, errors and info; skip the once-a-second poll traffic (IN_* and replies).
      if (e.kind === 'rx' || (e.kind === 'tx' && /^IN_/.test(e.text))) return;
      this.run?.events.push(e);
      this.logged.emit(e);
    });
    this.devices.push(dev);
    this.changed.emit();
    try {
      await dev.connect();
    } catch (e) {
      dev.log('error', `Connect failed: ${(e as Error).message}`);
    }
    this.save();
    if (this.run) this.refreshRunColumns();
    return dev;
  }

  forgetMissing(id: string): void {
    this.missing = this.missing.filter((m) => m.id !== id);
    this.save();
    this.changed.emit();
  }

  /** Reorder: the card order on the page is also the lane order in the chart. */
  moveDevice(dev: DeviceInstance, toIndex: number): void {
    const from = this.devices.indexOf(dev);
    if (from < 0) return;
    const to = Math.max(0, Math.min(this.devices.length - 1, toIndex));
    if (from === to) return;
    this.devices.splice(from, 1);
    this.devices.splice(to, 0, dev);
    this.save();
    this.changed.emit();
  }

  async removeDevice(dev: DeviceInstance): Promise<void> {
    await dev.disconnect(true);
    this.devices.splice(this.devices.indexOf(dev), 1);
    this.save();
    this.changed.emit();
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.devices.filter((d) => d.connected).map((d) => d.stopAll()));
    this.note('Stop all pressed');
  }

  // ----- persistence of the page -----

  save(): void {
    this.config.devices = this.devices.map((d) => {
      const info = d.transport instanceof SerialTransport ? d.transport.port.getInfo() : {};
      return {
        id: d.id,
        model: d.driver.model,
        label: d.label,
        color: d.color,
        sim: d.transport.kind === 'sim',
        usbVendorId: info.usbVendorId,
        usbProductId: info.usbProductId,
        limits: d.limits,
      };
    });
    this.config.devices.push(...this.missing);
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
    } catch {
      /* storage blocked */
    }
  }

  loadSaved(): PageConfig | undefined {
    try {
      const s = localStorage.getItem(CONFIG_KEY);
      return s ? (JSON.parse(s) as PageConfig) : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Restore the saved page. Simulated devices come back directly; real devices are matched to
   * ports this site was already granted (no click needed). Unmatched ones are returned so the UI
   * can offer "Reconnect".
   */
  async restore(): Promise<SavedDevice[]> {
    const cfg = this.loadSaved();
    if (!cfg) return [];
    this.config.name = cfg.name;
    const ports = 'serial' in navigator ? await navigator.serial.getPorts() : [];
    const usedPorts = new Set<SerialPort>();
    const missing: SavedDevice[] = [];
    this.missing = cfg.devices.filter((d) => !d.sim);
    for (const s of cfg.devices) {
      let transport: Transport | undefined;
      if (s.sim) {
        transport = new SimTransport(s.model as 'eurostar60' | 'retControlVisc');
      } else {
        const port = ports.find((p) => {
          const i = p.getInfo();
          return !usedPorts.has(p) && i.usbVendorId === s.usbVendorId && i.usbProductId === s.usbProductId;
        });
        if (port) {
          usedPorts.add(port);
          transport = new SerialTransport(port, getDriver(s.model).serial);
        }
      }
      if (transport) {
        this.missing = this.missing.filter((m) => m.id !== s.id);
        await this.addDevice({ model: s.model, label: s.label, transport, id: s.id, color: s.color, limits: s.limits });
      } else {
        missing.push(s);
      }
    }
    // Keep missing devices in the saved config until the user reconnects or forgets them.
    this.missing = missing;
    this.save();
    this.changed.emit();
    return missing;
  }

  // ----- sampling, chart history, recording -----

  columns(): Column[] {
    const cols: Column[] = [];
    for (const d of this.devices) {
      for (const r of d.driver.readings) {
        cols.push({ key: `${d.id}.${r.key}`, deviceId: d.id, label: `${d.label} ${r.label.toLowerCase()}`, unit: r.unit, kind: 'actual' });
      }
      for (const sp of d.driver.setpoints) {
        cols.push({ key: `${d.id}.sp.${sp.key}`, deviceId: d.id, label: `${d.label} ${sp.label.toLowerCase()} setpoint`, unit: sp.unit, kind: 'setpoint' });
      }
      for (const sw of d.driver.switches) {
        cols.push({ key: `${d.id}.sw.${sw.key}`, deviceId: d.id, label: `${d.label} ${sw.label.toLowerCase()} on`, unit: '0/1', kind: 'switch' });
      }
    }
    return cols;
  }

  private sample(): void {
    const row: Row = { t: Date.now(), v: {} };
    for (const d of this.devices) {
      if (!d.connected) continue;
      for (const [k, v] of Object.entries(d.snapshot.values)) row.v[`${d.id}.${k}`] = v;
      for (const [k, v] of Object.entries(d.snapshot.setpoints)) row.v[`${d.id}.sp.${k}`] = v;
      for (const [k, v] of Object.entries(d.snapshot.switches)) row.v[`${d.id}.sw.${k}`] = v ? 1 : 0;
    }
    this.history.push(row);
    const cutoff = row.t - HISTORY_MS;
    while (this.history.length && this.history[0].t < cutoff) this.history.shift();
    this.run?.rows.push(row);
    this.sampled.emit(row);
  }

  startRun(): void {
    this.run = { startedAt: Date.now(), rows: [], events: [], notes: [], columns: [], devices: [] };
    this.refreshRunColumns();
    this.note('Recording started');
    this.changed.emit();
  }

  private refreshRunColumns(): void {
    if (!this.run) return;
    const have = new Set(this.run.columns.map((c) => c.key));
    for (const c of this.columns()) if (!have.has(c.key)) this.run.columns.push(c);
    for (const d of this.devices) {
      if (!this.run.devices.some((x) => x.id === d.id)) {
        this.run.devices.push({ id: d.id, label: d.label, model: d.driver.model, nameReply: d.nameReply });
      }
    }
  }

  stopRun(): Run | undefined {
    const run = this.run;
    if (!run) return;
    this.note('Recording stopped');
    run.endedAt = Date.now();
    this.run = undefined;
    this.changed.emit();
    return run;
  }

  note(text: string): void {
    const n = { t: Date.now(), text };
    this.run?.notes.push(n);
    this.logged.emit({ t: n.t, deviceId: '', kind: 'info', text: `Note: ${text}` });
  }

  get anyRunning(): boolean {
    return this.devices.some((d) => d.connected && d.running);
  }
}
