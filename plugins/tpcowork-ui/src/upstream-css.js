import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

/** Read the CSS and class map shipped in an upstream Client bundle. */
export async function upstreamCss(file) {
  const packageRoot = new URL(file.href.slice(0, file.href.indexOf('/src/') + 1));
  const bundle = await readFile(new URL('lib/client.js', packageRoot), 'utf8');
  const name = basename(file.pathname);
  const regions = bundle.split('//#region \\0dsh-css:');
  const region = regions.find(text => text.slice(0, text.indexOf('\n')).trim().endsWith(`/${name}.mjs`));
  const source = region?.slice(0, region.indexOf('//#endregion'));
  const css = source?.match(/\bconst css[\w$]* = ("(?:[^"\\]|\\.)*");/);
  const classes = source?.match(/\bvar [\w$]+ = (\{[\s\S]*?\});/);
  if (!css || !classes) {
    throw new Error(`TP Cowork: built upstream stylesheet ${name} is missing; rebuild DSH before the appearance plugin`);
  }
  return { css: JSON.parse(css[1]), classes: JSON.parse(classes[1]) };
}
