import { SerialTransport } from './serialTransport';
import { NAMUR_SERIAL, type SerialLink } from './types';
import { detectDriver } from '../devices/registry';

// Settings tried in order when asking a unit for its name. NAMUR (9600 7E1) first, as both
// manuals specify; 8N1 covers USB virtual COM ports that ignore the requested framing.
const PROBES: { label: string; link: SerialLink }[] = [
  { label: '9600 7E1, CR LF', link: { options: NAMUR_SERIAL, lineEnd: '\r\n' } },
  { label: '9600 7E1, blank CR LF', link: { options: NAMUR_SERIAL, lineEnd: ' \r \n' } },
  { label: '9600 8N1, CR LF', link: { options: { ...NAMUR_SERIAL, dataBits: 8, parity: 'none' }, lineEnd: '\r\n' } },
  { label: '9600 8N1, blank CR LF', link: { options: { ...NAMUR_SERIAL, dataBits: 8, parity: 'none' }, lineEnd: ' \r \n' } },
];

const readable = (s: string) => /^[\x20-\x7e]+$/.test(s) && /[A-Za-z]/.test(s);

export interface ProbeResult {
  name: string;
  link: SerialLink;
  label: string;
  attempts: string[]; // what each setting got back, for the error message
}

/**
 * Ask IN_NAME with each candidate setting. Stops at the first reply a driver recognises;
 * otherwise returns the first readable reply (garbage from a wrong baud rate can look like text).
 */
export async function probeName(port: SerialPort, onStep: (s: string) => void = () => {}, first?: SerialLink): Promise<ProbeResult> {
  const attempts: string[] = [];
  let fallback: ProbeResult | undefined;
  const order = first ? [{ label: 'saved setting', link: first }, ...PROBES] : PROBES;
  for (const p of order) {
    onStep(`Asking the unit (${p.label})…`);
    const t = new SerialTransport(port, p.link.options, p.link.lineEnd, 1200);
    try {
      await t.open();
      const name = ((await t.request('IN_NAME', true)) ?? '').trim();
      if (readable(name) && detectDriver(name)) return { name, link: p.link, label: p.label, attempts };
      if (readable(name)) fallback ??= { name, link: p.link, label: p.label, attempts };
      attempts.push(`${p.label}: "${name}" [${t.lastRawHex || 'no bytes'}]`);
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

