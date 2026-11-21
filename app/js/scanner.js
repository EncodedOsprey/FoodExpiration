// Camera barcode scanning. Uses the browser's built-in BarcodeDetector where it exists
// (Chrome on Android) and otherwise a bundled WebAssembly ZXing reader (iPhone, desktop).
import { isValidGTIN, normalizeScan } from './barcode.js';

const WANTED = [
  'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'databar', 'databar_expanded', 'databar_limited',
  'data_matrix', 'qr_code', 'itf', 'code_39',
];
// Formats without a reliable check digit must be read twice in a row before we trust them.
const WEAK = /^(code_39|code_93|codabar|itf)/;

let detectorPromise = null;

async function createDetector() {
  if ('BarcodeDetector' in globalThis) {
    try {
      const supported = await globalThis.BarcodeDetector.getSupportedFormats();
      if (supported.includes('ean_13')) {
        return new globalThis.BarcodeDetector({ formats: WANTED.filter((f) => supported.includes(f)) });
      }
    } catch {
      // fall through to the bundled reader
    }
  }
  const { BarcodeDetector, prepareZXingModule } = await import('../vendor/barcode-detector.js');
  const wasmUrl = new URL('../vendor/zxing_reader.wasm', import.meta.url).href;
  prepareZXingModule({
    overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
  });
  const supported = await BarcodeDetector.getSupportedFormats();
  return new BarcodeDetector({ formats: WANTED.filter((f) => supported.includes(f)) });
}

export function getDetector() {
  detectorPromise ??= createDetector().catch((err) => {
    detectorPromise = null;
    throw err;
  });
  return detectorPromise;
}

/** Decode a barcode from a photo (a fallback when live scanning isn't possible). */
export async function scanImage(file) {
  const detector = await getDetector();
  const bitmap = await createImageBitmap(file);
  try {
    const codes = await detector.detect(bitmap);
    const code = codes.find((c) => c.rawValue);
    return code ? normalizeScan(code.rawValue, code.format) : null;
  } finally {
    bitmap.close?.();
  }
}

export function cameraError(err) {
  if (!window.isSecureContext) return 'The camera only works over HTTPS.';
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was blocked. Allow it in your browser’s site settings, or use the options below.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera is being used by another app.';
    default:
      return 'The camera couldn’t be started.';
  }
}

const releaseStream = (stream) => {
  for (const track of stream?.getTracks() ?? []) track.stop();
};

/**
 * Live scanner on a <video>. Calls onDetect({ code, expiry, format }) once per confirmed
 * read, then pauses until resume().
 */
export class Scanner {
  constructor(video, { onDetect, interval = 120 } = {}) {
    this.video = video;
    this.onDetect = onDetect;
    this.interval = interval;
    this.stream = null;
    this.facing = 'environment';
    this.session = 0; // bumped by start/stop so late camera results are discarded
    this.loopId = 0; // bumped to end the current detection loop
    this.last = null;
  }

  get track() {
    return this.stream?.getVideoTracks()[0] ?? null;
  }

  /** Resolves true once scanning, false if stop() was called meanwhile. */
  async start() {
    const session = ++this.session;
    this.loopId++;
    this.release();
    if (!navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error('getUserMedia unavailable'), { name: 'NotFoundError' });
    }
    const streamPromise = navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: this.facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    let detector;
    let stream;
    try {
      [detector, stream] = await Promise.all([getDetector(), streamPromise]);
    } catch (err) {
      streamPromise.then(releaseStream, () => {});
      throw err;
    }
    if (session !== this.session) {
      releaseStream(stream);
      return false;
    }
    this.detector = detector;
    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play().catch(() => {});
    if (session !== this.session) return false;
    this.loop();
    return true;
  }

  async loop() {
    const id = ++this.loopId;
    this.last = null;
    while (id === this.loopId) {
      const started = performance.now();
      if (this.video.readyState >= 2) {
        try {
          const codes = await this.detector.detect(this.video);
          if (id === this.loopId) this.handle(codes);
        } catch {
          // transient decode errors are normal while the camera moves
        }
      }
      const wait = Math.max(30, this.interval - (performance.now() - started));
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  handle(codes) {
    const hit = codes.find((c) => c.rawValue);
    if (!hit) return;
    const result = { ...normalizeScan(hit.rawValue, hit.format), format: hit.format };
    const trusted = !WEAK.test(hit.format) || isValidGTIN(result.code);
    const repeated = this.last?.code === result.code;
    this.last = result;
    if (!trusted && !repeated) return;
    this.loopId++;
    this.onDetect?.(result);
  }

  /** Scan again after a detection. */
  resume() {
    if (this.stream) this.loop();
  }

  canTorch() {
    return Boolean(this.track?.getCapabilities?.().torch);
  }

  async setTorch(on) {
    await this.track?.applyConstraints({ advanced: [{ torch: on }] });
  }

  async hasMultipleCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    return devices.filter((d) => d.kind === 'videoinput').length > 1;
  }

  flip() {
    this.facing = this.facing === 'environment' ? 'user' : 'environment';
    return this.start();
  }

  release() {
    releaseStream(this.stream);
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }

  stop() {
    this.session++;
    this.loopId++;
    this.release();
  }
}

let audio = null;
/** Short confirmation beep. */
export function beep() {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') audio.resume();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 1320;
    gain.gain.setValueAtTime(0.15, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.12);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.12);
  } catch {
    // audio is optional
  }
}

/** Create the audio context during a tap so later beeps are allowed to play. */
export function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') audio.resume();
  } catch {
    // ignore
  }
}
