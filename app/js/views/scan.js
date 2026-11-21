// Scan: live camera barcode scanner, with photo and typed-number fallbacks.
import { isValidGTIN, normalizeScan } from '../barcode.js';
import { replace } from '../nav.js';
import { Scanner, beep, cameraError, scanImage, unlockAudio } from '../scanner.js';
import { getSettings } from '../settings.js';
import { $, html, icon, mount, setHeader, toast } from '../ui.js';

function openForm({ code, expiry }) {
  const query = new URLSearchParams({ code });
  if (expiry) query.set('exp', expiry);
  replace(`/add?${query}`);
}

export function render(el) {
  setHeader({ title: 'Scan' });
  unlockAudio();
  mount(
    el,
    html`<div class="scanner" id="scanner">
        <video muted playsinline autoplay aria-label="Camera preview"></video>
        <div class="frame" aria-hidden="true"></div>
        <div class="laser" aria-hidden="true"></div>
        <div class="tools">
          <button type="button" id="torch" hidden aria-pressed="false" aria-label="Flashlight">${icon('flash')}</button>
          <button type="button" id="flip" hidden aria-label="Switch camera">${icon('switch')}</button>
        </div>
        <div class="status" id="scan-status" role="status">Starting camera…</div>
      </div>
      <div class="card">
        <form class="manual-code" id="manual">
          <input name="code" inputmode="numeric" autocomplete="off" enterkeyhint="search"
            placeholder="Or type the barcode number" aria-label="Barcode number">
          <button class="btn primary" type="submit">Look up</button>
        </form>
        <div class="actions grid">
          <label class="btn">${icon('image')} Scan a photo
            <input type="file" accept="image/*" id="photo" class="sr-only"></label>
          <a class="btn" href="#/add">${icon('edit')} No barcode</a>
        </div>
      </div>
      <p class="hint">Point the camera at the barcode on the package. Fresh food sometimes has a GS1 code that includes the expiry date too.</p>`,
  );

  const box = $('#scanner', el);
  const status = $('#scan-status', el);
  const settings = getSettings();
  const scanner = new Scanner($('video', el), {
    onDetect(result) {
      box.classList.add('found');
      status.textContent = `Found ${result.code}`;
      if (settings.beep) beep();
      if (settings.vibrate) navigator.vibrate?.(80);
      setTimeout(() => openForm(result), 250);
    },
  });

  let failed = false;
  async function start() {
    box.classList.remove('found');
    status.textContent = 'Starting camera…';
    try {
      if (!(await scanner.start())) return;
      status.textContent = 'Point the camera at a barcode';
      $('#torch', el).hidden = !scanner.canTorch();
      $('#flip', el).hidden = !(await scanner.hasMultipleCameras());
    } catch (err) {
      console.warn('Camera failed:', err);
      failed = true;
      scanner.stop();
      mount(box, html`<div class="message"><p>${cameraError(err)}</p></div>`);
    }
  }
  start();

  $('#torch', el).addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const on = button.getAttribute('aria-pressed') !== 'true';
    try {
      await scanner.setTorch(on);
      button.setAttribute('aria-pressed', String(on));
    } catch {
      toast('The flashlight isn’t available.');
    }
  });
  $('#flip', el).addEventListener('click', () => scanner.flip().catch(() => toast('Couldn’t switch camera.')));

  $('#manual', el).addEventListener('submit', (event) => {
    event.preventDefault();
    const value = new FormData(event.target).get('code').trim();
    const { code } = normalizeScan(value);
    if (!/^\d{6,14}$/.test(code)) {
      toast('Enter the numbers under the barcode (8 to 14 digits).');
      return;
    }
    if (/^\d{8}$|^\d{12,14}$/.test(code) && !isValidGTIN(code)) {
      toast('That number doesn’t look right. Check the digits and try again.');
      return;
    }
    openForm({ code });
  });

  $('#photo', el).addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    status.textContent = 'Reading photo…';
    try {
      const result = await scanImage(file);
      if (result) openForm(result);
      else toast('No barcode found in that photo. Try a closer, sharper shot.');
    } catch (err) {
      console.warn(err);
      toast('Couldn’t read that photo.');
    } finally {
      event.target.value = '';
    }
  });

  // Release the camera while the app is in the background.
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') scanner.stop();
    else if (!failed && !box.classList.contains('found')) start();
  };
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    scanner.stop();
  };
}
