type Attrs = Record<string, string | number | boolean | undefined | ((e: Event) => void)>;
type Child = Node | string | null | undefined | false;

/** Tiny DOM builder: h('button', { class: 'x', onclick: fn }, 'Label') */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function fmt(v: number | undefined, decimals: number): string {
  return v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(decimals);
}

export function decimalsFor(unit: string): number {
  if (unit === 'rpm' || unit === 'g') return 0;
  if (unit === 'mm' || unit === 'mL') return 2;
  return 1;
}

let toastTimer: number | undefined;
export function toast(text: string, kind: 'info' | 'error' = 'info'): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = text;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el!.className = ''), 4000);
}

/** Modal dialog helper. Resolves when closed; `body` builds the content and gets a close fn. */
export function openDialog(title: string, body: (close: (v?: unknown) => void) => Node): Promise<unknown> {
  return new Promise((resolve) => {
    let result: unknown;
    const dlg = h('dialog', { class: 'dlg' });
    const close = (v?: unknown) => {
      result = v;
      dlg.close();
    };
    dlg.append(
      h('div', { class: 'dlg-head' }, h('h2', {}, title), h('button', { class: 'icon', 'aria-label': 'Close', onclick: () => close() }, '✕')),
      body(close),
    );
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function download(name: string, text: string, type = 'text/csv'): void {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}
