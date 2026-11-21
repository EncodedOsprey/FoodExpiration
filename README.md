# Pantry Pal

Track the food you buy so less of it goes to waste. Scan the barcode, set the expiry date, and Pantry Pal alerts you before it goes off, with recipe ideas that use it up.

**App:** https://encodedosprey.github.io/FoodExpiration/ (once GitHub Pages is switched on, see [Deploying](#deploying))

It's an installable web app (PWA). It runs on iPhone, Android and desktop, works offline, and keeps your data on your device.

## Features

- **Scan to add.** Point the camera at a barcode (EAN, UPC, and GS1 codes such as DataBar or DataMatrix). Products are looked up on [Open Food Facts](https://world.openfoodfacts.org) for the name, brand, photo and category. You can also type the number or add food by hand.
- **Expiry dates your way.** Type the date or pick it, tap a shortcut (+3 days, +1 week, …), or use a suggestion:
  - For something you've bought before, Pantry Pal reuses its shelf life from last time.
  - Otherwise it estimates from the kind of food and where you keep it.
  - GS1 barcodes that carry a date fill it in automatically.
- **Alerts at several intervals.**
  - By default: 1 week, 3 days and 1 day before, on the day, and the day after.
  - Other choices: 1 month, 2 weeks, 5 days and 2 days before. Pick any combination and the time of day.
- **Recipe ideas with every alert.**
  - Built-in recipes work offline. [TheMealDB](https://www.themealdb.com) adds recipes with photos.
  - The Recipes tab finds dishes that use up several expiring things at once.
  - Recipes tick off the ingredients you already have.
- Mark food as used or tossed, snooze or dismiss an alert, and look back at your history.
- Export expiry dates to your calendar (.ics) with reminders. Back up and restore your data.

## Getting alerts

| Situation | How alerts arrive |
| --- | --- |
| App open, any browser | In the app, and as a notification once notifications are on |
| App installed on Android, or in Chrome/Edge on desktop, and closed | Background checks a few times a day (the browser decides exactly when) |
| Any device, app closed, on time | The optional [push server](#push-server-optional) |
| No notifications | Calendar export with reminders |

**iPhone and iPad:** notifications only work after **Share → Add to Home Screen** (iOS 16.4 or later). Alerts while the app is closed need the push server.

## Using it on your phone

1. Open the app link in Safari (iPhone) or Chrome (Android).
2. Install it:
   - **iPhone:** Share → Add to Home Screen.
   - **Android:** the Install button in Settings, or ⋮ → Install app.
3. Open it from your home screen, then go to **Settings → Turn on notifications**.
4. Tap **Scan**, point at the barcode, check the expiry date, and save.

Good to know:
- The camera needs HTTPS. GitHub Pages and `localhost` are fine.
- Safari can clear website data that hasn't been used for 7 days. Adding the app to the Home Screen avoids that. Use **Settings → Back up** now and then.
- Apple Calendar and Outlook keep the reminders in the calendar export. Google Calendar imports the dates but drops the reminders.

## Push server (optional)

Browsers can't schedule a notification for later, so on-time alerts while the app is closed need a small server. `server/` is one: a Node app that sends Web Push notifications when alerts fall due. It also serves the app itself, so you can host everything in one place instead of GitHub Pages.

It must be reachable over **HTTPS**, for example behind Caddy, nginx or a Cloudflare Tunnel, because a page on `https://` can't call an `http://` server.

**Docker** (build from the repository root):

```sh
docker build -f server/Dockerfile -t pantry-pal-push .
docker run -d --name pantry-pal-push --restart unless-stopped -p 8787:8787 \
  -v pantry-pal-data:/data \
  -e PUSH_TOKEN=choose-a-long-random-secret \
  -e ALLOWED_ORIGINS=https://encodedosprey.github.io \
  -e VAPID_SUBJECT=mailto:you@example.com \
  pantry-pal-push
```

**Node 22+:**

```sh
cd server
npm ci --omit=dev
PUSH_TOKEN=choose-a-long-random-secret ALLOWED_ORIGINS=https://encodedosprey.github.io npm start
```

Then in the app, open **Settings → Alerts when the app is closed**, enter the server address and token, and tap **Connect this device**.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUSH_TOKEN` | none | Secret that devices must send. Set it, otherwise anyone who finds the server can use it. |
| `ALLOWED_ORIGINS` | `*` | Comma-separated sites allowed to call the API, e.g. `https://encodedosprey.github.io`. |
| `VAPID_SUBJECT` | `mailto:admin@example.com` | Contact address given to push services. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | generated | If unset, a key pair is created and saved in `DATA_DIR/vapid.json`. Keep it: if the keys change, every device has to reconnect. |
| `DATA_DIR` | `server/data` (`/data` in Docker) | Where subscriptions and keys are stored. |
| `PORT`, `HOST` | `8787`, all interfaces | Where to listen. |
| `PUSH_HOSTS` | FCM, Mozilla, Apple, Windows | Push services the server will deliver to. |
| `MAX_SUBSCRIPTIONS` | `1000` | Maximum number of connected devices. |
| `SERVE_APP` | on | Set to `0` to serve only the API. |

The server stores, for each connected device:
- its push subscription;
- upcoming alerts (item names, times and recipe idea names);
- which alerts it has already sent.

Devices that stop syncing are forgotten after 120 days. The API is `GET /api/health`, `GET /api/vapid-public-key`, `PUT`/`DELETE /api/schedule` and `POST /api/test`.

## Privacy

- Your pantry lives in your browser's storage on this device. There are no accounts and no analytics.
- Scanned barcodes are sent to Open Food Facts, and ingredient names to TheMealDB. You can turn both off in Settings.
- If you connect a push server, it receives that device's upcoming alerts (see above). Backups never include the push token.

## Development

No build step: `app/` is plain JavaScript modules, served as is.

```sh
npm ci
npm start                      # http://localhost:8080
npm test                       # unit tests
npm run test:e2e               # end-to-end test in Chrome (set CHROME_PATH to override)
cd server && npm ci && npm test
```

- **After changing anything in `app/`**, run `npm run precache`. It updates the service worker's offline file list and version; the tests and CI check it.
- The end-to-end test runs the whole flow in a real Chrome at a GitHub Pages-style path:
  - a fake camera feed scans a barcode, then you enter an expiry date;
  - alerts fall due on a fake clock, recipe ideas show, and a pushed notification arrives;
  - calendar and backup exports, then offline use.
  - Open Food Facts and TheMealDB are mocked. Add `SCREENSHOTS=/tmp/shots` (and `COLOR_SCHEME=dark`) to save screenshots.
- Other scripts:
  - `npm run icons` regenerates the icons (uses Chrome).
  - `npm run vendor` re-bundles the barcode reader after upgrading `barcode-detector`.
  - `npm run update-ingredients` refreshes TheMealDB's ingredient list.

```
app/        the web app: index.html, css/, js/ (views/ holds the screens), sw.js, icons/, vendor/
server/     optional push server (Node + web-push), with a Dockerfile
scripts/    dev server, service worker precache stamping, icons, vendoring
test/       unit tests (node:test) and test/e2e/, the browser test
```

## Deploying

`.github/workflows/pages.yml` runs all the tests on every push and pull request. On `main`, it then publishes `app/` to GitHub Pages.

Switch Pages on once under **Settings → Pages → Build and deployment → Source: GitHub Actions**, then re-run the workflow. Pages for a private repository needs a paid GitHub plan; otherwise make the repository public.

## Credits

- Product data from [Open Food Facts](https://world.openfoodfacts.org), © Open Food Facts contributors, under the [ODbL](https://opendatacommons.org/licenses/odbl/1-0/).
- Recipes and photos from [TheMealDB](https://www.themealdb.com).
  - The app uses TheMealDB's public test key (`1`), which is allowed for development and educational use.
  - If you publish the app more widely, become a TheMealDB supporter and put your own key in `MEALDB` in `app/js/recipes.js`.
- Barcode reading by [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) (ZXing-C++) through [barcode-detector](https://github.com/Sec-ant/barcode-detector).
