import type { DeviceDriver } from '../core/types';
import { eurostar60 } from './eurostar-60-control/module';
import { retControlVisc } from './ret-control-visc/module';
import { regloIcc } from './reglo-icc/module';
import { handyPump } from './innofluid-st-handypump/module';
import { labV1 } from './innofluid-labv1/module';

// Every module the app can use. A module is a folder in src/modules/ (see README.md there):
// adding one = copy _template/, fill it in, and list it here.
export const drivers: DeviceDriver[] = [eurostar60, retControlVisc, regloIcc, handyPump, labV1];

export function getDriver(model: string): DeviceDriver {
  const d = drivers.find((x) => x.model === model);
  if (!d) throw new Error(`Unknown device model: ${model}`);
  return d;
}

/** The driver whose unit answered with this name. Modbus units have no name, so they are never auto-detected. */
export function detectDriver(nameReply: string): DeviceDriver | undefined {
  return drivers.find((d) => d.protocol?.id !== 'modbus' && d.identify(nameReply));
}
