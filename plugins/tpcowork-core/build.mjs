import { chmod, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deploymentPatch, loadDeployment, resolveDeployment } from './deployment.js';

/** Bundle the pinned DSH configuration helpers; installed core packages need no source checkout. */
async function buildModel(directory) {
  const requireHarness = createRequire(new URL('../../../deepseek-harness/package.json', import.meta.url));
  const requireBuild = createRequire(requireHarness.resolve('tsx/package.json'));
  const { build } = requireBuild('esbuild');
  await build({
    entryPoints: [fileURLToPath(new URL('src/model.ts', import.meta.url))],
    outfile: fileURLToPath(new URL('model.js', directory)),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['@deepseek-ai/*', '@earendil-works/*'],
    logLevel: 'silent',
  });
  await build({
    entryPoints: [fileURLToPath(new URL('src/hub-model.ts', import.meta.url))],
    outfile: fileURLToPath(new URL('hub-model.js', directory)),
    bundle: true, platform: 'node', format: 'esm', target: 'node22',
    external: ['@deepseek-ai/*', '@earendil-works/*'], logLevel: 'silent',
  });
}

/** Prepare an independently installable core bundle; reference checkout is read only on explicit import. */
export async function buildCore({ directory = new URL('./', import.meta.url), referenceRoot, env = process.env } = {}) {
  let deployment;
  if (referenceRoot !== undefined) {
    let input;
    try {
      input = JSON.parse(await readFile(resolve(referenceRoot, 'config/provider/desktop-deployment.local.json'), 'utf8'));
    } catch {
      throw new Error('TP Cowork: cannot import the reference desktop deployment configuration');
    }
    deployment = resolveDeployment(input, env);
  } else if (env.TPCOWORK_MODEL_SOURCE === 'static') {
    const stored = await loadDeployment(directory, env);
    deployment = stored.modelSource === 'skillhub' ? resolveDeployment({}, env) : stored;
  } else {
    // Old local deployment files may contain shared keys. Normal builds never import or repackage them.
    deployment = { modelSource: 'skillhub' };
  }
  await buildModel(directory);
  const credentialsFile = new URL('deployment.local.json', directory);
  await writeFile(credentialsFile, JSON.stringify(deployment, null, 2) + '\n', { mode: 0o600 });
  await chmod(credentialsFile, 0o600);
  // JSON is valid YAML; all strings remain data, including endpoint and model identifiers.
  const patch = deployment.modelSource === 'skillhub'
    ? [{ insert: [{ id: 'tpcowork-hub-model', name: '@tpcowork/dsh-core/hub-model' }] }]
    : deploymentPatch(deployment);
  await writeFile(new URL('model.patch.yml', directory), JSON.stringify(patch, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--import-tpcowork')) {
    throw new Error('Usage: node plugins/tpcowork-core/build.mjs [--import-tpcowork /path/to/tp-cowork]');
  }
  await buildCore({ referenceRoot: args[1] });
  console.info('TP Cowork core: model configuration prepared.');
}
