import type { Protocol } from './protocol';

// Shared types. A driver DESCRIBES a device model; the shared core does the work.

export interface ReadingSpec {
  key: string;          // stable id, e.g. "speed"
  label: string;        // shown in the UI
  unit: string;         // "°C", "rpm", "Ncm"
  /** Read command, e.g. "IN_PV_4". Omit for a value the driver computes in derive(). */
  cmd?: string;
  chart?: boolean;      // plot on the live chart
  primary?: boolean;    // shown large in the panel
  /** Display decimals (default: 0 for rpm, 1 otherwise). */
  decimals?: number;
  /**
   * The device may not answer this reading until the user does something on the unit (e.g. the RET
   * balance needs its weighing key pressed). No reply is then normal: it is not logged as an error,
   * is retried every retryMs, and missingNote tells the user what to do.
   */
  optional?: {
    retryMs: number;
    missingNote: string;
    /** The device answers exactly 0 when the reading is unavailable (RET balance outside weighing mode). */
    zeroMeansMissing?: boolean;
  };
  /** Reading counts as settled when the last `count` values are within `span` of each other. */
  stable?: { span: number; count: number };
  /** Software tare: the app subtracts a stored offset and shows net values. */
  tareable?: boolean;
  /** Reading is only meaningful in some states (e.g. the RET balance needs heating and stirring off). */
  validWhen?: (s: DeviceSnapshot) => boolean;
  /** Shown instead of the value when validWhen is false. */
  invalidNote?: string;
  hidden?: boolean;     // recorded, but no tile in the panel
  everyN?: number;      // poll only every Nth cycle (slow-changing values)
  group?: string;       // panel section, e.g. a pump channel
  /**
   * The reading shows the unit is doing something (e.g. speed above 20 rpm = stirring). Crossing the
   * threshold either way is reported as a change (camera clip, event), whether the app or the
   * unit's own controls caused it.
   */
  activity?: {
    name: string;
    above: number;
    /** The switch that starts and stops this activity (lets the card warn before stopping something another module watches). */
    switchKey?: string;
  };
}

export interface SetpointSpec {
  key: string;          // e.g. "speed" or "temp"
  label: string;
  unit: string;
  cmd: string;          // write command; value is appended after a space
  readCmd?: string;     // read-back command, e.g. "IN_SP_4"
  min: number;
  max: number;
  step: number;
  decimals: number;
  tolerance: number;    // read-back within this counts as "confirmed"
  toleranceRel?: number; // ...or within this fraction of the value (devices that round to significant figures)
  actualKey?: string;   // the reading this setpoint drives (for status and charts)
  /** The switch that makes the unit act on this setpoint (speed -> motor). Enables the set-vs-actual line. */
  switchKey?: string;
  /** Actual within this of the set value counts as "at setpoint" (default: 2 °C, else max(5, 3 %)). */
  band?: number;
  /** Seconds the actual may take to start moving after a start or a change before it counts as "not following" (default 8). */
  graceS?: number;
  group?: string;
}

export interface SwitchSpec {
  key: string;          // e.g. "motor", "heater"
  label: string;
  on: string;           // e.g. "START_4"
  off: string;          // e.g. "STOP_4"
  confirmOn?: string;   // ask before switching on (e.g. heater)
  group?: string;
}

/** A user-adjustable number for a safety rule (e.g. how far the plate may run above the setpoint). */
export interface SafetySetting {
  key: string;          // unique within the module; saved per unit
  label: string;
  unit: string;
  default: number;
  min: number;
  max: number;
  step: number;
  hint?: string;
}

/**
 * What a rule says about the unit right now, shown live on the card.
 *   off      the user turned it off (a setting of 0)
 *   idle     nothing to watch right now (heater off, no probe, partner module not on the page)
 *   learning collecting data before it can judge (e.g. the steady plate–probe gap)
 *   ok       watching, nothing wrong
 *   near     watching, getting close to tripping (amber)
 *   trip     the unit must stop: the core switches the rule's switches off and locks them out
 */
export type RuleState = 'off' | 'idle' | 'learning' | 'ok' | 'near' | 'trip';
export interface RuleStatus {
  state: RuleState;
  /** One plain line with the live numbers, e.g. "Plate 112 °C · trips above 150 °C". */
  text: string;
}

/** One poll of a unit, kept as history for safety rules. */
export interface Sample {
  t: number;  // epoch ms
  values: Record<string, number | undefined>;
  setpoints: Record<string, number | undefined>;
  switches: Record<string, boolean>;
}

/** Read-only view of another module on the same page (rules can read it, never command it). */
export interface PeerView {
  id: string;
  label: string;
  model: string;
  displayName: string;
  provides: string[];
  /** Connected and answering polls. */
  live: boolean;
  snapshot: DeviceSnapshot;
  history: Sample[];
  /** True when one of its readings marked `activity: { name }` is above its threshold (e.g. "stirring"). */
  active(name: string): boolean;
}

export interface RuleContext {
  s: DeviceSnapshot;                 // this unit, latest poll
  history: Sample[];                 // this unit, oldest first, covering ModuleSafety.historyS
  set: Record<string, number>;       // this module's safety settings (defaults + the user's)
  mem: Record<string, unknown>;      // private memory of this rule, kept between polls
  now: number;                       // epoch ms
  /** Other modules on the page that provide the rule's `withPeer` capability (empty for own rules). */
  peers: PeerView[];
}

/**
 * A safety rule. It belongs to the module whose switch it turns off, so plugging in a module always
 * brings its rules. A rule may also watch other modules on the page (`withPeer`): it is then armed only
 * while such a module is present, and reads it through ctx.peers.
 *
 * Principles (see src/modules/README.md): act on readings, not on what the app thinks it switched on;
 * a rule may only add trips; explain itself in `why` and in every status line.
 */
export interface SafetyRule {
  key: string;
  label: string;
  /** Plain language: what goes wrong without this rule. Shown on the card. */
  why: string;
  /** Switch keys turned off on a trip and refused while tripped. */
  switches: string[];
  settings?: SafetySetting[];
  /** On unless the user turns it off. Set false for rules whose right setting depends on the run. */
  defaultOn?: boolean;
  /** Cannot be turned off (the static floor, e.g. the plate maximum). */
  required?: boolean;
  /** Armed only while a module providing this capability is on the page, e.g. "stirrer". */
  withPeer?: string;
  /** The partner's activity this rule depends on (e.g. "stirring"); its switch gets a warning. */
  watchesActivity?: string;
  /** Shown on the partner's card under "Watched by". {settingKey} is replaced by the setting's value. */
  watchNote?: string;
  evaluate(ctx: RuleContext): RuleStatus;
}

export interface ModuleSafety {
  /** Seconds of history the rules need. */
  historyS: number;
  rules: SafetyRule[];
  /** One summary line for the card header of the Safety section (optional). */
  summary?(s: DeviceSnapshot, set: Record<string, number>): string;
}

/** How a setpoint is being followed right now (see DeviceInstance.tracking). */
export interface Tracking {
  state: 'off' | 'ok' | 'moving' | 'stuck' | 'mismatch' | 'unknown';
  set?: number;       // the unit's set value (read back)
  intended?: number;  // the value last applied from this page
  actual?: number;
  text: string;
}

/**
 * A reference list shown under a caution icon on the card (e.g. solvent autoignition temperatures).
 * Items at or below reference() are flagged red, within nearBy above it amber.
 */
export interface CautionList {
  title: string;
  unit: string;
  intro: string;
  sources: string;
  items: { name: string; value: number; note?: string }[];
  nearBy: number;
  reference(s: DeviceSnapshot, set: Record<string, number>): { value: number; label: string };
  /** Offer a button per item to set a safety setting to (item value - margin), rounded down to 5. */
  cap?: { setting: string; margin: number; label(v: number): string };
}

export type DeviceStatus = 'Safety stop' | 'Idle' | 'Heating' | 'At temp' | 'Stirring' | 'Pumping' | 'No reply' | 'Disconnected' | 'Connecting';

export interface DeviceSnapshot {
  values: Record<string, number | undefined>;      // reading key -> value (net, after tare)
  gross: Record<string, number | undefined>;       // tareable reading key -> value as the device reports it
  setpoints: Record<string, number | undefined>;   // setpoint key -> value read back from device
  switches: Record<string, boolean>;               // switch key -> last commanded state
}

export interface DeviceDriver {
  model: string;                 // registry key, e.g. "eurostar60"
  displayName: string;
  kind: string;                  // short description, e.g. "Overhead stirrer"
  serial: SerialOptions;
  /** Line terminator for commands, as the manual specifies (default CR LF). */
  lineEnd?: string;
  identify(nameReply: string): boolean;   // matches the IN_NAME reply
  readings: ReadingSpec[];
  setpoints: SetpointSpec[];
  switches: SwitchSpec[];
  stopCommands: string[];        // what Stop all sends
  /** Show HOT on the card while this reading is at or above `above`, and "may be hot" after a disconnect. */
  hot?: { key: string; above: number };
  /** Reference lists under a caution icon on the card. */
  cautions?: CautionList[];
  /**
   * Capabilities this module brings to a page, e.g. ["stirrer", "overhead-stirrer"]. Other modules'
   * safety rules use them to find partners (`SafetyRule.withPeer`), so match on what a unit does,
   * not on its model name.
   */
  provides?: string[];
  /** The module's folder under src/modules/, e.g. "ret-control-visc" (links the card to its README). */
  source?: string;
  /** Safety rules (see SafetyRule). Every module has this section, even if it lists no rules. */
  safety?: ModuleSafety;
  releaseCommand?: string;       // sent when the device is removed (hand back to local control)
  watchdog?: { verified: boolean; arm(seconds: number): string };
  status(s: DeviceSnapshot): DeviceStatus;
  parse?(reply: string): number | undefined;
  /** Wire protocol; default NAMUR (IKA). */
  protocol?: Protocol;
  /** Sent once after identifying, before polling (e.g. enable per-channel addressing). */
  initCommands?: string[];
  /** Build the write for a setpoint; default "<cmd> <value>". */
  formatSetpoint?(sp: SetpointSpec, value: number): string;
  /** Runs after every poll: compute derived readings, reconcile state. May edit the snapshot. */
  derive?(s: DeviceSnapshot, dtSeconds: number): void;
  /** Panel sections, in order; specs with a matching `group` are drawn inside them. */
  groups?: { key: string; label: string }[];
  /** A simulated unit for testing without hardware. */
  simulate(): Transport;
}

/** Serial settings that actually work for one unit (may differ from the driver default). */
export interface SerialLink {
  options: SerialOptions;
  lineEnd: string;
  protocol?: 'namur' | 'ismatec'; // absent in pages saved before the pump was added = namur
}

/** Something that carries command lines to a device: Web Serial or the simulator. */
export interface Transport {
  readonly kind: 'serial' | 'sim';
  open(): Promise<void>;
  close(): Promise<void>;
  /** Send one command. If expectReply, resolves with the reply line. */
  request(cmd: string, expectReply: boolean): Promise<string | null>;
  onDisconnect?: () => void;
  onLog?: (dir: 'tx' | 'rx' | 'info', text: string) => void;
}

export const NAMUR_SERIAL: SerialOptions = {
  baudRate: 9600,
  dataBits: 7,
  parity: 'even',
  stopBits: 1,
  flowControl: 'none',
};

/** Default reply parser: first whitespace token that is a plain number ("25.3 1" -> 25.3). */
export function parseNumber(reply: string): number | undefined {
  for (const tok of reply.trim().split(/\s+/)) {
    if (/^[-+]?\d+(\.\d+)?$/.test(tok)) return Number(tok);
  }
  return undefined;
}
