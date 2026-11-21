// VAPID keys identify this server to the browsers' push services. They come from the
// environment, or are generated once and saved in the data folder.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateVAPIDKeys } from 'web-push';

export async function loadVapid({ dataDir, env = process.env }) {
  const subject = env.VAPID_SUBJECT || 'mailto:admin@example.com';
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    return { subject, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  }
  const file = join(dataDir, 'vapid.json');
  try {
    const { publicKey, privateKey } = JSON.parse(await readFile(file, 'utf8'));
    if (publicKey && privateKey) return { subject, publicKey, privateKey };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const keys = generateVAPIDKeys();
  await mkdir(dataDir, { recursive: true });
  await writeFile(file, `${JSON.stringify(keys, null, 2)}\n`, { mode: 0o600 });
  console.log(`Generated new VAPID keys in ${file}. Keep this file: devices must reconnect if it changes.`);
  return { subject, ...keys };
}
