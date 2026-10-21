import type { App } from '../core/app';
import type { DeviceInstance } from '../core/device';
import { h, openDialog } from './dom';

// Commands worth checking on each unit before trusting them in a driver.
const VERIFY = ['IN_NAME', 'IN_PV_5', 'IN_PV_80', 'IN_PV_90', 'IN_SP_1', 'IN_SP_4', 'IN_SOFTWARE'];

/** Bench terminal: send raw NAMUR commands to one device and see the replies. */
export function openTerminal(app: App, dev: DeviceInstance): void {
  void openDialog(`Bench terminal — ${dev.label}`, () => {
    const out = h('pre', { class: 'term-out', 'aria-live': 'polite' });
    const line = (cls: string, text: string) => {
      out.append(h('div', { class: cls }, `${new Date().toLocaleTimeString()}  ${text}`));
      out.scrollTop = out.scrollHeight;
    };
    const input = h('input', { type: 'text', placeholder: 'e.g. IN_PV_4', autocapitalize: 'characters', spellcheck: 'false' }) as HTMLInputElement;
    const send = async (cmd: string) => {
      cmd = cmd.trim().toUpperCase();
      if (!cmd) return;
      line('tx', `> ${cmd}`);
      try {
        const r = await dev.raw(cmd);
        line('rx', r === null ? '(sent, no reply expected)' : `< ${r}`);
      } catch (e) {
        line('err', `! ${(e as Error).message}`);
      }
      app.note(`Terminal ${dev.label}: ${cmd}`);
    };
    const form = h(
      'form',
      { class: 'term-form', onsubmit: (e: Event) => { e.preventDefault(); void send(input.value); input.select(); } },
      input,
      h('button', { class: 'primary', type: 'submit' }, 'Send'),
    );
    const quick = h('div', { class: 'quick' }, ...VERIFY.map((c) => h('button', { type: 'button', onclick: () => send(c) }, c)));
    setTimeout(() => input.focus(), 50);
    return h(
      'div',
      { class: 'terminal' },
      h('p', { class: 'hint' }, 'Commands go through the same queue as polling. Commands starting with IN_ wait for a reply; others are sent without one. Use this to check the commands marked "verify" in the design.'),
      quick,
      out,
      form,
    );
  });
}
