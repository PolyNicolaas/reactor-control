import { Emitter } from './emitter';
import { sleep } from './serialTransport';
import { parseNumber, type DeviceDriver, type DeviceSnapshot, type DeviceStatus, type Transport } from './types';

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

  snapshot: DeviceSnapshot = { values: {}, setpoints: {}, switches: {} };
  /** Setpoints sent but not yet confirmed by read-back. */
  pending: Record<string, number> = {};
  connected = false;
  responding = true;
  nameReply = '';
  limits: UserLimits = {};

  private polling = false;
  private failures = 0;

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

  /** Open the transport, check identity, start polling. Returns the IN_NAME reply. */
  async connect(): Promise<string> {
    await this.transport.open();
    this.connected = true;
    const name = (await this.transport.request('IN_NAME', true)) ?? '';
    this.nameReply = name;
    this.log('info', `Identified as "${name}"`);
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
    for (const r of this.driver.readings) {
      if (!this.polling) return;
      this.snapshot.values[r.key] = await read(r.cmd);
    }
    for (const sp of this.driver.setpoints) {
      if (!sp.readCmd || !this.polling) continue;
      const v = await read(sp.readCmd);
      this.snapshot.setpoints[sp.key] = v;
      const want = this.pending[sp.key];
      if (want !== undefined && v !== undefined && Math.abs(v - want) <= sp.tolerance) delete this.pending[sp.key];
    }
    this.failures = ok === 0 && fail > 0 ? this.failures + 1 : 0;
    this.responding = this.failures < 2;
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
    await this.transport.request(`${sp.cmd} ${v}`, false);
    if (!sp.readCmd) delete this.pending[key];
  }

  async setSwitch(key: string, on: boolean): Promise<void> {
    const sw = this.driver.switches.find((s) => s.key === key);
    if (!sw) throw new Error(`No switch ${key}`);
    await this.transport.request(on ? sw.on : sw.off, false);
    this.snapshot.switches[key] = on;
    this.changed.emit(this);
  }

  async stopAll(): Promise<void> {
    for (const cmd of this.driver.stopCommands) {
      try {
        await this.transport.request(cmd, false);
      } catch (e) {
        this.log('error', `${cmd}: ${(e as Error).message}`);
      }
    }
    for (const k of Object.keys(this.snapshot.switches)) this.snapshot.switches[k] = false;
    this.changed.emit(this);
  }

  /** Raw command from the bench terminal. */
  async raw(cmd: string): Promise<string | null> {
    const expect = /^IN_/i.test(cmd.trim());
    return this.transport.request(cmd.trim().toUpperCase(), expect);
  }

  get running(): boolean {
    return Object.values(this.snapshot.switches).some(Boolean);
  }

  async disconnect(release: boolean): Promise<void> {
    this.polling = false;
    if (release && this.connected && this.driver.releaseCommand) {
      try {
        await this.transport.request(this.driver.releaseCommand, false);
      } catch {
        /* ignore */
      }
    }
    this.connected = false;
    await this.transport.close();
    this.changed.emit(this);
  }
}
