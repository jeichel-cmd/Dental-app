// End-to-end check on a tablet-sized screen: set the code, add a patient, add a smile photo,
// try looks, save favourites, compare before/after, and build the share image.
// Run `node scripts/fixture.mjs` once first. Writes screenshots to tests/output/.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { serve } from './serve.mjs';

const out = 'tests/output';
await mkdir(out, { recursive: true });
const { server, base } = serve();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
const outside = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/favicon|XNNPACK|gl_context|inference_feedback|face_landmarker_graph|Graph successfully/.test(m.text()) && errors.push(m.text()));
page.on('request', (r) => !r.url().startsWith(base) && !r.url().startsWith('blob:') && !r.url().startsWith('data:') && outside.push(r.url()));

const check = (cond, msg) => {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  console.log(`ok - ${msg}`);
};
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const typeCode = async (code) => {
  for (const d of code) await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'Bestätigen' }).click();
};

await page.goto(base);
await page.getByText('Praxis-Code festlegen').waitFor();
await shot('01-lock');
await typeCode('246810');
await page.getByText('Code wiederholen').waitFor();
await typeCode('246810');
await page.getByText('Willkommen').waitFor();
check(true, 'code set, empty patient list shown');

await page.getByRole('button', { name: 'Neuer Patient' }).first().click();
await page.getByLabel('Name').fill('Maria Muster');
await page.getByLabel('E-Mail').fill('maria@example.com');
await page.getByText('Einwilligung zu Fotos').click();
await shot('02-new-patient');
await page.getByRole('button', { name: 'Anlegen' }).click();
await page.getByRole('heading', { name: 'Maria Muster' }).waitFor();

const chooser = page.waitForEvent('filechooser');
await page.getByRole('button', { name: /Foto hochladen/ }).click();
await (await chooser).setFiles('tests/fixtures/smile-1.jpg');
await page.locator('.editor').waitFor({ timeout: 60000 });
await page.waitForTimeout(800);
check(await page.locator('.note').count() === 0, 'mouth found automatically');
await shot('03-editor-natural');

await page.getByRole('button', { name: 'Ansicht wechseln' }).click();
await page.waitForTimeout(300);
await shot('04-editor-smile-zoom');

// Try a look and save it as a favourite.
await page.getByRole('button', { name: /Hollywood/ }).click();
await page.waitForTimeout(300);
await shot('05-look-hollywood');
await page.getByRole('button', { name: 'Aktuellen Look als Favorit speichern' }).click();
await page.getByLabel('Name').fill('Hollywood hell');
await page.getByRole('button', { name: 'Speichern', exact: true }).click();
await page.getByText('„Hollywood hell“ gespeichert').waitFor();

// Shape it by hand.
await page.getByRole('tab', { name: 'Form' }).click();
await page.getByRole('button', { name: /Oval/ }).click();
await page.getByLabel('Länge').fill('1.18');
await page.getByLabel('Kanten').fill('0.1');
await page.getByLabel('Länge').dispatchEvent('change');
await page.getByRole('tab', { name: 'Farbe' }).click();
await page.getByRole('button', { name: 'Farbe A1' }).click();
await page.waitForTimeout(300);
await shot('06-custom-form');
await page.getByRole('button', { name: 'Aktuellen Look als Favorit speichern' }).click();
await page.getByLabel('Name').fill('Lang & weich');
await page.getByRole('button', { name: 'Speichern', exact: true }).click();
await page.getByText('„Lang & weich“ gespeichert').waitFor();

// Move the teeth by dragging on the photo.
const box = await page.locator('.view').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 4, box.y + box.height / 2 + 6, { steps: 4 });
await page.mouse.up();

// Jump between favourites and the original.
await page.getByRole('tab', { name: 'Vorher' }).click();
await page.waitForTimeout(300);
await shot('07-before');
check(await page.locator('.badge.before').count() === 1, 'original photo shown');
await page.getByRole('tab', { name: /Hollywood hell/ }).click();
await page.waitForTimeout(300);
check(await page.locator('.chip.active', { hasText: 'Hollywood hell' }).count() === 1, 'favourite selected from the strip');
await shot('08-favourite');

await page.getByRole('tab', { name: 'Feinschliff' }).click();
await shot('09-details');
await page.getByRole('tab', { name: 'Position' }).click();
await page.getByRole('button', { name: /Lippen anpassen/ }).click();
await page.waitForTimeout(300);
await shot('10-lip-points');
await page.getByRole('button', { name: /Lippen fertig/ }).click();

// Share image.
await page.getByRole('button', { name: /Teilen/ }).first().click();
await page.locator('.export-preview[src]').waitFor();
await page.waitForTimeout(500);
await shot('11-share');
const dl = page.waitForEvent('download');
await page.getByRole('button', { name: 'Speichern', exact: true }).click();
const file = await dl;
check(/Maria-Muster-Vorher-Nachher-\d{4}-\d\d-\d\d\.jpg/.test(file.suggestedFilename()), `share image named ${file.suggestedFilename()}`);
await file.saveAs(`${out}/export-compare.jpg`);
await page.getByRole('button', { name: 'Schließen' }).click();

// Back to the patient: photo and favourites listed.
await page.getByRole('button', { name: 'Zurück', exact: true }).click();
await page.getByRole('heading', { name: 'Favoriten' }).waitFor();
check(await page.locator('.fav-card').count() === 2, 'two favourites on the patient page');
await page.waitForTimeout(500);
await shot('12-patient');

// Second patient with a tilted head.
await page.getByRole('button', { name: 'Zurück', exact: true }).click();
await page.getByRole('button', { name: 'Neuer Patient' }).click();
await page.getByLabel('Name').fill('Jonas Beispiel');
await page.getByRole('button', { name: 'Anlegen' }).click();
const chooser2 = page.waitForEvent('filechooser');
await page.getByRole('button', { name: /Foto hochladen/ }).click();
await (await chooser2).setFiles('tests/fixtures/smile-2.jpg');
await page.getByRole('button', { name: 'Ja, liegt vor' }).click();
await page.locator('.editor').waitFor({ timeout: 60000 });
await page.getByRole('button', { name: /Markant/ }).click();
await page.getByRole('button', { name: 'Ansicht wechseln' }).click();
await page.waitForTimeout(500);
await shot('13-tilted-strong');

// Lock and unlock: data survives, encrypted.
await page.getByRole('button', { name: 'Zurück', exact: true }).click();
await page.getByRole('button', { name: 'Zurück', exact: true }).click();
await page.getByRole('button', { name: 'Sperren' }).click();
await page.getByText('Praxis-Code eingeben').waitFor();
await typeCode('111111');
await page.getByText('Falscher Code.').waitFor();
await typeCode('246810');
await page.getByText('Maria Muster').waitFor();
await shot('14-patients');
const raw = await page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('smile-studio');
  req.onsuccess = () => {
    const t = req.result.transaction('vault').objectStore('vault').get('index');
    t.onsuccess = () => resolve(JSON.stringify(t.result));
  };
}));
check(!raw.includes('Maria'), 'patient names are stored encrypted');

// Phone size.
await page.setViewportSize({ width: 390, height: 844 });
await page.getByText('Maria Muster').click();
await page.locator('.photo-open').first().click();
await page.locator('.editor').waitFor();
await page.waitForTimeout(500);
await shot('15-phone-editor');

check(outside.length === 0, `no requests outside the app (${outside.join(', ') || 'none'})`);
check(errors.length === 0, `no page errors (${errors.join(' | ') || 'none'})`);
await browser.close();
server.close();
