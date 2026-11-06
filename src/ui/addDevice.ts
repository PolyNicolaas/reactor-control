import { savedSafety } from '../core/app';
import type { App, SavedDevice } from '../core/app';
import type { DeviceInstance } from '../core/device';
import { describePort, serialSupported, transportFor } from '../core/serialTransport';
import { MODBUS_LINK, NAMUR } from '../core/protocol';
import { probeModbus, probeName, recognises, type ProbeResult } from '../core/probe';
import { detectDriver, drivers, getDriver } from '../modules';
import { h, openDialog, toast } from './dom';
import type { DeviceDriver, SerialLink } from '../core/types';

export function openAddDevice(app: App): void {
  void openDialog('Add device', (close) => {
    const model = h(
      'select',
      { 'aria-label': 'Model' },
      h('option', { value: 'auto' }, 'Auto-detect (ask the unit)'),
      ...drivers.map((d) => h('option', { value: d.model }, `${d.displayName} — ${d.kind}`)),
    ) as HTMLSelectElement;
    const label = h('input', { type: 'text', placeholder: 'e.g. Hotplate, Overhead stirrer' }) as HTMLInputElement;
    // Modbus units (Innofluid pumps) share one RS-485 cable and are told apart by address.
    const address = h('input', { type: 'number', min: '1', max: '32', step: '1', value: '1' }) as HTMLInputElement;
    const addressRow = h('label', { hidden: true }, 'Pump address on the RS-485 cable (Slave No. on the pump, 1–32)', address);
    const isModbus = () => model.value !== 'auto' && getDriver(model.value).protocol?.id === 'modbus';
    model.addEventListener('change', () => (addressRow.hidden = !isModbus()));
    const useSim = h('input', { type: 'checkbox' }) as HTMLInputElement;
    if (!serialSupported()) useSim.checked = true;
    const resetLabel = () => (go.textContent = useSim.checked ? 'Add simulated device' : 'Choose port and connect');
    const err = h('p', { class: 'error-text', role: 'alert' });
    const details = h('details', { class: 'probe-details', hidden: true });
    const go = h('button', { class: 'primary', type: 'submit' }, 'Choose port and connect') as HTMLButtonElement;
    useSim.addEventListener('change', resetLabel);
    resetLabel();

    const submit = async (e: Event) => {
      e.preventDefault();
      err.textContent = '';
      try {
        if (useSim.checked) {
          const m = model.value === 'auto' ? drivers[0].model : model.value;
          const drv = getDriver(m);
          await app.addDevice({ model: m, label: label.value.trim() || drv.kind, transport: drv.simulate() });
          close(true);
          return;
        }
        if (isModbus()) {
          const a = Number(address.value);
          if (!Number.isInteger(a) || a < 1 || a > 32) throw new Error('The pump address is a whole number from 1 to 32 (the pump\'s Slave No.).');
          const link = MODBUS_LINK(a);
          // requestPort must run straight from the click. A port already used by other pumps on the same
          // cable is fine: pumps share it, as long as the address differs.
          const port = await navigator.serial.requestPort();
          const owner = app.portOwner(port, link);
          if (owner) throw new Error(`"${owner.label}" already uses address ${a} on this cable. Give each pump its own Slave No. on the pump and enter that here.`);
          go.disabled = true;
          go.textContent = `Asking pump ${a}…`;
          try {
            await probeModbus(port, link);
          } catch (x) {
            throw new Error(`No pump answered at address ${a} on ${describePort(port)} (${(x as Error).message}). On the pump: RS485 selected, 9600 baud, Slave No. ${a}, communication ON, and the main screen showing. Then check A/B wiring (see the module's RS-485 guide).`);
          }
          const drv = getDriver(model.value);
          await app.addDevice({ model: drv.model, label: label.value.trim() || drv.kind, transport: transportFor(port, link), link });
          toast(`${drv.displayName} connected (address ${a})`);
          close(true);
          return;
        }
        // requestPort must run straight from the click.
        const port = await navigator.serial.requestPort();
        const owner = app.portOwner(port);
        if (owner) throw new Error(`That port is already used by "${owner.label}". Pick the other unit's port; both IKA units can look alike in the list.`);
        go.disabled = true;
        let m = model.value;
        let probe: ProbeResult;
        try {
          probe = await probeName(port, (s) => (go.textContent = s), undefined, m === 'auto' ? undefined : getDriver(m).protocol ?? NAMUR);
        } catch (x) {
          const attempts = (x as { attempts?: string[] }).attempts ?? [(x as Error).message];
          details.replaceChildren(h('summary', {}, 'What each setting got back'), h('pre', {}, attempts.join('\n')));
          details.hidden = false;
          throw new Error(`No readable reply from ${describePort(port)}. Check that this is the right port, the unit is switched on, and the cable is a data cable.`);
        }
        const name = probe.name;
        details.hidden = true;
        const found = [name, ...probe.ids].map(detectDriver).find(Boolean);
        if (probe.blankName && !found) {
          // The unit talks (CR LF framing works) but its stored name is erased: it cannot say what it is.
          details.replaceChildren(h('summary', {}, 'What the unit sent'), h('pre', {}, probe.attempts.join('\n')));
          details.hidden = false;
          if (m === 'auto') {
            throw new Error('The unit answers, but its stored name is blank, so it cannot say what it is. Pick its model in the list above instead of Auto-detect, then connect again.');
          }
        } else if (m === 'auto') {
          if (!found) throw new Error(`The unit answered "${name}", which no driver recognises yet.`);
          m = found.model;
        } else if (!recognises(getDriver(m).identify, probe)) {
          const ok = confirm(`This unit says "${name}", not ${getDriver(m).displayName}.${found ? ` It looks like a ${found.displayName}.` : ''} Connect anyway as ${getDriver(m).displayName}?`);
          if (!ok) throw new Error('Cancelled.');
        }
        const drv = getDriver(m);
        await app.addDevice({
          model: m,
          label: label.value.trim() || drv.kind,
          transport: transportFor(port, probe.link),
          link: probe.link,
        });
        toast(probe.blankName ? `${drv.displayName} connected (its stored name is blank; see the notes)` : `${drv.displayName} connected (${probe.label})`);
        close(true);
      } catch (x) {
        const msg = (x as Error).message;
        if ((x as Error).name !== 'NotFoundError') err.textContent = msg; // NotFoundError = picker cancelled
        go.disabled = false;
        resetLabel();
      }
    };

    return h(
      'form',
      { class: 'form', onsubmit: submit },
      h('label', {}, 'Model', model),
      addressRow,
      h('label', {}, 'Name on this page', label),
      h('label', { class: 'check' }, useSim, ' Simulated device (no hardware)'),
      !serialSupported() && h('p', { class: 'hint' }, 'This browser has no Web Serial. Use Chrome or Edge on a computer, or Chromium on the Raspberry Pi, to connect real units.'),
      err,
      details,
      h('div', { class: 'actions' }, go),
    );
  });
}

/** Reconnect a device whose port was lost or not granted yet. */
export async function reconnectDevice(app: App, dev: DeviceInstance): Promise<void> {
  try {
    if (dev.transport.kind === 'sim') {
      await dev.replaceTransport(dev.driver.simulate());
      return;
    }
    const port = await navigator.serial.requestPort({ filters: portFilter(dev.transport.port?.getInfo() ?? {}) });
    const owner = app.portOwner(port, dev.link);
    if (owner && owner !== dev) throw new Error(`That port is already used by "${owner.label}".`);
    await dev.replaceTransport(transportFor(port, dev.link ?? defaultLink(dev.driver)));
    app.save();
    toast(`${dev.label} reconnected`);
  } catch (e) {
    if ((e as Error).name !== 'NotFoundError') toast((e as Error).message, 'error');
  }
}

export async function reconnectSaved(app: App, s: SavedDevice): Promise<void> {
  try {
    const port = await navigator.serial.requestPort({ filters: portFilter(s) });
    const owner = app.portOwner(port, s.link);
    if (owner) throw new Error(`That port is already used by "${owner.label}".`);
    app.forgetMissing(s.id);
    const drv = getDriver(s.model);
    await app.addDevice({ model: s.model, label: s.label, id: s.id, color: s.color, limits: s.limits, link: s.link, groupLabels: s.groupLabels, safety: savedSafety(s), rulesOn: s.rulesOn, lastHot: s.lastHot, transport: transportFor(port, s.link ?? defaultLink(drv)) });
  } catch (e) {
    if ((e as Error).name !== 'NotFoundError') toast((e as Error).message, 'error');
  }
}

/** The driver's own serial settings, for units saved before their settings were probed. */
function defaultLink(drv: DeviceDriver): SerialLink {
  if (drv.protocol?.id === 'modbus') return MODBUS_LINK(1);
  return { options: drv.serial, lineEnd: drv.lineEnd ?? '\r\n', protocol: (drv.protocol ?? NAMUR).id };
}

function portFilter(info: { usbVendorId?: number; usbProductId?: number }): SerialPortFilter[] {
  return info.usbVendorId !== undefined ? [{ usbVendorId: info.usbVendorId, usbProductId: info.usbProductId }] : [];
}
