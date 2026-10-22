import { transportFor } from './serialTransport';
import { PROTOCOLS, protocolOf, type Protocol } from './protocol';
import type { SerialLink } from './types';
import { detectDriver } from '../devices/registry';

const readable = (s: string) => /^[\x20-\x7e]+$/.test(s) && /[A-Za-z]/.test(s);

export interface ProbeResult {
  name: string;
  link: SerialLink;
  label: string;
  attempts: string[]; // what each setting got back, for the error message
  /**
   * The unit answered with a properly framed line, but its stored name is blank (all 0xFF bytes:
   * erased memory). Seen on our RET control-visc, 2026-10-22. It is still a working NAMUR unit.
   */
  blankName?: boolean;
  /** Other identity replies (IN_TYPE, IN_SOFTWARE) asked when the name is blank. */
  ids: string[];
}

/** Does a driver recognise this unit by its name or any other identity reply? */
export function recognises(identify: (s: string) => boolean, r: Pick<ProbeResult, 'name' | 'ids'>): boolean {
  return [r.name, ...r.ids].some((s) => !!s && identify(s));
}

const blankLine = (hex: string) => /^(ff ){1,16}0d 0a$/.test(hex.trim());

/**
 * Ask the unit for its name with each candidate setting (every protocol's identify command).
 * Stops at the first reply a driver recognises; otherwise returns the first readable reply
 * (garbage from a wrong baud rate can look like text).
 * `prefer` puts one protocol's settings first, e.g. when the user picked a model.
 */
export async function probeName(
  port: SerialPort,
  onStep: (s: string) => void = () => {},
  first?: SerialLink,
  prefer?: Protocol,
): Promise<ProbeResult> {
  const attempts: string[] = [];
  let fallback: ProbeResult | undefined;
  const protocols = prefer ? [prefer, ...PROTOCOLS.filter((p) => p !== prefer)] : PROTOCOLS;
  const order = [
    ...(first ? [{ label: 'saved setting', link: first }] : []),
    ...protocols.flatMap((p) => p.probes),
  ];
  for (const p of order) {
    onStep(`Asking the unit (${p.label})…`);
    const t = transportFor(port, p.link, 1200);
    try {
      await t.open();
      const name = ((await t.request(protocolOf(p.link).identifyCmd, true)) ?? '').trim();
      if (readable(name) && detectDriver(name)) return { name, link: p.link, label: p.label, attempts, ids: [] };
      if (readable(name)) fallback ??= { name, link: p.link, label: p.label, attempts, ids: [] };
      attempts.push(`${p.label}: "${name}" [${t.lastRawHex || 'no bytes'}]`);
      if (protocolOf(p.link).id === 'namur' && blankLine(t.lastRawHex)) {
        // Framing works (a CR LF line came back) but the name is blank. Ask other identity commands.
        const ids: string[] = [];
        for (const cmd of ['IN_TYPE', 'IN_SOFTWARE']) {
          try {
            const r = ((await t.request(cmd, true)) ?? '').trim();
            attempts.push(`  ${cmd}: "${r}" [${t.lastRawHex}]`);
            if (readable(r)) ids.push(r);
          } catch (e) {
            attempts.push(`  ${cmd}: ${(e as Error).message}`);
          }
        }
        return { name: '', link: p.link, label: p.label, attempts, ids, blankName: true };
      }
    } catch (e) {
      attempts.push(`${p.label}: ${t.lastRawHex ? `garbled [${t.lastRawHex}]` : (e as Error).message}`);
    } finally {
      await t.close();
    }
  }
  if (fallback) return fallback;
  const err = new Error('probe failed') as Error & { attempts: string[] };
  err.attempts = attempts;
  throw err;
}
