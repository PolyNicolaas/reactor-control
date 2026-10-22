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
}

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
