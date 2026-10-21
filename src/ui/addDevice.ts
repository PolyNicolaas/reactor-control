import type { App, SavedDevice } from '../core/app';
import type { DeviceInstance } from '../core/device';
import { SerialTransport, describePort, serialSupported } from '../core/serialTransport';
import { NAMUR_SERIAL } from '../core/types';
import { detectDriver, drivers, getDriver } from '../devices/registry';
import { SimTransport } from '../devices/simulator';
import { h, openDialog, toast } from './dom';

/** Ask IN_NAME on a port and return the reply, then close it again. */
async function probeName(port: SerialPort): Promise<string> {
  const t = new SerialTransport(port, NAMUR_SERIAL, 1500);
  await t.open();
  try {
    return (await t.request('IN_NAME', true)) ?? '';
  } finally {
    await t.close();
  }
}

export function openAddDevice(app: App): void {
  void openDialog('Add device', (close) => {
    const model = h(
      'select',
      { 'aria-label': 'Model' },
      h('option', { value: 'auto' }, 'Auto-detect (ask the unit)'),
      ...drivers.map((d) => h('option', { value: d.model }, `${d.displayName} — ${d.kind}`)),
    ) as HTMLSelectElement;
    const label = h('input', { type: 'text', placeholder: 'e.g. Hotplate, Overhead stirrer' }) as HTMLInputElement;
    const useSim = h('input', { type: 'checkbox' }) as HTMLInputElement;
    if (!serialSupported()) useSim.checked = true;
    const err = h('p', { class: 'error-text', role: 'alert' });
    const go = h('button', { class: 'primary', type: 'submit' }, 'Choose port and connect') as HTMLButtonElement;
    useSim.addEventListener('change', () => (go.textContent = useSim.checked ? 'Add simulated device' : 'Choose port and connect'));
    useSim.dispatchEvent(new Event('change'));

    const submit = async (e: Event) => {
      e.preventDefault();
      err.textContent = '';
      try {
        if (useSim.checked) {
          const m = model.value === 'auto' ? drivers[0].model : model.value;
          const drv = getDriver(m);
          await app.addDevice({ model: m, label: label.value.trim() || drv.kind, transport: new SimTransport(m as 'eurostar60' | 'retControlVisc') });
          close(true);
          return;
        }
        // requestPort must run straight from the click.
        const port = await navigator.serial.requestPort();
        go.disabled = true;
        go.textContent = 'Asking the unit…';
        let m = model.value;
        let name = '';
        try {
          name = await probeName(port);
        } catch (x) {
          throw new Error(`No reply from ${describePort(port)}. Check the cable, that the unit is on, and try the other port. (${(x as Error).message})`);
        }
        const found = detectDriver(name);
        if (m === 'auto') {
          if (!found) throw new Error(`The unit answered "${name}", which no driver recognises yet.`);
          m = found.model;
        } else if (!getDriver(m).identify(name)) {
          const ok = confirm(`This unit says "${name}", not ${getDriver(m).displayName}.${found ? ` It looks like a ${found.displayName}.` : ''} Connect anyway as ${getDriver(m).displayName}?`);
          if (!ok) throw new Error('Cancelled.');
        }
        const drv = getDriver(m);
        await app.addDevice({ model: m, label: label.value.trim() || drv.kind, transport: new SerialTransport(port, drv.serial) });
        toast(`${drv.displayName} connected`);
        close(true);
      } catch (x) {
        const msg = (x as Error).message;
        if ((x as Error).name !== 'NotFoundError') err.textContent = msg; // NotFoundError = picker cancelled
        go.disabled = false;
        useSim.dispatchEvent(new Event('change'));
      }
    };

    return h(
      'form',
      { class: 'form', onsubmit: submit },
      h('label', {}, 'Model', model),
      h('label', {}, 'Name on this page', label),
      h('label', { class: 'check' }, useSim, ' Simulated device (no hardware)'),
      !serialSupported() && h('p', { class: 'hint' }, 'This browser has no Web Serial. Use Chrome or Edge on a computer, or Chromium on the Raspberry Pi, to connect real units.'),
      err,
      h('div', { class: 'actions' }, go),
    );
  });
}

/** Reconnect a device whose port was lost or not granted yet. */
export async function reconnectDevice(app: App, dev: DeviceInstance): Promise<void> {
  try {
    if (dev.transport.kind === 'sim') {
      await dev.replaceTransport(new SimTransport(dev.driver.model as 'eurostar60' | 'retControlVisc'));
      return;
    }
    const port = await navigator.serial.requestPort({ filters: portFilter(dev.transport instanceof SerialTransport ? dev.transport.port.getInfo() : {}) });
    await dev.replaceTransport(new SerialTransport(port, dev.driver.serial));
    app.save();
    toast(`${dev.label} reconnected`);
  } catch (e) {
    if ((e as Error).name !== 'NotFoundError') toast((e as Error).message, 'error');
  }
}

export async function reconnectSaved(app: App, s: SavedDevice): Promise<void> {
  try {
    const port = await navigator.serial.requestPort({ filters: portFilter(s) });
    app.forgetMissing(s.id);
    await app.addDevice({ model: s.model, label: s.label, id: s.id, color: s.color, limits: s.limits, transport: new SerialTransport(port, getDriver(s.model).serial) });
  } catch (e) {
    if ((e as Error).name !== 'NotFoundError') toast((e as Error).message, 'error');
  }
}

function portFilter(info: { usbVendorId?: number; usbProductId?: number }): SerialPortFilter[] {
  return info.usbVendorId !== undefined ? [{ usbVendorId: info.usbVendorId, usbProductId: info.usbProductId }] : [];
}
