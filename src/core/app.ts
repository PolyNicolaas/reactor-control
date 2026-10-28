import { DeviceInstance, type DeviceEvent } from './device';
import { Emitter } from './emitter';
import { SerialTransport, transportFor } from './serialTransport';
import { getDriver } from '../modules';
import { detectDriver } from '../modules';
import { probeName, recognises } from './probe';
import { CameraModule, type MediaOut } from '../camera/camera';
import { mediaStore } from '../camera/mediaStore';
import type { SerialLink, Transport } from './types';

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
  link?: SerialLink;
  tares?: Record<string, number>;
  groupLabels?: Record<string, string>;
  /** Safety settings the user changed, by setting key. */
  safety?: Record<string, number>;
  /** Safety rules the user turned on or off, by rule key. */
  rulesOn?: Record<string, boolean>;
  /** Pages saved before 2026-10-26 (keys "plate.<setting>"); read once, then saved as `safety`. */
  interlocks?: Record<string, number>;
  /** Last hot-surface reading, so a reload with the unit unplugged still warns "may be hot". */
  lastHot?: { v: number; t: number };
}

export interface SavedCamera {
  id: string;
  label: string;
  deviceId: string;
}

export interface PageConfig {
  name: string;
  devices: SavedDevice[];
  cameras?: SavedCamera[];
}

/** A camera file in a recording. The file itself is in IndexedDB (mediaStore) under `key`. */
export interface MediaItem {
  t: number;
  end?: number;
  cameraId: string;
  kind: MediaOut['kind'];
  file: string;          // path inside the download, e.g. "clips/camera-1_+000690.0s.webm"
  key: string;           // name in the media store: "<run start ms>/<file>", unique across recordings
  bytes: number;
  reason?: string;
}

export interface Column {
  key: string;          // "<deviceId>.<reading>" or "<deviceId>.sp.<setpoint>"
  deviceId: string;
  label: string;        // "Hotplate probe"
  unit: string;
  kind: 'actual' | 'setpoint' | 'switch' | 'gross';
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
  media: MediaItem[];
}

const CONFIG_KEY = 'reactor-control.page';

/** Safety settings of a saved device, including the older "plate.<setting>" keys. */
export function savedSafety(s: SavedDevice): Record<string, number> | undefined {
  const out: Record<string, number> = { ...(s.safety ?? {}) };
  for (const [k, v] of Object.entries(s.interlocks ?? {})) out[k.replace(/^[^.]+\./, '')] ??= v;
  return Object.keys(out).length ? out : undefined;
}
const HISTORY_MS = 60 * 60 * 1000;

/** App state: devices on the page, a 1 s sampler for chart and recording, the event log. */
export class App {
  readonly devices: DeviceInstance[] = [];
  readonly cameras: CameraModule[] = [];
  /** Media made while not recording (snapshots): handed to the UI to download straight away. */
  readonly looseMedia = new Emitter<{ cam: CameraModule; m: MediaOut }>();
  readonly changed = new Emitter<void>();
  readonly sampled = new Emitter<Row>();
  readonly logged = new Emitter<DeviceEvent>();
  history: Row[] = [];
  /** Saved devices whose port is not available yet (shown as "Reconnect" cards). */
  missing: SavedDevice[] = [];
  run?: Run;
  config: PageConfig = { name: 'Control page', devices: [], cameras: [] };

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
  async addDevice(opts: { model: string; label: string; transport: Transport; id?: string; color?: string; limits?: SavedDevice['limits']; link?: SerialLink; tares?: Record<string, number>; groupLabels?: Record<string, string>; safety?: Record<string, number>; rulesOn?: Record<string, boolean>; lastHot?: { v: number; t: number } }): Promise<DeviceInstance> {
    const driver = getDriver(opts.model);
    const dev = new DeviceInstance(opts.id ?? this.newId(driver.model), driver, opts.label, opts.color ?? this.nextColor(), opts.transport);
    if (opts.limits) dev.limits = { ...opts.limits };
    dev.link = opts.link;
    if (opts.tares) dev.tares = { ...opts.tares };
    if (opts.safety) dev.safetySettings = { ...opts.safety };
    if (opts.rulesOn) dev.rulesOn = { ...opts.rulesOn };
    // Other modules on this page, for safety rules that watch a partner (SafetyRule.withPeer).
    dev.peers = () => this.devices;
    if (opts.lastHot) dev.lastHot = { ...opts.lastHot };
    dev.changed.on(() => this.saveSoon());
    if (opts.groupLabels) dev.groupLabels = { ...opts.groupLabels };
    dev.changed.on(() => this.changed.emit());
    // Changes the unit shows by itself (stirring started, keypad setpoint change) count as changes.
    dev.changes.on((text) => this.change(`${dev.label}: ${text}`));
    dev.events.on((e) => {
      // Keep writes, errors and info; skip the once-a-second poll traffic and all replies.
      if (e.kind === 'rx' || (e.kind === 'tx' && dev.isPollCommand(e.text))) return;
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

  /** The device already using this port, if any (picking it again would cut that device off). */
  portOwner(port: SerialPort): DeviceInstance | undefined {
    return this.devices.find((d) => d.connected && d.transport instanceof SerialTransport && d.transport.port === port);
  }

  /** Stops every connected unit. Returns the units where a stop command failed, and those not connected. */
  async stopAll(): Promise<{ failed: string[]; offline: string[] }> {
    const live = this.devices.filter((d) => d.connected);
    const res = await Promise.all(live.map(async (d) => ({ d, f: await d.stopAll() })));
    const failed = res.filter((r) => r.f.length).map((r) => `${r.d.label} (${r.f.join(', ')})`);
    const offline = this.devices.filter((d) => !d.connected).map((d) => d.label);
    this.note(`Stop all pressed${failed.length ? ` — FAILED on ${failed.join('; ')}` : ''}${offline.length ? ` — not connected: ${offline.join(', ')}` : ''}`);
    return { failed, offline };
  }

  // ----- cameras -----

  async addCamera(label: string, deviceId: string, id?: string): Promise<CameraModule> {
    let n = 1;
    while (!id && this.cameras.some((c) => c.id === `camera-${n}`)) n++;
    const cam = new CameraModule(id ?? `camera-${n}`, label, deviceId);
    cam.changed.on(() => this.changed.emit());
    cam.media.on((m) => void this.onMedia(cam, m));
    this.cameras.push(cam);
    await cam.start();
    if (this.run) {
      this.addRunCamera(cam);
      cam.startRecording();
    }
    this.save();
    this.changed.emit();
    return cam;
  }

  removeCamera(cam: CameraModule): void {
    cam.stop();
    this.cameras.splice(this.cameras.indexOf(cam), 1);
    this.save();
    this.changed.emit();
  }

  private addRunCamera(cam: CameraModule): void {
    if (this.run && !this.run.devices.some((d) => d.id === cam.id)) {
      this.run.devices.push({ id: cam.id, label: cam.label, model: 'camera', nameReply: cam.deviceLabel });
    }
  }

  private async onMedia(cam: CameraModule, m: MediaOut): Promise<void> {
    const run = this.run;
    if (!run) {
      this.looseMedia.emit({ cam, m });
      return;
    }
    const folder = { timelapse: 'timelapse', clip: 'clips', snapshot: 'snapshots' }[m.kind];
    // Time in the run; a clip can start before the run when a change started the recording.
    const secs = (m.t - run.startedAt) / 1000;
    const elapsed = `${secs < 0 ? '-' : '+'}${Math.abs(secs).toFixed(1).padStart(8, '0')}`;
    const file = `${folder}/${cam.id}_${elapsed}s.${m.ext}`;
    const key = `${run.startedAt}/${file}`;
    try {
      await mediaStore.put(key, m.blob);
    } catch (e) {
      this.logged.emit({ t: Date.now(), deviceId: cam.id, kind: 'error', text: `Could not store ${file}: ${(e as Error).message}` });
      return;
    }
    run.media.push({ t: m.t, end: m.end, cameraId: cam.id, kind: m.kind, file, key, bytes: m.blob.size, reason: m.reason });
    if (m.kind !== 'timelapse') {
      const e = { t: Date.now(), deviceId: cam.id, kind: 'info' as const, text: `${m.kind === 'clip' ? 'Clip' : 'Snapshot'} saved: ${file}${m.reason ? ` (${m.reason})` : ''}` };
      run.events.push(e);
      this.logged.emit(e);
    }
  }

  // ----- persistence of the page -----

  private saveTimer?: number;
  private lastTares = '';
  /**
   * Save when tares or the last hot-plate reading change (cheap check; changed fires every poll).
   * The hot reading is saved at most once a minute or per 5 °C, so MAY BE HOT survives a reload (§15).
   */
  private saveSoon(): void {
    const t = JSON.stringify(this.devices.map((d) => [d.tares, d.lastHot ? [Math.round(d.lastHot.v / 5), Math.floor(d.lastHot.t / 60000)] : 0]));
    if (t === this.lastTares) return;
    this.lastTares = t;
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 300);
  }

  save(): void {
    if (this.restoring) return;
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
        link: d.link,
        tares: Object.keys(d.tares).length ? d.tares : undefined,
        groupLabels: Object.keys(d.groupLabels).length ? d.groupLabels : undefined,
        safety: Object.keys(d.safetySettings).length ? d.safetySettings : undefined,
        rulesOn: Object.keys(d.rulesOn).length ? d.rulesOn : undefined,
        lastHot: d.lastHot,
      };
    });
    this.config.devices.push(...this.missing);
    this.config.cameras = this.cameras.map((c) => ({ id: c.id, label: c.label, deviceId: c.deviceId }));
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
  /** True while restore() is re-adding saved units: a save then would drop the ones not yet back. */
  private restoring = false;

  async restore(): Promise<SavedDevice[]> {
    const cfg = this.loadSaved();
    if (!cfg) return [];
    this.restoring = true;
    try {
      return await this.restoreFrom(cfg);
    } finally {
      this.restoring = false;
      this.save();
    }
  }

  private async restoreFrom(cfg: NonNullable<ReturnType<App['loadSaved']>>): Promise<SavedDevice[]> {
    this.config.name = cfg.name;
    // Cameras: the browser remembers camera permission per site, so they come back without a click.
    for (const c of cfg.cameras ?? []) await this.addCamera(c.label, c.deviceId, c.id);
    const ports = 'serial' in navigator ? await navigator.serial.getPorts() : [];
    const usedPorts = new Set<SerialPort>();
    const missing: SavedDevice[] = [];
    this.missing = cfg.devices.filter((d) => !d.sim);
    for (const s of cfg.devices) {
      let transport: Transport | undefined;
      if (s.sim) {
        transport = getDriver(s.model).simulate();
      } else {
        // Identical units share USB ids, so ask each candidate port for its name and only take
        // the one this device's driver recognises (otherwise a saved "stirrer" could grab the hotplate).
        const drv = getDriver(s.model);
        const candidates = ports.filter((p) => {
          const i = p.getInfo();
          return !usedPorts.has(p) && i.usbVendorId === s.usbVendorId && i.usbProductId === s.usbProductId;
        });
        for (const port of candidates) {
          try {
            const r = await probeName(port, undefined, s.link);
            // A blank-named unit is taken only if nothing else on that port identifies as another model.
            const other = [r.name, ...r.ids].map(detectDriver).find((x) => x && x !== drv);
            if (!recognises(drv.identify, r) && !(r.blankName && !other)) continue;
            usedPorts.add(port);
            s.link = r.link;
            transport = transportFor(port, r.link);
            break;
          } catch {
            /* no reply on this port: try the next */
          }
        }
      }
      if (transport) {
        this.missing = this.missing.filter((m) => m.id !== s.id);
        await this.addDevice({ model: s.model, label: s.label, transport, id: s.id, color: s.color, limits: s.limits, link: s.link, tares: s.tares, groupLabels: s.groupLabels, safety: savedSafety(s), rulesOn: s.rulesOn, lastHot: s.lastHot });
      } else {
        missing.push(s);
      }
    }
    // Keep missing devices in the saved config until the user reconnects or forgets them (saved by restore()).
    this.missing = missing;
    this.changed.emit();
    return missing;
  }

  // ----- sampling, chart history, recording -----

  columns(): Column[] {
    const cols: Column[] = [];
    for (const d of this.devices) {
      const name = (spec: { label: string; group?: string }) => `${d.label} ${d.specLabel(spec).toLowerCase()}`;
      for (const r of d.driver.readings) {
        cols.push({ key: `${d.id}.${r.key}`, deviceId: d.id, label: `${name(r)}${r.tareable ? ' net' : ''}`, unit: r.unit, kind: 'actual' });
        if (r.tareable) {
          cols.push({ key: `${d.id}.gross.${r.key}`, deviceId: d.id, label: `${name(r)} gross`, unit: r.unit, kind: 'gross' });
          cols.push({ key: `${d.id}.tare.${r.key}`, deviceId: d.id, label: `${name(r)} tare`, unit: r.unit, kind: 'gross' });
        }
      }
      for (const sp of d.driver.setpoints) {
        cols.push({ key: `${d.id}.sp.${sp.key}`, deviceId: d.id, label: `${name(sp)} setpoint`, unit: sp.unit, kind: 'setpoint' });
      }
      for (const sw of d.driver.switches) {
        cols.push({ key: `${d.id}.sw.${sw.key}`, deviceId: d.id, label: `${name(sw)} on`, unit: '0/1', kind: 'switch' });
      }
    }
    return cols;
  }

  private sample(): void {
    const row: Row = { t: Date.now(), v: {} };
    for (const d of this.devices) {
      if (!d.connected) continue;
      // A reading outside its valid state (e.g. mass while heating) is recorded as blank.
      for (const [k, v] of Object.entries(d.snapshot.values)) row.v[`${d.id}.${k}`] = d.isValid(k) ? v : undefined;
      for (const [k, v] of Object.entries(d.snapshot.gross)) {
        row.v[`${d.id}.gross.${k}`] = d.isValid(k) ? v : undefined;
        row.v[`${d.id}.tare.${k}`] = d.tares[k] ?? 0;
      }
      for (const [k, v] of Object.entries(d.snapshot.setpoints)) row.v[`${d.id}.sp.${k}`] = v;
      for (const [k, v] of Object.entries(d.snapshot.switches)) row.v[`${d.id}.sw.${k}`] = v ? 1 : 0;
    }
    this.history.push(row);
    const cutoff = row.t - HISTORY_MS;
    while (this.history.length && this.history[0].t < cutoff) this.history.shift();
    this.run?.rows.push(row);
    this.sampled.emit(row);
  }

  /** The stopped recording not yet downloaded: its camera files are kept when a new recording starts. */
  undownloaded?: Run;

  startRun(): void {
    this.run = { startedAt: Date.now(), rows: [], events: [], notes: [], columns: [], devices: [], media: [] };
    this.refreshRunColumns();
    void mediaStore.clearExcept(new Set((this.undownloaded?.media ?? []).map((m) => m.key))).catch(() => {});
    for (const cam of this.cameras) {
      this.addRunCamera(cam);
      cam.startRecording();
    }
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

  async stopRun(): Promise<Run | undefined> {
    const run = this.run;
    if (!run) return;
    this.note('Recording stopped');
    // Cameras finish the clip they are capturing before the run closes.
    await Promise.all(this.cameras.map((c) => c.stopRecording()));
    run.endedAt = Date.now();
    this.run = undefined;
    this.undownloaded = run;
    this.changed.emit();
    return run;
  }

  /**
   * A change to the reactor: a setpoint or switch changed on a card, stirring started or stopped,
   * a setpoint changed on the unit. Logged as a note, and every camera saves a clip around it.
   * With a camera on the page and no recording running, the first change starts a recording,
   * so the clip (and the data) are never lost (DESIGN D31).
   */
  change(text: string): void {
    if (!this.run && this.cameras.some((c) => c.status === 'Live')) {
      this.startRun();
      this.note(`Recording started automatically by: ${text}`);
      this.autoStarted.emit(text);
    }
    this.note(text);
  }

  /** Fired when a change started a recording on its own (UI shows it). */
  readonly autoStarted = new Emitter<string>();

  note(text: string): void {
    const n = { t: Date.now(), text };
    this.run?.notes.push(n);
    this.logged.emit({ t: n.t, deviceId: '', kind: 'info', text: `Note: ${text}` });
    // Every change on the page arrives here as a note (setpoints, switches, Stop all, user notes):
    // each one gets a camera clip around it (DESIGN D25).
    if (this.run && !/^Recording (started|stopped)/.test(text)) for (const cam of this.cameras) cam.trigger(text);
  }

  get anyRunning(): boolean {
    return this.devices.some((d) => d.connected && d.running);
  }
}
