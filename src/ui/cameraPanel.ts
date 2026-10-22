import type { App } from '../core/app';
import { CameraModule, cameraSupported, clipsSupported, listCameras, VIDEO } from '../camera/camera';
import { h, openDialog, toast } from './dom';

/** Card for one camera: live preview, snapshot, mark, focus/exposure lock, what it has recorded. */
export function cameraPanel(app: App, cam: CameraModule): { el: HTMLElement; update: () => void } {
  const statusEl = h('span', { class: 'status' });
  const titleEl = h('span', { class: 'dev-label' }, cam.label);
  const modelEl = h('span', { class: 'dev-model' });
  const info = h('p', { class: 'cam-info' });
  const clipEl = h('p', { class: 'cam-clip' });
  const errEl = h('p', { class: 'error-text' });
  const lockBtn = h('button', { onclick: () => void toggleLock() }, 'Lock focus & exposure') as HTMLButtonElement;
  const snapBtn = h('button', { onclick: () => void snap() }, 'Snapshot') as HTMLButtonElement;
  const markBtn = h('button', { onclick: () => mark(), title: 'Save a clip from 60 s before to 60 s after now' }, 'Mark (save clip)') as HTMLButtonElement;
  const retryBtn = h('button', { class: 'primary', onclick: () => void cam.start() }, 'Reconnect') as HTMLButtonElement;

  const menu = h(
    'details',
    { class: 'menu' },
    h('summary', { 'aria-label': 'Camera menu' }, '⋯'),
    h(
      'div',
      { class: 'menu-items' },
      h('button', { onclick: () => rename() }, 'Rename'),
      h('button', { class: 'danger-text', onclick: () => remove() }, 'Remove from page'),
    ),
  );
  menu.querySelector('.menu-items')!.addEventListener('click', () => (menu.open = false));

  const el = h(
    'section',
    { class: 'panel camera-panel', 'data-camera': cam.id },
    h('header', {}, h('span', { class: 'cam-icon', 'aria-hidden': 'true' }, '◉'), h('div', { class: 'dev-title' }, titleEl, modelEl), statusEl, menu),
    h('div', { class: 'cam-view' }, cam.video),
    h(
      'div',
      { class: 'cam-side' },
      info,
      clipEl,
      errEl,
      h('div', { class: 'cam-actions' }, snapBtn, markBtn, lockBtn, retryBtn),
      h('p', { class: 'hint' }, `Every change saves a clip from ${VIDEO.clipPreMs / 1000} s before to ${VIDEO.clipPostMs / 1000} s after it: a setpoint or switch changed here, stirring starting or stopping, a setpoint changed on the unit, Stop all, a note. If nothing is recording, the first change starts the recording. While recording, a ${VIDEO.width}×${VIDEO.height} photo every ${VIDEO.timelapseMs / 1000} s. No continuous video; settings fixed for now.`),
    ),
  );

  function update() {
    titleEl.textContent = cam.label;
    modelEl.textContent = cam.deviceLabel || 'USB camera';
    statusEl.textContent = cam.status;
    statusEl.dataset.state = cam.status === 'Recording' ? 'stirring' : cam.status === 'Not available' ? 'disconnected' : 'idle';
    const live = cam.status === 'Live' || cam.status === 'Recording';
    el.classList.toggle('is-offline', !live && cam.status !== 'Starting');
    const parts = [cam.size.width ? `${cam.size.width}×${cam.size.height}` : ''];
    if (cam.status === 'Recording') {
      const n = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`;
      parts.push(n(cam.counts.timelapse, 'time-lapse frame'), n(cam.counts.clip, 'clip'));
      if (cam.counts.snapshot) parts.push(n(cam.counts.snapshot, 'snapshot'));
    }
    if (live && clipsSupported()) parts.push(`encoding ${cam.encodeFps} fps`);
    info.textContent = parts.filter(Boolean).join(' · ');
    clipEl.textContent = cam.clipNote;
    errEl.textContent = cam.error;
    snapBtn.disabled = !live;
    markBtn.disabled = cam.status !== 'Recording' || !clipsSupported();
    lockBtn.hidden = !live || !cam.canLock;
    lockBtn.textContent = cam.locked ? 'Unlock focus & exposure' : 'Lock focus & exposure';
    lockBtn.setAttribute('aria-pressed', String(cam.locked));
    retryBtn.hidden = live || cam.status === 'Starting';
  }

  async function toggleLock() {
    try {
      await cam.setLocked(!cam.locked);
      toast(cam.locked ? 'Focus and exposure locked' : 'Focus and exposure back to automatic');
    } catch (e) {
      toast(`This camera refused: ${(e as Error).message}`, 'error');
    }
  }

  async function snap() {
    const m = await cam.snapshot();
    if (m) toast(app.run ? 'Snapshot added to the recording' : 'Snapshot downloaded (not recording)');
  }

  function mark() {
    app.note(`${cam.label}: marked`);
    toast('Clip will be saved (60 s before and after now)');
  }

  function rename() {
    const name = prompt('Name for this camera', cam.label);
    if (name?.trim()) {
      cam.label = name.trim();
      app.save();
      update();
    }
  }

  function remove() {
    if (!confirm(`Remove ${cam.label} from this page?${app.run ? ' Its media so far stays in the recording.' : ''}`)) return;
    app.removeCamera(cam);
  }

  update();
  return { el, update };
}

export function openAddCamera(app: App): void {
  void openDialog('Add camera', (close) => {
    const pick = h('select', { 'aria-label': 'Camera' }) as HTMLSelectElement;
    const label = h('input', { type: 'text', placeholder: 'e.g. Hood camera' }) as HTMLInputElement;
    const err = h('p', { class: 'error-text', role: 'alert' });
    const go = h('button', { class: 'primary', type: 'submit', disabled: true }, 'Add camera') as HTMLButtonElement;

    if (!cameraSupported()) {
      err.textContent = 'This browser has no camera access. Use Chromium or Chrome over https.';
    } else {
      pick.append(h('option', { value: '' }, 'Asking the browser for cameras…'));
      listCameras()
        .then((cams) => {
          const used = new Set(app.cameras.map((c) => c.deviceId));
          pick.replaceChildren(...cams.map((c, i) => h('option', { value: c.deviceId }, `${c.label || `Camera ${i + 1}`}${used.has(c.deviceId) ? ' (already on the page)' : ''}`)));
          if (!cams.length) err.textContent = 'No camera found. Plug in a USB camera and open this dialog again.';
          go.disabled = !cams.length;
        })
        .catch((e) => {
          pick.replaceChildren();
          err.textContent = (e as Error).name === 'NotAllowedError'
            ? 'Camera permission was refused. Allow the camera for this site (lock icon in the address bar) and try again.'
            : (e as Error).message;
        });
    }

    const submit = async (e: Event) => {
      e.preventDefault();
      go.disabled = true;
      const name = label.value.trim() || 'Camera';
      const cam = await app.addCamera(name, pick.value);
      if (cam.status === 'Not available') {
        err.textContent = cam.error || 'The camera did not start.';
        go.disabled = false;
        return;
      }
      toast(`${name} added`);
      close(true);
    };

    return h(
      'form',
      { class: 'form', onsubmit: submit },
      h('label', {}, 'Camera', pick),
      h('label', {}, 'Name on this page', label),
      h('p', { class: 'hint' }, 'USB (UVC) webcams work directly. The browser asks for camera permission once. Point the camera at the apparatus, not at people.'),
      err,
      h('div', { class: 'actions' }, go),
    );
  });
}
