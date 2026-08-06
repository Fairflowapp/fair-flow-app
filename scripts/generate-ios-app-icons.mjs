/**
 * Build iOS AppIcon.appiconset from the same visual as Android adaptive launcher:
 * white background + fairflow_logo (matches mipmap foreground).
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync, rmSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const logoPath = join(root, 'android/app/src/main/res/drawable-nodpi/fairflow_logo.png');
const outDir = join(root, 'ios/App/App/Assets.xcassets/AppIcon.appiconset');

/** @type {{ w: number; name: string }[]} */
const sizes = [
  { w: 40, name: 'AppIcon-20@2x.png' },
  { w: 60, name: 'AppIcon-20@3x.png' },
  { w: 58, name: 'AppIcon-29@2x.png' },
  { w: 87, name: 'AppIcon-29@3x.png' },
  { w: 80, name: 'AppIcon-40@2x.png' },
  { w: 120, name: 'AppIcon-40@3x.png' },
  { w: 120, name: 'AppIcon-60@2x.png' },
  { w: 180, name: 'AppIcon-60@3x.png' },
  { w: 20, name: 'AppIcon-20~ipad.png' },
  { w: 40, name: 'AppIcon-20@2x~ipad.png' },
  { w: 29, name: 'AppIcon-29~ipad.png' },
  { w: 58, name: 'AppIcon-29@2x~ipad.png' },
  { w: 40, name: 'AppIcon-40~ipad.png' },
  { w: 80, name: 'AppIcon-40@2x~ipad.png' },
  { w: 76, name: 'AppIcon-76~ipad.png' },
  { w: 152, name: 'AppIcon-76@2x~ipad.png' },
  { w: 167, name: 'AppIcon-83.5@2x~ipad.png' },
  { w: 1024, name: 'AppIcon-1024.png' },
];

async function buildMaster1024() {
  const logo = sharp(logoPath).ensureAlpha();
  const targetLogo = Math.round(1024 * 0.72);
  const resized = await logo
    .resize(targetLogo, targetLogo, { fit: 'inside', withoutEnlargement: false })
    .toBuffer();
  return sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: resized, gravity: 'center' }])
    .png();
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) {
    if (f.endsWith('.png')) rmSync(join(outDir, f));
  }

  const master = await buildMaster1024();
  const masterBuf = await master.png().toBuffer();

  for (const { w, name } of sizes) {
    const buf = await sharp(masterBuf)
      .resize(w, w, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer();
    writeFileSync(join(outDir, name), buf);
  }

  const contents = {
    images: [
      { size: '20x20', idiom: 'iphone', filename: 'AppIcon-20@2x.png', scale: '2x' },
      { size: '20x20', idiom: 'iphone', filename: 'AppIcon-20@3x.png', scale: '3x' },
      { size: '29x29', idiom: 'iphone', filename: 'AppIcon-29@2x.png', scale: '2x' },
      { size: '29x29', idiom: 'iphone', filename: 'AppIcon-29@3x.png', scale: '3x' },
      { size: '40x40', idiom: 'iphone', filename: 'AppIcon-40@2x.png', scale: '2x' },
      { size: '40x40', idiom: 'iphone', filename: 'AppIcon-40@3x.png', scale: '3x' },
      { size: '60x60', idiom: 'iphone', filename: 'AppIcon-60@2x.png', scale: '2x' },
      { size: '60x60', idiom: 'iphone', filename: 'AppIcon-60@3x.png', scale: '3x' },
      { size: '20x20', idiom: 'ipad', filename: 'AppIcon-20~ipad.png', scale: '1x' },
      { size: '20x20', idiom: 'ipad', filename: 'AppIcon-20@2x~ipad.png', scale: '2x' },
      { size: '29x29', idiom: 'ipad', filename: 'AppIcon-29~ipad.png', scale: '1x' },
      { size: '29x29', idiom: 'ipad', filename: 'AppIcon-29@2x~ipad.png', scale: '2x' },
      { size: '40x40', idiom: 'ipad', filename: 'AppIcon-40~ipad.png', scale: '1x' },
      { size: '40x40', idiom: 'ipad', filename: 'AppIcon-40@2x~ipad.png', scale: '2x' },
      { size: '76x76', idiom: 'ipad', filename: 'AppIcon-76~ipad.png', scale: '1x' },
      { size: '76x76', idiom: 'ipad', filename: 'AppIcon-76@2x~ipad.png', scale: '2x' },
      { size: '83.5x83.5', idiom: 'ipad', filename: 'AppIcon-83.5@2x~ipad.png', scale: '2x' },
      {
        size: '1024x1024',
        idiom: 'ios-marketing',
        filename: 'AppIcon-1024.png',
        scale: '1x',
      },
    ],
    info: { author: 'xcode', version: 1 },
  };

  writeFileSync(join(outDir, 'Contents.json'), JSON.stringify(contents, null, 2) + '\n');
  console.log('Wrote', sizes.length, 'PNGs + Contents.json to', outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
