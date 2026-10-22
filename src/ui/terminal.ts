import type { App } from '../core/app';
import type { DeviceInstance } from '../core/device';
import { SerialTransport } from '../core/serialTransport';
import { h, openDialog } from './dom';

/** Bench terminal: send raw commands to one device and see the replies. */
export function openTerminal(app: App, dev: DeviceInstance): void {
  void openDialog(`Bench terminal — ${dev.label}`, () => {
    const out = h('pre', { class: 'term-out', 'aria-live': 'polite' });
    const line = (cls: string, text: string) => {
      out.append(h('div', { class: cls }, `${new Date().toLocaleTimeString()}  ${text}`));
      out.scrollTop = out.scrollHeight;
    };
    const p = dev.protocol;
    const input = h('input', { type: 'text', class: p.caseSensitive ? 'cs' : '', placeholder: `e.g. ${p.benchCommands[1] ?? p.identifyCmd}`, autocapitalize: p.caseSensitive ? 'off' : 'characters', spellcheck: 'false' }) as HTMLInputElement;
    const send = async (cmd: string) => {
      cmd = dev.normalize(cmd);
      if (!cmd) return;
      line('tx', `> ${cmd}`);
      try {
        const r = await dev.raw(cmd);
        const hex = dev.transport instanceof SerialTransport ? dev.transport.lastRawHex : '';
        line('rx', r === null ? '(sent, no reply expected)' : `< ${r}${hex ? `   [${hex}]` : ''}`);
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
    const quick = h('div', { class: 'quick' }, ...p.benchCommands.map((c) => h('button', { type: 'button', onclick: () => send(c) }, c)));
    setTimeout(() => input.focus(), 50);
    return h(
      'div',
      { class: 'terminal' },
      h('p', { class: 'hint' }, `Commands go through the same queue as polling. ${p.benchHint} Replies show the text and the raw bytes in hex. Use this to check the commands marked "manual" in the device notes.`),
      quick,
      out,
      form,
    );
  });
}
