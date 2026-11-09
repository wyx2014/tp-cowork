/**
 * Bake the home backdrop's fades into the artwork as transparency. CSS mask-image fades rendered as hard cuts on Kylin
 * graphics stacks (the semi-transparent part of the mask vanished), while image transparency composites everywhere.
 * Run after changing assets/home-<mode>.webp: node fade-home-art.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const sharp = createRequire(fileURLToPath(new URL('../../../deepseek-harness/apps/desktop/package.json', import.meta.url)))('sharp');

/** The skyline fades in over the left 45% of the picture. */
export const SKY_FADE = 0.45;
/** The water layer is the picture's bottom 1/2.75, fading in over its top 32%. */
export const WATER_SHARE = 1 / 2.75;
export const WATER_FADE = 0.32;

async function fade(mode) {
  const source = fileURLToPath(new URL(`assets/home-${mode}.webp`, import.meta.url));
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const ramp = (position, length) => Math.min(1, position / length);
  const sky = Buffer.from(data);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) sky[(y * width + x) * 4 + 3] = Math.round(255 * ramp(x, width * SKY_FADE));
  }
  const top = height - Math.round(height * WATER_SHARE);
  const rows = height - top;
  const water = Buffer.from(data.subarray(top * width * 4));
  for (let y = 0; y < rows; y++) {
    const alpha = Math.round(255 * ramp(y, rows * WATER_FADE));
    for (let x = 0; x < width; x++) water[(y * width + x) * 4 + 3] = alpha;
  }
  const encode = (pixels, rowCount, name) => sharp(pixels, { raw: { width, height: rowCount, channels: 4 } })
    .webp({ quality: 88, alphaQuality: 100, effort: 6 })
    .toFile(fileURLToPath(new URL(`assets/home-${mode}-${name}.webp`, import.meta.url)));
  await encode(sky, height, 'sky');
  await encode(water, rows, 'water');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const mode of ['light', 'dark']) await fade(mode);
  console.log('Faded home artwork written to assets/home-<mode>-{sky,water}.webp');
}
