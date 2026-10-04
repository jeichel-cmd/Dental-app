# Smile Studio – Dental Team Biberach

A tablet app for trying on new teeth with patients: take or upload a smile photo, then choose and
shape the teeth (form, size, length, width, edges, canines, smile line, gaps, colour) and compare
with the original. Favourite looks are saved per patient; pictures can be saved, shared or emailed.

- **Private by design:** photos are read on the device (on-device face finder, MediaPipe) and stored
  encrypted (AES-256, key from the practice code) in the browser's storage. The page's security
  policy blocks every connection except to the app's own files.
- **Offline:** installs to the home screen ("Zum Home-Bildschirm") and works without internet.
- **No build step, no paid services.** Plain HTML, CSS and JavaScript.

## Use it

Open the hosted page on the iPad in Safari, tap Share → "Zum Home-Bildschirm", then open it from
the home screen. Set a practice code (6+ digits) on first start.

Data lives only on that device. Use Einstellungen → "Sicherung speichern" to keep an encrypted backup.

## Branding

Colours are in `styles.css` (`:root`), practice name and texts in `src/brand.js`. To show the
official logo, add it as `icons/logo.png` and set `logo: 'icons/logo.png'` in `src/brand.js`.

## Develop

```
npm install
npm run vendor     # copies the face finder and its model into vendor/
npm test           # tooth model tests
npm run fixtures   # test photos (not committed)
npm run e2e        # full run on a tablet-sized screen, screenshots in tests/output/
```

Code map: `src/teeth.js` tooth model (mm), `src/render.js` drawing into the photo, `src/face.js`
lip finder, `src/editor.js` try-on screen, `src/app.js` patients/lock/sharing, `src/store.js`
encrypted storage, `src/looks.js` starting looks, `src/shades.js` VITA shades.

## Teeth catalogue and language

- The try-on uses real photos of teeth (`assets/catalog/`, listed in `src/catalog.js`). The practice can add its own photos in the app ("Eigenes Foto"): four points and the inner lip line tell the app where the teeth are. Own photos are stored encrypted on the device and included in backups.
- Three drawn tooth models remain as an alternative.
- German is the default; DE/EN can be switched on the lock screen, the patient list and in settings.
- Brand colour: `--brand` in `styles.css` and `colors.brand` in `src/brand.js` (orange placeholder until the exact CI value is confirmed).
