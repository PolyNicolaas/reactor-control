import { Emitter } from './emitter';
import { sleep } from './serialTransport';
import { NAMUR, type Protocol } from './protocol';
import { parseNumber, type SetpointSpec, type Tracking, type SerialLink, type DeviceDriver, type DeviceSnapshot, type DeviceStatus, type Transport } from './types';

export interface DeviceEvent {
  t: number;              // epoch ms
  deviceId: string;
  kind: 'tx' | 'rx' | 'info' | 'error';
  text: string;
}

export interface UserLimits {
  [setpointKey: string]: number | undefined; // user max per setpoint, inside the driver range
}

/**
 * One connected unit: its driver, transport, poll loop and latest values.
 * Polling runs sequentially through the transport's queue; writes go through the same queue.
 */
export class DeviceInstance {
  readonly changed = new Emitter<DeviceInstance>();
  readonly events = new Emitter<DeviceEvent>();
  /**
   * Changes the unit itself shows, found by polling: activity starting/stopping (stirring) and
   * setpoints changed outside this page's card (unit keypad, bench terminal). Text without the
   * device label, e.g. "stirring started (speed 210 rpm)".
   */
  readonly changes = new Emitter<string>();
  private active: Record<string, boolean | undefined> = {};
  /** Value last applied from this page per setpoint (the unit may drop it, e.g. on start). */
  intended: Record<string, number> = {};
  private switchedOnAt: Record<string, number> = {};
  private actualHist: Record<string, { t: number; v: number }[]> = {};
  private lastWrite: Record<string, number> = {};

  snapshot: DeviceSnapshot = { values: {}, gross: {}, setpoints: {}, switches: {} };
  /** Software tare offsets per tareable reading (device units). */
  tares: Record<string, number> = {};
  /** Optional readings the device is not answering right now (see ReadingSpec.optional). */
  missing: Record<string, boolean> = {};
  private retryAt: Record<string, number> = {};
  private recent: Record<string, number[]> = {};
  /** Setpoints sent but not yet confirmed by read-back. */
  pending: Record<string, number> = {};
  connected = false;
  responding = true;
  nameReply = '';
  limits: UserLimits = {};
  /** Serial settings found when connecting, if they differ from the driver's defaults. */
  link?: SerialLink;
  /** User names for the driver's groups, e.g. pump channel 1 -> "Reagent A". */
  groupLabels: Record<string, string> = {};
  /** User overrides of interlock settings, keyed "<interlock>.<setting>". */
  interlockSettings: Record<string, number> = {};
  /** Latched interlock trips: interlock key -> reason. Cleared only by resetInterlock(). */
  tripped: Record<string, string> = {};
  /** Fires with "<label>: <reason>" when an interlock trips (for an alarm in the UI). */
  readonly tripped$ = new Emitter<string>();
  private interlockMem: Record<string, Record<string, unknown>> = {};
  /** Last reading of the driver's `hot` key and when it was taken (survives a disconnect). */
  lastHot?: { v: number; t: number };
  private lastOffSent: Record<string, number> = {};

  private polling = false;
  private failures = 0;
  private cycle = 0;
  private lastPoll = 0;

  constructor(
    readonly id: string,
    readonly driver: DeviceDriver,
    public label: string,
    public color: string,
    public transport: Transport,
    public pollMs = 1000,
  ) {
    for (const sw of driver.switches) this.snapshot.switches[sw.key] = false;
    this.attach(transport);
  }

  private attach(t: Transport): void {
    t.onLog = (dir, text) => this.log(dir, text);
    t.onDisconnect = () => {
      this.connected = false;
      this.polling = false;
      this.log('error', 'Connection lost');
      this.changed.emit(this);
    };
  }

  get protocol(): Protocol {
    return this.driver.protocol ?? NAMUR;
  }

  groupLabel(key?: string): string | undefined {
    if (!key) return undefined;
    return this.groupLabels[key] || this.driver.groups?.find((g) => g.key === key)?.label;
  }

  /** "Flow" -> "Ch 1 flow" for grouped specs; used by chart legends and CSV columns. */
  specLabel(spec: { label: string; group?: string }): string {
    const g = this.groupLabel(spec.group);
    return g ? `${g} ${spec.label.toLowerCase()}` : spec.label;
  }

  /** Commands the poll loop sends (kept out of the event log). */
  isPollCommand(cmd: string): boolean {
    if (cmd === this.protocol.identifyCmd) return true;
    return this.driver.readings.some((r) => r.cmd === cmd) || this.driver.setpoints.some((sp) => sp.readCmd === cmd);
  }

  get status(): DeviceStatus {
    if (!this.connected) return 'Disconnected';
    if (!this.responding) return 'No reply';
    if (Object.keys(this.tripped).length) return 'Interlock';
    return this.driver.status(this.snapshot);
  }

  private lastError = { text: '', t: 0 };

  log(kind: DeviceEvent['kind'], text: string): void {
    if (kind === 'error') {
      // The same error every poll cycle is one event, not one per second.
      const now = Date.now();
      if (text === this.lastError.text && now - this.lastError.t < 30000) return;
      this.lastError = { text, t: now };
    }
    this.events.emit({ t: Date.now(), deviceId: this.id, kind, text });
  }

  /** Open the transport, check identity, run the driver's init commands, start polling. Returns the name reply. */
  async connect(): Promise<string> {
    await this.transport.open();
    this.connected = true;
    const name = (await this.transport.request(this.protocol.identifyCmd, true)) ?? '';
    this.nameReply = name;
    this.log('info', `Identified as "${name}"`);
    for (const cmd of this.driver.initCommands ?? []) {
      try {
        await this.send(cmd);
      } catch (e) {
        this.log('error', `Setup ${cmd}: ${(e as Error).message}`);
      }
    }
    this.lastPoll = performance.now();
    this.startPolling();
    this.changed.emit(this);
    return name;
  }

  async replaceTransport(t: Transport): Promise<string> {
    await this.disconnect(false);
    this.transport = t;
    this.attach(t);
    return this.connect();
  }

  startPolling(): void {
    if (this.polling) return;
    this.polling = true;
    void this.pollLoop();
  }

  private async pollLoop(): Promise<void> {
    while (this.polling && this.connected) {
      const start = performance.now();
      await this.pollOnce();
      this.changed.emit(this);
      await sleep(Math.max(0, this.pollMs - (performance.now() - start)));
    }
  }

  private async pollOnce(): Promise<void> {
    const prevSetpoints = { ...this.snapshot.setpoints };
    const parse = this.driver.parse ?? parseNumber;
    let ok = 0;
    let fail = 0;
    const read = async (cmd: string) => {
      try {
        const r = await this.transport.request(cmd, true);
        ok++;
        return r === null ? undefined : parse(r);
      } catch (e) {
        fail++;
        this.log('error', (e as Error).message);
        return undefined;
      }
    };
    const cycle = this.cycle++;
    for (const r of this.driver.readings) {
      if (!this.polling) return;
      if (!r.cmd || (r.everyN && cycle % r.everyN !== 0)) continue;
      let v: number | undefined;
      if (r.optional) {
        // Not answering is expected until the user acts on the unit: no error, retry slowly.
        if (!this.isValid(r.key) || Date.now() < (this.retryAt[r.key] ?? 0)) {
          v = undefined;
        } else {
          try {
            const reply = await this.transport.request(r.cmd, true);
            v = reply === null ? undefined : parse(reply);
            if (v === 0 && r.optional.zeroMeansMissing) v = undefined;
          } catch {
            v = undefined;
          }
          if (v === undefined) this.retryAt[r.key] = Date.now() + r.optional.retryMs;
          if (v === undefined && !this.missing[r.key]) this.log('info', `${r.label}: no reading (${r.optional.missingNote})`);
          if (v !== undefined && this.missing[r.key]) this.log('info', `${r.label}: reading available`);
        }
        this.missing[r.key] = v === undefined;
      } else {
        v = await read(r.cmd);
      }
      if (r.stable) {
        const h = (this.recent[r.key] ??= []);
        if (v === undefined) h.length = 0;
        else {
          h.push(v);
          if (h.length > r.stable.count) h.shift();
        }
      }
      if (r.tareable) {
        this.snapshot.gross[r.key] = v;
        this.snapshot.values[r.key] = v === undefined ? undefined : v - (this.tares[r.key] ?? 0);
      } else {
        this.snapshot.values[r.key] = v;
      }
    }
    for (const sp of this.driver.setpoints) {
      if (!sp.readCmd || !this.polling) continue;
      const v = await read(sp.readCmd);
      this.snapshot.setpoints[sp.key] = v;
      const want = this.pending[sp.key];
      if (want !== undefined && v !== undefined && Math.abs(v - want) <= Math.max(sp.tolerance, (sp.toleranceRel ?? 0) * Math.abs(want))) {
        delete this.pending[sp.key];
      }
    }
    this.failures = ok === 0 && fail > 0 ? this.failures + 1 : 0;
    this.responding = this.failures < 2;
    const now = performance.now();
    const dt = (now - this.lastPoll) / 1000;
    this.lastPoll = now;
    if (this.driver.derive && this.responding) {
      const before = { ...this.snapshot.switches };
      this.driver.derive(this.snapshot, dt);
      for (const sw of this.driver.switches) {
        if (before[sw.key] && !this.snapshot.switches[sw.key]) {
          this.log('error', `${this.specLabel(sw)} stopped on the unit itself (keypad, overload or end of a dose)`);
          this.changes.emit(`${this.specLabel(sw).toLowerCase()} stopped on the unit`);
        }
      }
    }
    if (this.responding) {
      const t = Date.now();
      const hv = this.driver.hot ? this.snapshot.values[this.driver.hot.key] : undefined;
      if (hv !== undefined) this.lastHot = { v: hv, t };
      for (const sp of this.driver.setpoints) {
        const v = sp.actualKey ? this.snapshot.values[sp.actualKey] : undefined;
        if (v === undefined) continue;
        const hh = (this.actualHist[sp.key] ??= []);
        hh.push({ t, v });
        while (hh.length && t - hh[0].t > 120_000) hh.shift();
      }
      await this.checkInterlocks();
      this.detectChanges(prevSetpoints);
    }
  }

  /** Settings for one interlock: the driver defaults with the user's overrides on top. */
  interlockValues(key: string): Record<string, number> {
    const il = this.driver.interlocks?.find((x) => x.key === key);
    const out: Record<string, number> = {};
    for (const st of il?.settings ?? []) out[st.key] = this.interlockSettings[`${key}.${st.key}`] ?? st.default;
    return out;
  }

  /**
   * Run every interlock against the latest readings. A trip switches its functions off (whatever state
   * the app thinks they are in, since the keypad may have turned them on) and latches. While the
   * condition lasts, the off command is repeated every 5 s in case someone turns it back on at the unit.
   */
  private async checkInterlocks(): Promise<void> {
    const now = Date.now();
    for (const il of this.driver.interlocks ?? []) {
      const mem = (this.interlockMem[il.key] ??= {});
      const reason = il.check(this.snapshot, this.interlockValues(il.key), mem, now);
      if (!reason) continue;
      const fresh = !this.tripped[il.key];
      if (!fresh && now - (this.lastOffSent[il.key] ?? 0) < 5000) continue;
      if (fresh) this.tripped[il.key] = reason;
      this.lastOffSent[il.key] = now;
      for (const key of il.switches) {
        const sw = this.driver.switches.find((x) => x.key === key);
        if (!sw) continue;
        try {
          await this.send(sw.off);
        } catch (e) {
          this.log('error', `Interlock could not send ${sw.off}: ${(e as Error).message}`);
        }
        this.snapshot.switches[key] = false;
      }
      if (fresh) {
        const names = il.switches.map((k) => this.driver.switches.find((x) => x.key === k)?.label ?? k).join(', ').toLowerCase();
        this.log('error', `INTERLOCK: ${names} off. ${reason}`);
        this.changes.emit(`interlock tripped, ${names} off: ${reason}`);
        this.tripped$.emit(`${this.label}: ${reason}`);
      }
    }
  }

  /** The interlock's private memory (e.g. a learned steady gap), for describe(). */
  interlockMemory(key: string): Record<string, unknown> | undefined {
    return this.interlockMem[key];
  }

  /**
   * HOT state for the card: 'hot' while the reading is at or above the threshold, 'maybe' when the unit is
   * not answering and the last reading was hot, else undefined.
   */
  get hotState(): { state: 'hot' | 'maybe'; v: number; t: number } | undefined {
    const hot = this.driver.hot;
    if (!hot || !this.lastHot || this.lastHot.v < hot.above) return undefined;
    const live = this.connected && this.responding && this.snapshot.values[hot.key] !== undefined;
    // A plate last seen hot over an hour ago has cooled; stop warning.
    if (!live && Date.now() - this.lastHot.t > 60 * 60_000) return undefined;
    return { state: live ? 'hot' : 'maybe', ...this.lastHot };
  }

  /** Interlocks that lock out this switch right now. */
  lockedBy(switchKey: string): string | undefined {
    for (const il of this.driver.interlocks ?? []) {
      if (il.switches.includes(switchKey) && this.tripped[il.key]) return this.tripped[il.key];
    }
    return undefined;
  }

  /** Band within which the actual counts as "at setpoint". */
  static band(sp: SetpointSpec, set: number): number {
    if (sp.band !== undefined) return sp.band;
    return sp.unit === '°C' ? 2 : Math.max(5, Math.abs(set) * 0.03);
  }

  /**
   * Set value vs actual for one setpoint, as one line for the card. Tells the user plainly when the
   * function is on but the actual is not going to the set value, and when the unit's set value is not
   * what was last applied here (the EUROSTAR can come back from Motor off with no speed until Apply).
   */
  tracking(key: string, now = Date.now()): Tracking {
    const sp = this.driver.setpoints.find((x) => x.key === key);
    if (!sp) return { state: 'unknown', text: '' };
    const set = this.snapshot.setpoints[key];
    const intended = this.intended[key];
    const actual = sp.actualKey ? this.snapshot.values[sp.actualKey] : undefined;
    const on = sp.switchKey ? this.snapshot.switches[sp.switchKey] : true;
    const swLabel = this.driver.switches.find((x) => x.key === sp.switchKey)?.label ?? 'It';
    const u = sp.unit;
    const f = (v: number | undefined, d = sp.decimals) => (v === undefined ? '—' : v.toFixed(d));
    const base = { set, intended, actual };
    const mismatch = intended !== undefined && set !== undefined &&
      Math.abs(set - intended) > Math.max(sp.tolerance, (sp.toleranceRel ?? 0) * Math.abs(intended)) &&
      this.pending[key] === undefined;
    if (mismatch) {
      return { ...base, state: 'mismatch', text: `Unit is set to ${f(set)} ${u}, not the ${f(intended)} ${u} you applied. Apply again to send it.` };
    }
    if (!on) return { ...base, state: 'off', text: `${swLabel} off · set ${f(set)} ${u} · actual ${f(actual, actual !== undefined && u === '°C' ? 1 : 0)} ${u}` };
    if (set === undefined || actual === undefined) return { ...base, state: 'unknown', text: `Set ${f(set)} ${u} · actual ${f(actual)} ${u}` };
    const band = DeviceInstance.band(sp, set);
    const a = f(actual, u === '°C' ? 1 : 0);
    if (Math.abs(actual - set) <= band) return { ...base, state: 'ok', text: `Set ${f(set)} ${u} · actual ${a} ${u} ✓` };
    const grace = (sp.graceS ?? 8) * 1000;
    const since = Math.max(this.switchedOnAt[sp.switchKey ?? ''] ?? 0, this.lastWrite[key] ?? 0);
    const dir = set > actual ? 'rising' : 'falling';
    // A heater cannot cool: above the set value it can only wait.
    if (u === '°C' && actual > set) return { ...base, state: 'moving', text: `Set ${f(set)} ${u} · actual ${a} ${u}, above set (cooling)` };
    if (now - since < grace) return { ...base, state: 'moving', text: `Set ${f(set)} ${u} · actual ${a} ${u}, ${dir}…` };
    // Moving toward the set value over the grace window?
    const hh = this.actualHist[key] ?? [];
    const old = [...hh].reverse().find((x) => now - x.t >= grace);
    const progress = old ? Math.abs(old.v - set) - Math.abs(actual - set) : 0;
    if (old && progress > Math.max(band / 4, 0.2)) return { ...base, state: 'moving', text: `Set ${f(set)} ${u} · actual ${a} ${u}, ${dir}…` };
    return { ...base, state: 'stuck', text: `${swLabel} is on but ${sp.label.toLowerCase()} is ${a} ${u}, not ${f(set)} ${u}. Not ${dir === 'rising' ? 'getting there' : 'coming down'}; apply the setpoint again or check the unit.` };
  }

  /** Clear a trip. Refused (throws) while the condition is still present. */
  resetInterlock(key: string): void {
    const il = this.driver.interlocks?.find((x) => x.key === key);
    if (!il || !this.tripped[key]) return;
    // Check against a copy of the history, so a reset attempt does not add a sample.
    const mem = this.interlockMem[key] ?? {};
    const copy = { ...mem, h: [...((mem.h as unknown[]) ?? [])] };
    const still = il.check(this.snapshot, this.interlockValues(key), copy, Date.now());
    if (still) throw new Error(`Cannot reset yet: ${still}`);
    delete this.tripped[key];
    this.log('info', `Interlock reset by user (was: ${il.label})`);
    this.changed.emit(this);
  }

  /** Report activity crossing its threshold and setpoints changed outside the card. */
  private detectChanges(prevSetpoints: Record<string, number | undefined>): void {
    for (const r of this.driver.readings) {
      if (!r.activity) continue;
      const v = this.snapshot.values[r.key];
      if (v === undefined) continue;
      const now = v > r.activity.above;
      const was = this.active[r.key];
      this.active[r.key] = now;
      if (was === undefined || was === now) continue;
      this.changes.emit(`${r.activity.name} ${now ? 'started' : 'stopped'} (${this.specLabel(r).toLowerCase()} ${Math.round(v)} ${r.unit})`);
    }
    const t = Date.now();
    for (const sp of this.driver.setpoints) {
      const before = prevSetpoints[sp.key];
      const after = this.snapshot.setpoints[sp.key];
      if (before === undefined || after === undefined) continue;
      if (Math.abs(after - before) <= Math.max(sp.tolerance, (sp.toleranceRel ?? 0) * Math.abs(before))) continue;
      if (this.pending[sp.key] !== undefined || t - (this.lastWrite[sp.key] ?? 0) < 3000) continue; // our own write
      this.changes.emit(`${this.specLabel(sp).toLowerCase()} setpoint changed on the unit: ${before} → ${after} ${sp.unit}`);
    }
  }

  /** Send a write. For acknowledged protocols, wait for the reply and throw if it was refused. */
  private async send(cmd: string): Promise<void> {
    const p = this.protocol;
    if (!p.acked) {
      await this.transport.request(cmd, false);
      return;
    }
    p.checkAck(cmd, await this.transport.request(cmd, true));
  }

  /** True when a reading can be trusted right now (see ReadingSpec.validWhen). */
  isValid(key: string): boolean {
    const r = this.driver.readings.find((x) => x.key === key);
    return !r?.validWhen || r.validWhen(this.snapshot);
  }

  /** True when a reading with a `stable` rule has settled (always true for other readings). */
  isStable(key: string): boolean {
    const r = this.driver.readings.find((x) => x.key === key);
    if (!r?.stable) return true;
    const h = this.recent[key] ?? [];
    return h.length >= r.stable.count && Math.max(...h) - Math.min(...h) <= r.stable.span;
  }

  /** Set the tare to the current gross value. Throws with a readable message if it cannot. */
  tare(key: string): number {
    const r = this.driver.readings.find((x) => x.key === key && x.tareable);
    if (!r) throw new Error(`${key} cannot be tared`);
    if (!this.isValid(key)) throw new Error(r.invalidNote ?? `${r.label} is not available right now`);
    const g = this.snapshot.gross[key];
    if (g === undefined) throw new Error(r.optional?.missingNote ?? `No ${r.label.toLowerCase()} reading from the device yet`);
    if (!this.isStable(key)) throw new Error(`${r.label} is still settling. Tare when it is steady.`);
    this.tares[key] = g;
    this.snapshot.values[key] = 0;
    this.log('info', `${r.label} tared at ${g} ${r.unit} (gross)`);
    this.changed.emit(this);
    return g;
  }

  clearTare(key: string): void {
    const r = this.driver.readings.find((x) => x.key === key);
    delete this.tares[key];
    const g = this.snapshot.gross[key];
    this.snapshot.values[key] = g;
    this.log('info', `${r?.label ?? key} tare cleared`);
    this.changed.emit(this);
  }

  /** Clamp to driver range and user limit. Throws with a readable message if out of range. */
  checkSetpoint(key: string, value: number): number {
    const sp = this.driver.setpoints.find((s) => s.key === key);
    if (!sp) throw new Error(`No setpoint ${key}`);
    if (!Number.isFinite(value)) throw new Error('Enter a number');
    const max = Math.min(sp.max, this.limits[key] ?? sp.max);
    if (value < sp.min || value > max) {
      throw new Error(`${sp.label} must be ${sp.min}–${max} ${sp.unit}${max < sp.max ? ' (your limit)' : ''}`);
    }
    return Number(value.toFixed(sp.decimals));
  }

  async setSetpoint(key: string, value: number): Promise<void> {
    const v = this.checkSetpoint(key, value);
    const sp = this.driver.setpoints.find((s) => s.key === key)!;
    this.pending[key] = v;
    this.intended[key] = v;
    this.lastWrite[key] = Date.now();
    this.changed.emit(this);
    try {
      await this.send(this.driver.formatSetpoint ? this.driver.formatSetpoint(sp, v) : `${sp.cmd} ${v}`);
    } catch (e) {
      delete this.pending[key];
      this.changed.emit(this);
      throw e;
    }
    if (!sp.readCmd) delete this.pending[key];
  }

  async setSwitch(key: string, on: boolean): Promise<void> {
    const sw = this.driver.switches.find((s) => s.key === key);
    if (!sw) throw new Error(`No switch ${key}`);
    if (on) {
      const lock = this.lockedBy(key);
      if (lock) throw new Error(`${sw.label} is locked out by the interlock: ${lock}. Reset it on the card first.`);
    }
    await this.send(on ? sw.on : sw.off);
    if (on && !this.snapshot.switches[key]) this.switchedOnAt[key] = Date.now();
    this.snapshot.switches[key] = on;
    this.changed.emit(this);
  }

  async stopAll(): Promise<void> {
    for (const cmd of this.driver.stopCommands) {
      try {
        await this.send(cmd);
      } catch (e) {
        this.log('error', `${cmd}: ${(e as Error).message}`);
      }
    }
    for (const k of Object.keys(this.snapshot.switches)) this.snapshot.switches[k] = false;
    this.changed.emit(this);
  }

  /** Tidy a typed command: trim, and upper-case it unless the protocol is case-sensitive. */
  normalize(cmd: string): string {
    return this.protocol.caseSensitive ? cmd.trim() : cmd.trim().toUpperCase();
  }

  /** Raw command from the bench terminal. */
  async raw(cmd: string): Promise<string | null> {
    const c = this.normalize(cmd);
    return this.transport.request(c, this.protocol.expectsReply(c));
  }

  get running(): boolean {
    return Object.values(this.snapshot.switches).some(Boolean);
  }

  async disconnect(release: boolean): Promise<void> {
    this.polling = false;
    if (release && this.connected) {
      // Removing a unit from the page stops it before handing it back to local control.
      for (const cmd of [...this.driver.stopCommands, ...(this.driver.releaseCommand ? [this.driver.releaseCommand] : [])]) {
        try {
          await this.send(cmd);
        } catch {
          /* ignore */
        }
      }
    }
    this.connected = false;
    await this.transport.close();
    this.changed.emit(this);
  }
}
