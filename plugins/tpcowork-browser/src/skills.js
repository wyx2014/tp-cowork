import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Built output carries its skills; a source checkout reads them from the plugin root.
const ROOT = fileURLToPath([new URL('./skills/', import.meta.url), new URL('../skills/', import.meta.url)].find(url => existsSync(url)) ?? new URL('../skills/', import.meta.url));
export const SKILL_NAMES = ['control-browser', 'web-gui-tester'];
const PROVIDER = 'tpcowork-browser';

/** Split frontmatter without a YAML dependency: both bundled skills use one-line `key: value` fields. */
function parseSkill(raw, path) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw);
  if (!match) throw new Error(`tpcowork-browser: ${path} has no frontmatter`);
  const fields = Object.fromEntries(match[1].split(/\r?\n/u).map(line => {
    const colon = line.indexOf(':');
    const value = line.slice(colon + 1).trim();
    return [line.slice(0, colon).trim(), value.startsWith('"') ? JSON.parse(value) : value];
  }));
  if (!fields.description) throw new Error(`tpcowork-browser: ${path} has no description`);
  return { description: fields.description, content: raw.slice(match[0].length).trim() };
}

/**
 * Offer the browser skills at bundled rank. `sdkUrl` resolves the SDK address substituted into the
 * control-browser program bootstrap, or undefined when this deployment has no SDK.
 */
export function createSkillProvider(sdkUrl) {
  const candidates = SKILL_NAMES.map(skillName => {
    const directory = join(ROOT, skillName);
    const path = join(directory, 'SKILL.md');
    return { name: skillName, description: parseSkill(readFileSync(path, 'utf8'), path).description,
      invocation: { modelInvocable: true, userInvocable: true }, provider: PROVIDER, source: 'bundled', rank: 600,
      resourceBase: { kind: 'directory', path: directory }, locator: path };
  });
  return {
    name: PROVIDER,
    list: () => Promise.resolve(candidates),
    async get(candidate, options) {
      const { rank: _rank, locator, ...summary } = candidate;
      let { content } = parseSkill(await readFile(locator, { encoding: 'utf8', signal: options.signal }), locator);
      if (candidate.name === 'control-browser') {
        const url = await sdkUrl().catch(() => undefined);
        content = url ? content.replaceAll('BROWSER_SDK_URL', JSON.stringify(url))
          : `${content}\n\nThe agent.browsers SDK is not installed in this deployment; drive the browser with the browser_* tools.`;
      }
      return { ...summary, content };
    },
  };
}
