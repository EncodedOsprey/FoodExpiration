// Platform detection and the "install app" prompt.
import { emit } from './events.js';

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

let installPrompt = null;

export function initInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    emit('installable', true);
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    emit('installable', false);
  });
}

export const canPromptInstall = () => installPrompt !== null;

export async function promptInstall() {
  if (!installPrompt) return false;
  const prompt = installPrompt;
  installPrompt = null;
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  emit('installable', false);
  return outcome === 'accepted';
}
