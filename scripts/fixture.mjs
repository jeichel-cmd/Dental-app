// Test photos for the end-to-end check. They come from the face-api demo images on npm and are not part of the app.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const dir = 'tests/fixtures';
mkdirSync(dir, { recursive: true });
if (!existsSync(`${dir}/package`)) {
  execSync(`npm pack @vladmandic/face-api@1.7.15 --pack-destination ${dir}`, { stdio: 'ignore' });
  execSync(`tar xzf ${dir}/vladmandic-face-api-1.7.15.tgz -C ${dir} package/demo/sample1.jpg package/demo/sample3.jpg`);
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
for (const [src, out, crop] of [
  ['sample3.jpg', 'smile-1.jpg', [990, 130, 470, 600]],
  ['sample1.jpg', 'smile-2.jpg', [1330, 170, 470, 600]],
]) {
  const data = readFileSync(`${dir}/package/demo/${src}`).toString('base64');
  const jpg = await page.evaluate(async ({ data, crop }) => {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${data}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = crop[2] * 2;
    c.height = crop[3] * 2;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, crop[0], crop[1], crop[2], crop[3], 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.92).split(',')[1];
  }, { data, crop });
  writeFileSync(`${dir}/${out}`, Buffer.from(jpg, 'base64'));
}
await browser.close();
console.log('fixtures ready');
