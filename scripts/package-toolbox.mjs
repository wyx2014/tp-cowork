/** Produce a local offline archive and a verifiable inventory; never publish or read desktop profiles. */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readdir, readFile, lstat, readlink, realpath, mkdir, writeFile } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
const workspace = fileURLToPath(new URL('../', import.meta.url))
const root = resolve(workspace, 'plugins/tpcowork-toolbox')
const output = resolve(workspace, 'artifacts/toolbox-release')
const require = createRequire(resolve(workspace, '../deepseek-harness/package.json'))
const { unzipSync } = require('fflate')
const tar = require('tar')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const excluded = /anysearch|hexin-ifind-ds-(?:stock|fund|edb|news|bond|global-stock|index)-mcp/i
const sensitive = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s+[a-zA-Z0-9+/=]{32,}|\bsk-[a-zA-Z0-9]{24,}|(?:[?&]token=)[a-zA-Z0-9%_-]{16,}|(?:电话|手机号|手机号码)[：:\s]*1[3-9]\d{9}/
function checkText(bytes, path, defaults = false) {
  const text = Buffer.from(bytes).toString('utf8')
  if (sensitive.test(text)) throw new Error(`toolbox/package-sensitive-content: ${path}`)
  if (defaults && excluded.test(text)) throw new Error(`toolbox/package-excluded-default: ${path}`)
}
const files = []
async function metadata(names, baseRoot = root, inventory = files) {
  for (const name of new Set(names)) {
    const path = resolve(baseRoot, name)
    const inside = relative(baseRoot, await realpath(path))
    if (inside.startsWith('../') || isAbsolute(inside) || !(await lstat(path)).isFile()) throw new Error(`toolbox/package-invalid-metadata: ${name}`)
    const bytes = await readFile(path)
    checkText(bytes, name)
    inventory.push({ path: relative(baseRoot, path), size: bytes.length, sha256: hash(bytes) })
  }
}
async function walk(directory, baseRoot = root, inventory = files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    const name = relative(baseRoot, path)
    if (name === 'runtime/browsers') continue
    if (['__pycache__', '.DS_Store', '.links', '.package-lock.json'].includes(entry.name)) continue
    if (entry.isSymbolicLink()) {
      const outside = relative(baseRoot, await realpath(path))
      if (outside.startsWith('../') || isAbsolute(outside)) throw new Error(`toolbox/package-external-link: ${name}`)
      inventory.push({ path: name, link: await readlink(path) }); continue
    }
    if (entry.isDirectory()) { await walk(path, baseRoot, inventory); continue }
    if (!entry.isFile() || /(^|\/)\.env(?:\.|$)|address.?book|contacts\.(?:json|csv)|deployment\.local|\.pyc$/i.test(name)) throw new Error(`toolbox/package-unexpected-file: ${name}`)
    const bytes = await readFile(path)
    if (name.startsWith('resources/')) {
      checkText(bytes, name, true)
      if (/\.(?:pptx|docx)$/.test(name)) for (const [part, data] of Object.entries(unzipSync(bytes))) if (/\.xml$/.test(part)) checkText(data, name + ':' + part, true)
    } else if (/\.(?:js|mjs|json|yml)$/.test(name) && !name.startsWith('runtime/browsers/')) checkText(bytes, name)
    inventory.push({ path: name, size: bytes.length, sha256: hash(bytes) })
  }
}
await metadata(['package.json', 'README.md', 'cordis.patch.yml'])
for (const directory of ['lib', 'resources', 'runtime', 'node_modules']) await walk(resolve(root, directory))
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
if (pkg.dependencies['@playwright/mcp'] !== '0.0.30') throw new Error('toolbox/package-unpinned-playwright')
const playwright = JSON.parse(await readFile(resolve(root, 'runtime/playwright.json'), 'utf8'))
if (playwright.platform !== process.platform || playwright.arch !== process.arch) throw new Error('toolbox/package-platform-mismatch')
await lstat(resolve(root, 'runtime', playwright.archive))
if (hash(await readFile(resolve(root, 'runtime', playwright.archive))) !== playwright.archiveSha256) throw new Error('toolbox/package-browser-hash')
const migrated = JSON.parse(await readFile(resolve(workspace, 'docs/toolbox/skills-migrated.json'), 'utf8'))
for (const skill of migrated.skills) {
  for (const file of skill.files) {
    const match = files.find(item => item.path === `resources/skills/${skill.name}/${file.path}`)
    if (match?.sha256 !== file.sha256) throw new Error(`toolbox/package-migration-mismatch: ${skill.name}/${file.path}`)
  }
}
await mkdir(output, { recursive: true })
if (process.argv.includes('--with-experts')) {
  const experts = resolve(workspace, 'plugins/tpcowork-experts')
  const manifest = JSON.parse(await readFile(resolve(experts, 'package.json'), 'utf8'))
  if (!manifest.dsh?.bundle?.patch) throw new Error('toolbox/experts-bundle-missing')
  const expertFiles = []
  await metadata(['package.json', manifest.dsh.bundle.patch], experts, expertFiles)
  for (const directory of ['lib', 'resources']) await walk(resolve(experts, directory), experts, expertFiles)
  const entries = ['package.json', 'lib', 'resources', manifest.dsh.bundle.patch]
  if (manifest.bundleDependencies?.length) { await walk(resolve(experts, 'node_modules'), experts, expertFiles); entries.push('node_modules') }
  // Experts remains its own runtime package. The existing DSH plugin installer owns both bundles.
  await tar.create({ cwd: experts, prefix: 'package/', file: resolve(output, `${manifest.name.replace(/^@/, '').replace('/', '-')}-${manifest.version}.tgz`), gzip: true, portable: true, noMtime: true,
    filter: path => !path.split('/').some(part => ['__pycache__', '.DS_Store', '.links', '.package-lock.json'].includes(part)),
  }, entries)
  await writeFile(resolve(output, 'experts-manifest.json'), JSON.stringify({ package: manifest.name, version: manifest.version, files: expertFiles }, null, 2) + '\n')
}
const archive = resolve(output, `${pkg.name.replace(/^@/, '').replace('/', '-')}-${pkg.version}.tgz`)
// The nested browser archive retains framework symlinks across npm's package extraction.
await tar.create({ cwd: root, prefix: 'package/', file: archive, gzip: true, portable: true, noMtime: true,
  filter: path => path !== 'runtime/browsers' && !path.split('/').some(part => ['__pycache__', '.DS_Store', '.links', '.package-lock.json'].includes(part)),
}, ['package.json', 'README.md', 'cordis.patch.yml', 'lib', 'resources', 'runtime', 'node_modules'])
const report = { schemaVersion: 1, package: pkg.name, version: pkg.version, platform: process.platform, arch: process.arch,
  archive: relative(output, archive), sha256: hash(await readFile(archive)), defaultMcpIds: ['juyuan', 'caihui_mcp', 'playwright'],
  optionalModules: { ...(JSON.parse(await readFile(resolve(root, 'lib/optional-modules.json'), 'utf8'))), expertsPackaged: process.argv.includes('--with-experts') }, skills: migrated.skills.length,
  files: files.sort((a, b) => a.path.localeCompare(b.path)) }
await writeFile(resolve(output, 'manifest.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ archive: report.archive, sha256: report.sha256, skills: report.skills, files: files.length }))
