import { NAMUR_SERIAL, type SerialLink } from './types';

/**
 * How a device family talks on the wire. Drivers describe WHAT a device can do; a protocol
 * describes HOW commands are framed, acknowledged and identified. Two families so far:
 * - NAMUR (IKA): 9600 7E1, CR LF, writes are not acknowledged, IN_NAME identifies.
 * - Ismatec (Reglo ICC): 9600 8N1, CR, every command answers "*" (ok), "#" (refused),
 *   "+"/"-" (yes/no, or "cannot run"), case-sensitive commands, "1#" identifies.
 */
export interface Protocol {
  id: 'namur' | 'ismatec';
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
  checkAck: (cmd, reply) => {
    const r = (reply ?? '').trim();
    if (r === '#') throw new Error(`Pump refused "${cmd}"`);
    // "-" to a start means the channel settings can't be met (manual p. 22, ref 2.1).
    if (r === '-') throw new Error(`Pump can't run "${cmd}" with its current settings: flow is 0 or above what this tubing allows (send ${cmd[0]}xe in the bench terminal for the cause)`);
  },
  benchCommands: ['1#', '1~', '1xA', '1(', '1xM', '1xD', '1f', '1+', '1?', '1E', '1xe'],
  benchHint: 'Commands are case-sensitive and start with the channel number (1–4; pump-wide commands such as 1# ignore it). Every command gets a reply: * = done, # = refused, +/- = yes/no.',
};

export const PROTOCOLS: Protocol[] = [NAMUR, ISMATEC];

export function protocolOf(link?: SerialLink): Protocol {
  return link?.protocol === 'ismatec' ? ISMATEC : NAMUR;
}
