import type { DeviceDriver } from '../core/types';
import { eurostar60 } from './eurostar60';
import { retControlVisc } from './retControlVisc';

// Every available driver. Adding a new IKA model = add a driver file and list it here.
export const drivers: DeviceDriver[] = [eurostar60, retControlVisc];

export function getDriver(model: string): DeviceDriver {
  const d = drivers.find((x) => x.model === model);
  if (!d) throw new Error(`Unknown device model: ${model}`);
  return d;
}

export function detectDriver(nameReply: string): DeviceDriver | undefined {
  return drivers.find((d) => d.identify(nameReply));
}
