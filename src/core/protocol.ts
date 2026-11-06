import { NAMUR_SERIAL, type SerialLink } from './types';

/**
 * How a device family talks on the wire. Drivers describe WHAT a device can do; a protocol
 * describes HOW commands are framed, acknowledged and identified. Two families so far:
 * - NAMUR (IKA): 9600 7E1, CR LF, writes are not acknowledged, IN_NAME identifies.
 * - Ismatec (Reglo ICC): 9600 8N1, CR, every command answers "*" (ok), "#" (refused),
 *   "+"/"-" (yes/no, or "cannot run"), case-sensitive commands, "1#" identifies.
 * - Modbus RTU (Innofluid pumps): 9600 8E1, binary frames with a CRC, several units on one RS-485
 *   cable told apart by address. The transport (core/modbus.ts) turns short text commands into frames.
 */
export interface Protocol {
  id: 'namur' | 'ismatec' | 'modbus';
  /** Command that makes the unit say what it is. */
  identifyCmd: string;
  /** Serial settings tried, in order, when asking an unknown port for its name. */
  probes: { label: string; link: SerialLink }[];
  /** The device answers single-character status replies (*, #, +, -) without a line end. */
  statusReplies: boolean;
  /** Writes get a reply that says whether they worked; check it with checkAck. */
  acked: boolean;
  caseSensitive: boolean;
  /** For the bench terminal: does this raw command expect a reply? */
  expectsReply(cmd: string): boolean;
  /**
   * Does this reply belong to this command? Replies carry no request id, so a late reply or an echo
   * could otherwise be taken as the answer to the next command and shift every reading by one.
   */
  replyFits(cmd: string, reply: string): boolean;
  /** Throws a readable error if the reply to a write means it was refused. */
  checkAck(cmd: string, reply: string | null): void;
  /** Quick buttons in the bench terminal. */
  benchCommands: string[];
  benchHint: string;
}

const SERIAL_7E1: SerialOptions = NAMUR_SERIAL;
const SERIAL_8N1: SerialOptions = { ...NAMUR_SERIAL, dataBits: 8, parity: 'none' };

export const NAMUR: Protocol = {
  id: 'namur',
  identifyCmd: 'IN_NAME',
  // NAMUR (9600 7E1) first, as both IKA manuals specify; 8N1 covers USB virtual COM ports
  // that ignore the requested framing.
  probes: [
    { label: '9600 7E1, CR LF', link: { options: SERIAL_7E1, lineEnd: '\r\n', protocol: 'namur' } },
    { label: '9600 7E1, blank CR LF', link: { options: SERIAL_7E1, lineEnd: ' \r \n', protocol: 'namur' } },
    { label: '9600 8N1, CR LF', link: { options: SERIAL_8N1, lineEnd: '\r\n', protocol: 'namur' } },
    { label: '9600 8N1, blank CR LF', link: { options: SERIAL_8N1, lineEnd: ' \r \n', protocol: 'namur' } },
  ],
  statusReplies: false,
  acked: false,
  caseSensitive: false,
  expectsReply: (cmd) => /^IN_/i.test(cmd.trim()),
  // IN_PV_4 / IN_SP_4 are answered "value 4": the channel at the end must match.
  replyFits: (cmd, reply) => {
    const m = /^IN_(?:PV|SP)_(\d+)$/i.exec(cmd.trim());
    if (!m) return !/^(OUT_|START_|STOP_|RESET)/i.test(reply.trim()); // an echoed write is never a reply
    const toks = reply.trim().split(/\s+/);
    return toks.length < 2 || !/^\d+$/.test(toks[toks.length - 1]) || Number(toks[toks.length - 1]) === Number(m[1]);
  },
  checkAck: () => {},
  benchCommands: ['IN_NAME', 'IN_PV_5', 'IN_PV_80', 'IN_PV_90', 'IN_SP_1', 'IN_SP_4', 'IN_SOFTWARE'],
  benchHint: 'Commands starting with IN_ wait for a reply; others are sent without one.',
};

export const ISMATEC: Protocol = {
  id: 'ismatec',
  // "#" is a pump-wide command; the address digit is required but ignored (manual p. 21).
  identifyCmd: '1#',
  probes: [{ label: '9600 8N1, CR (Ismatec)', link: { options: SERIAL_8N1, lineEnd: '\r', protocol: 'ismatec' } }],
  statusReplies: true,
  acked: true,
  caseSensitive: true,
  expectsReply: () => true,
  replyFits: () => true,
  checkAck: (cmd, reply) => {
    const r = (reply ?? '').trim();
    if (r === '#') throw new Error(`Pump refused "${cmd}"`);
    // "-" to a start means the channel settings can't be met (manual p. 22, ref 2.1).
    if (r === '-') throw new Error(`Pump can't run "${cmd}" with its current settings: flow is 0 or above what this tubing allows (send ${cmd[0]}xe in the bench terminal for the cause)`);
  },
  benchCommands: ['1#', '1~', '1xA', '1(', '1xM', '1xD', '1f', '1+', '1?', '1E', '1xe'],
  benchHint: 'Commands are case-sensitive and start with the channel number (1–4; pump-wide commands such as 1# ignore it). Every command gets a reply: * = done, # = refused, +/- = yes/no.',
};

const SERIAL_8E1: SerialOptions = { ...NAMUR_SERIAL, dataBits: 8, parity: 'even' };

export const MODBUS: Protocol = {
  id: 'modbus',
  // Modbus units have no name to ask for. Register 1001 exists on both Innofluid maps (direction on the
  // ST-HandyPump, tubing size on the LabV): any proper reply proves a pump is at that address.
  identifyCmd: 'R1001',
  // Not tried by Auto-detect: binary frames sent to an IKA unit are noise, and a Modbus unit cannot
  // say what it is. The user picks the model and the pump's address in Add device.
  probes: [],
  statusReplies: false,
  acked: true, // writes are echoed; the transport checks the echo and throws on an exception reply
  caseSensitive: false,
  expectsReply: () => true,
  replyFits: () => true, // address, function and CRC are checked by the transport
  checkAck: () => {},
  benchCommands: ['R1001', 'R1000', 'RF1002', 'R1008', 'RF1004', 'R1020'],
  benchHint: 'R1000 reads a register, RF1002 reads a float, W1000=1 writes a whole number, WF1002=58.8 writes a float. The pump address is added for you. Errors from the pump are shown in words.',
};

export const MODBUS_LINK = (address: number): SerialLink => ({ options: SERIAL_8E1, lineEnd: '', protocol: 'modbus', address });

export const PROTOCOLS: Protocol[] = [NAMUR, ISMATEC, MODBUS];

export function protocolOf(link?: SerialLink): Protocol {
  return link?.protocol === 'ismatec' ? ISMATEC : link?.protocol === 'modbus' ? MODBUS : NAMUR;
}
