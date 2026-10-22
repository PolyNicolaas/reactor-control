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

export type DeviceStatus = 'Idle' | 'Heating' | 'At temp' | 'Stirring' | 'Pumping' | 'No reply' | 'Disconnected' | 'Connecting';

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
