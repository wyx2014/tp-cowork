/** Install the local release with an empty npm cache and exercise only the installed package. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readlink, writeFile, lstat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const releases = resolve(root, 'artifacts/toolbox-release')
const report = JSON.parse(await readFile(resolve(releases, 'manifest.json'), 'utf8'))
if (!report.optionalModules.expertsPackaged) throw new Error('Build the integrated release with package-toolbox.mjs --with-experts first.')
await mkdir(resolve(root, 'artifacts/toolbox-offline'), { recursive: true })
const directory = await mkdtemp(resolve(root, 'artifacts/toolbox-offline/install-'))
await writeFile(resolve(directory, 'package.json'), '{"name":"toolbox-offline-test","private":true}\n')
async function run(command, args, cwd = root, env = process.env) {
  await new Promise((ok, fail) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' })
    child.once('error', fail); child.once('exit', code => code === 0 ? ok() : fail(new Error(`${command} exited ${code}`)))
  })
}
const archive = resolve(releases, report.archive)
assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'), report.sha256)
const expertsReport = report.optionalModules.expertsPackaged ? JSON.parse(await readFile(resolve(releases, 'experts-manifest.json'), 'utf8')) : null
const expertsArchive = expertsReport ? resolve(releases, `${expertsReport.package.replace(/^@/, '').replace('/', '-')}-${expertsReport.version}.tgz`) : null
await run('npm', ['install', '--offline', '--ignore-scripts', '--legacy-peer-deps', '--cache', resolve(directory, 'empty-cache'), '--no-audit', '--no-fund', archive, ...(expertsArchive ? [expertsArchive] : [])], directory)
const installed = resolve(directory, 'node_modules/@tpcowork/dsh-toolbox')
for (const file of report.files) {
  const path = resolve(installed, file.path)
  if (file.link) { assert.ok((await lstat(path)).isSymbolicLink()); assert.equal(await readlink(path), file.link) }
  else assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), file.sha256, file.path)
}
const env = { ...process.env, TOOLBOX_PACKAGE_ROOT: installed,
  ...(expertsReport ? { EXPERTS_PACKAGE_ROOT: resolve(directory, 'node_modules/@tpcowork/dsh-experts') } : {}) }
if (expertsReport) {
  const experts = resolve(directory, 'node_modules/@tpcowork/dsh-experts')
  for (const file of expertsReport.files) {
    const path = resolve(experts, file.path)
    if (file.link) { assert.ok((await lstat(path)).isSymbolicLink()); assert.equal(await readlink(path), file.link) }
    else assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), file.sha256, file.path)
  }
  await run(process.execPath, ['plugins/tpcowork-experts/tests/artifact-smoke.mjs'], root, { ...env, EXPERTS_PACKAGE_ROOT: experts })
}
await run(process.execPath, ['plugins/tpcowork-toolbox/tests/bootstrap-artifact-smoke.mjs'], root, env)
await run(process.execPath, ['plugins/tpcowork-toolbox/tests/playwright-artifact-smoke.mjs'], root, env)
await run(resolve(installed, 'runtime/python/python'), ['-I', '-c', 'import pptx,docx,PIL,yaml;print("Offline installed Python modules passed")'])
const python = resolve(installed, 'runtime/python/python')
const skills = resolve(installed, 'resources/skills')
const pptx = resolve(directory, 'sample.pptx')
await run(python, ['-I', '-c', 'from pptx import Presentation;import sys;p=Presentation();p.slides.add_slide(p.slide_layouts[0]).shapes.title.text="离线资源验证";p.save(sys.argv[1]);assert len(Presentation(sys.argv[1]).slides)==1;print("Offline PowerPoint module sample passed")', pptx])
const docx = resolve(directory, 'sample.docx')
await run(python, ['-I', '-c', 'from docx import Document;import sys;d=Document();d.add_heading("离线资源验证",0);d.add_paragraph("使用包内 python-docx 库。");d.save(sys.argv[1]);assert len(Document(sys.argv[1]).paragraphs)==2;print("Offline DOCX module sample passed")', docx])
await run(python, [resolve(skills, 'skill-creator/scripts/quick_validate.py'), resolve(skills, 'skill-creator')])
await run(python, ['-c', 'from zipfile import ZipFile;import sys;assert all(ZipFile(p).testzip() is None for p in sys.argv[1:]);print("Offline PPTX/DOCX resource samples passed")', pptx, docx])
console.log(JSON.stringify({ offline: true, emptyCache: true, verifiedFiles: report.files.length, profileAndBrowser: 'passed' }))
