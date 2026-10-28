import { Emitter } from './emitter';
import { sleep } from './serialTransport';
import { NAMUR, type Protocol } from './protocol';
import { parseNumber, type PeerView, type RuleContext, type RuleStatus, type Sample, type SafetyRule, type SetpointSpec, type Tracking, type SerialLink, type DeviceDriver, type DeviceSnapshot, type DeviceStatus, type Transport } from './types';

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
  /** User overrides of safety settings, keyed by setting key (unique within the module). */
  safetySettings: Record<string, number> = {};
  /** Rules the user turned on or off, overriding the rule's default (SafetyRule.defaultOn). */
  rulesOn: Record<string, boolean> = {};
  /** Latched safety trips: rule key -> reason. Cleared only by resetSafety(). */
  tripped: Record<string, string> = {};
  /** Live status of every safety rule, refreshed after each poll. */
  ruleStatus: Record<string, RuleStatus> = {};
  /** Fires with "<label>: <reason>" when a safety rule trips (for an alarm in the UI). */
  readonly tripped$ = new Emitter<string>();
  /** Other modules on the same page (set by the App). Rules with `withPeer` read them. */
  peers: () => DeviceInstance[] = () => [];
  /** This unit's recent polls, for safety rules (ModuleSafety.historyS). */
  history: Sample[] = [];
  private ruleMem: Record<string, Record<string, unknown>> = {};
  private armedWith: Record<string, string> = {};
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
    // Only channel groups (pump channels) prefix labels; "Heating probe" would just be noise.
    const isChannel = this.driver.groups?.find((x) => x.key === spec.group)?.channel;
    const g = isChannel ? this.groupLabel(spec.group) : undefined;
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
    if (Object.keys(this.tripped).length) return 'Safety stop';
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
    let name: string;
    try {
      name = (await this.transport.request(this.protocol.identifyCmd, true)) ?? '';
    } catch (e) {
      // Not identified: do not look connected (it would never be polled, so no safety rule would run).
      this.connected = false;
      await this.transport.close().catch(() => {});
      this.changed.emit(this);
      throw e;
    }
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

  /** Bumped whenever a poll loop starts, so a loop still asleep from before a reconnect ends instead of running twice. */
  private loopGen = 0;

  startPolling(): void {
    if (this.polling) return;
    this.polling = true;
    void this.pollLoop(++this.loopGen);
  }

  private async pollLoop(gen: number): Promise<void> {
    while (gen === this.loopGen && this.polling && this.connected) {
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
        if (r !== null && !this.protocol.replyFits(cmd, r)) {
          this.transport.resync?.();
          throw new Error(`Reply "${r}" does not belong to ${cmd}; dropped`);
        }
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
            if (reply !== null && !this.protocol.replyFits(r.cmd, reply)) {
              this.transport.resync?.();
              throw new Error('reply out of step');
            }
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
      const hs = this.driver.safety?.historyS ?? 0;
      if (hs > 0) {
        this.history.push({ t, values: { ...this.snapshot.values }, setpoints: { ...this.snapshot.setpoints }, switches: { ...this.snapshot.switches } });
        while (this.history.length && t - this.history[0].t > (hs + 5) * 1000) this.history.shift();
      }
      await this.checkSafety();
      this.detectChanges(prevSetpoints);
    }
  }

  /** This module's safety settings: driver defaults with the user's overrides on top. */
  safetyValues(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.driver.safety?.rules ?? []) {
      for (const st of r.settings ?? []) out[st.key] = this.safetySettings[st.key] ?? st.default;
    }
    return out;
  }

  /** Read-only view of this unit for other modules' rules. */
  peerView(): PeerView {
    return {
      id: this.id,
      label: this.label,
      model: this.driver.model,
      displayName: this.driver.displayName,
      provides: this.driver.provides ?? [],
      live: this.connected && this.responding,
      snapshot: this.snapshot,
      history: this.history,
      active: (name) =>
        this.driver.readings.some((r) => r.activity?.name === name && (this.snapshot.values[r.key] ?? 0) > r.activity.above),
    };
  }

  private context(rule: SafetyRule, now: number, mem = (this.ruleMem[rule.key] ??= {})): RuleContext {
    const peers = rule.withPeer
      ? this.peers().filter((p) => p !== this && (p.driver.provides ?? []).includes(rule.withPeer!)).map((p) => p.peerView())
      : [];
    return { s: this.snapshot, history: this.history, set: this.safetyValues(), mem, now, peers };
  }

  /** Evaluate one rule. Rules with `withPeer` are idle while no such module is on the page. */
  private evaluate(rule: SafetyRule, now: number, mem?: Record<string, unknown>): RuleStatus {
    const ctx = this.context(rule, now, mem);
    if (rule.withPeer && !ctx.peers.length) return { state: 'idle', text: `Armed when a module that provides "${rule.withPeer}" is on this page` };
    return rule.evaluate(ctx);
  }

  /**
   * Run every safety rule against the latest readings. A trip switches its functions off (whatever state
   * the app thinks they are in, since the keypad may have turned them on) and latches. While the
   * condition lasts, the off command is repeated every 5 s in case someone turns it back on at the unit.
   * Rules that watch other modules are armed and disarmed as those modules join or leave the page.
   */
  private async checkSafety(): Promise<void> {
    const now = Date.now();
    for (const rule of this.driver.safety?.rules ?? []) {
      if (rule.withPeer) {
        const with_ = this.peers().filter((p) => p !== this && (p.driver.provides ?? []).includes(rule.withPeer!)).map((p) => p.label).join(', ');
        if (with_ !== (this.armedWith[rule.key] ?? '')) {
          this.log('info', with_ ? `Safety rule "${rule.label}" armed (with ${with_})` : `Safety rule "${rule.label}" disarmed (no ${rule.withPeer} on the page)`);
          this.armedWith[rule.key] = with_;
        }
      }
      if (!this.isRuleOn(rule)) {
        this.ruleStatus[rule.key] = { state: 'off', text: 'Turned off' };
        continue;
      }
      let st: RuleStatus;
      try {
        st = this.evaluate(rule, now);
      } catch (e) {
        st = { state: 'trip', text: `Rule failed: ${(e as Error).message}` }; // a broken rule fails safe
      }
      this.ruleStatus[rule.key] = st;
      if (st.state !== 'trip') continue;
      const reason = st.text;
      const fresh = !this.tripped[rule.key];
      if (!fresh && now - (this.lastOffSent[rule.key] ?? 0) < 5000) continue;
      if (fresh) this.tripped[rule.key] = reason;
      this.lastOffSent[rule.key] = now;
      for (const key of rule.switches) {
        const sw = this.driver.switches.find((x) => x.key === key);
        if (!sw) continue;
        try {
          await this.send(sw.off);
          this.snapshot.switches[key] = false;
        } catch (e) {
          // Keep showing it on: it may still be on. Sent again every 5 s while the trip lasts.
          this.log('error', `Safety stop could not send ${sw.off}: ${(e as Error).message}`);
        }
      }
      if (fresh) {
        const names = [...new Set(rule.switches.map((k) => this.driver.switches.find((x) => x.key === k)?.label ?? k))].join(', ').toLowerCase();
        this.log('error', `SAFETY STOP (${rule.label}): ${names} off. ${reason}`);
        this.changes.emit(`safety stop "${rule.label}", ${names} off: ${reason}`);
        this.tripped$.emit(`${this.label} — ${rule.label}: ${reason}`);
      }
    }
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

  /** Whether a rule is on: required rules always; otherwise the user's choice or the rule's default. */
  isRuleOn(rule: SafetyRule): boolean {
    return rule.required || (this.rulesOn[rule.key] ?? rule.defaultOn ?? true);
  }

  /** Turn a rule on or off. Required rules cannot be turned off, and a tripped rule must be reset first. */
  setRuleOn(key: string, on: boolean): void {
    const rule = this.driver.safety?.rules.find((r) => r.key === key);
    if (!rule) throw new Error(`No safety rule ${key}`);
    if (!on && rule.required) throw new Error(`"${rule.label}" cannot be turned off`);
    if (!on && this.tripped[key]) throw new Error(`"${rule.label}" has tripped; reset the safety stop before turning it off`);
    if (on === (rule.defaultOn ?? true)) delete this.rulesOn[key];
    else this.rulesOn[key] = on;
    this.log('info', `Safety rule "${rule.label}" turned ${on ? 'on' : 'off'}`);
    if (!on) this.ruleStatus[key] = { state: 'off', text: 'Turned off' };
    this.changed.emit(this);
  }

  /** Change one safety setting (clamped to its range). Returns the value now in use. */
  setSafetySetting(key: string, value: number): number {
    const st = this.driver.safety?.rules.flatMap((r) => r.settings ?? []).find((x) => x.key === key);
    if (!st) throw new Error(`No safety setting ${key}`);
    if (!Number.isFinite(value)) throw new Error('Enter a number');
    const v = Math.min(st.max, Math.max(st.min, value));
    if (v === st.default) delete this.safetySettings[key];
    else this.safetySettings[key] = v;
    this.changed.emit(this);
    return v;
  }

  /** A rule's note with {setting} placeholders filled in from this module's settings. */
  fillNote(text: string): string {
    const set = this.safetyValues();
    return text.replace(/\{(\w+)\}/g, (_, k) => (k in set ? String(set[k]) : `{${k}}`));
  }

  /**
   * Rules on OTHER modules of this page that watch this one (their withPeer is something this module
   * provides), with their live state. Shown on this card as "Watched by".
   */
  watchedBy(): { dev: DeviceInstance; rule: SafetyRule; on: boolean; status?: RuleStatus; note: string }[] {
    const mine = this.driver.provides ?? [];
    const out: { dev: DeviceInstance; rule: SafetyRule; on: boolean; status?: RuleStatus; note: string }[] = [];
    for (const other of this.peers()) {
      if (other === this) continue;
      for (const rule of other.driver.safety?.rules ?? []) {
        if (!rule.withPeer || !mine.includes(rule.withPeer)) continue;
        out.push({ dev: other, rule, on: other.isRuleOn(rule), status: other.ruleStatus[rule.key], note: other.fillNote(rule.watchNote ?? rule.why) });
      }
    }
    return out;
  }

  /**
   * Rules on other modules that would act if this switch were turned off now: they watch an activity
   * this switch drives, are on, and are currently watching (active or close).
   */
  watchersOfSwitch(switchKey: string): { dev: DeviceInstance; rule: SafetyRule; note: string }[] {
    const acts = this.driver.readings.filter((r) => r.activity?.switchKey === switchKey).map((r) => r.activity!.name);
    if (!acts.length) return [];
    return this.watchedBy()
      .filter((w) => w.on && w.rule.watchesActivity && acts.includes(w.rule.watchesActivity) && (w.status?.state === 'ok' || w.status?.state === 'near'))
      .map(({ dev, rule, note }) => ({ dev, rule, note }));
  }

  /** The safety trip that locks out this switch right now, if any. */
  lockedBy(switchKey: string): string | undefined {
    for (const r of this.driver.safety?.rules ?? []) {
      if (r.switches.includes(switchKey) && this.tripped[r.key]) return this.tripped[r.key];
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
   * what was last applied here (the EUROSTAR can come back from Motor off with no speed until Set is pressed again).
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
      return { ...base, state: 'mismatch', text: `Unit is set to ${f(set)} ${u}, not the ${f(intended)} ${u} you applied. Press Set again to send it.` };
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

  /** Clear all trips. Refused (throws) while any tripped rule still trips. */
  resetSafety(): void {
    const now = Date.now();
    const trippedRules = (this.driver.safety?.rules ?? []).filter((r) => this.tripped[r.key]);
    const check = (r: SafetyRule) => {
      // Check on a copy of the rule's memory, so a reset attempt changes nothing.
      const st = this.evaluate(r, now, { ...(this.ruleMem[r.key] ?? {}) });
      if (st.state === 'trip') throw new Error(`Cannot reset yet — ${r.label}: ${st.text}`);
    };
    for (const r of trippedRules) if (!r.onReset) check(r);
    // Only once every other trip has cleared: rules whose reset changes something (dispensed back to 0).
    for (const r of trippedRules) {
      if (!r.onReset) continue;
      r.onReset.apply(this.snapshot);
      this.log('info', `${r.label}: ${r.onReset.note}`);
      check(r);
    }
    const was = Object.keys(this.tripped);
    this.tripped = {};
    if (was.length) this.log('info', `Safety stop reset by user (${was.join(', ')})`);
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
      if (lock) throw new Error(`${sw.label} is locked out by a safety stop: ${lock}. Reset it on the card first.`);
    }
    await this.send(on ? sw.on : sw.off);
    if (on && !this.snapshot.switches[key]) this.switchedOnAt[key] = Date.now();
    this.snapshot.switches[key] = on;
    this.changed.emit(this);
  }

  /** Sends every stop command. Returns the ones that failed (empty when all went out). */
  async stopAll(): Promise<string[]> {
    const failed: string[] = [];
    for (const cmd of this.driver.stopCommands) {
      try {
        await this.send(cmd);
      } catch (e) {
        failed.push(cmd);
        this.log('error', `Stop ${cmd} failed: ${(e as Error).message}`);
      }
    }
    // Only mark everything off when every stop went out; otherwise the next poll shows the truth.
    if (!failed.length) for (const k of Object.keys(this.snapshot.switches)) this.snapshot.switches[k] = false;
    this.changed.emit(this);
    return failed;
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
