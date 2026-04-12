/**
 * Build a tight favicon PNG: trim transparent margins, pad to square, scale to 64px.
 * Optional center "zoom" so the mark fills a bit more of the bitmap (tab size is still fixed by the browser).
 */
import sharp from "sharp";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const src = join(root, "public", "fairflow-logo.png");
const out = join(root, "public", "fairflow-favicon-tab.png");

/** Slightly enlarge the mark inside the output (crop center). ~1.08–1.25 typical. */
const ZOOM = 1.2;
const OUT = 64;

const trimmed = await sharp(src).trim().toBuffer();
const meta = await sharp(trimmed).metadata();
const w = meta.width;
const h = meta.height;
const side = Math.max(w, h);
const padT = Math.floor((side - h) / 2);
const padB = Math.ceil((side - h) / 2);
const padL = Math.floor((side - w) / 2);
const padR = Math.ceil((side - w) / 2);

const square = await sharp(trimmed)
  .extend({
    top: padT,
    bottom: padB,
    left: padL,
    right: padR,
    background: { r: 0, g: 0, b: 0, alpha: 0 }
  })
  .png()
  .toBuffer();

const scaled = Math.round(OUT * ZOOM);
const left = Math.floor((scaled - OUT) / 2);
const top = Math.floor((scaled - OUT) / 2);

await sharp(square)
  .resize(scaled, scaled, { kernel: sharp.kernel.lanczos3 })
  .extract({ left, top, width: OUT, height: OUT })
  .png()
  .toFile(out);

console.log("OK:", out, "from", src, `(${w}x${h} → ${OUT}x${OUT} square, zoom ${ZOOM})`);
