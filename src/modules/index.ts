import type { DeviceDriver } from '../core/types';
import { eurostar60 } from './eurostar-60-control/module';
import { retControlVisc } from './ret-control-visc/module';
import { regloIcc } from './reglo-icc/module';

// Every module the app can use. A module is a folder in src/modules/ (see README.md there):
// adding one = copy _template/, fill it in, and list it here.
export const drivers: DeviceDriver[] = [eurostar60, retControlVisc, regloIcc];

export function getDriver(model: string): DeviceDriver {
  const d = drivers.find((x) => x.model === model);
  if (!d) throw new Error(`Unknown device model: ${model}`);
  return d;
}

export function detectDriver(nameReply: string): DeviceDriver | undefined {
  return drivers.find((d) => d.identify(nameReply));
}
