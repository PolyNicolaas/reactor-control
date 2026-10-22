import { Emitter } from './emitter';
import { sleep } from './serialTransport';
import { NAMUR, type Protocol } from './protocol';
import { parseNumber, type SerialLink, type DeviceDriver, type DeviceSnapshot, type DeviceStatus, type Transport } from './types';

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
        }
      }
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
    await this.send(on ? sw.on : sw.off);
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
