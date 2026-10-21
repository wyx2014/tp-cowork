import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { prepareDesktopBranding } from '../desktop-branding.mjs'
import { harnessRoot, productRoot } from '../package-command.mjs'

test('brands the welcome flow, native menus, developer application and browser build in both languages', async t => {
  const harness = await mkdtemp(join(tmpdir(), 'tp-branding-'))
  t.after(() => rm(harness, { recursive: true, force: true }))
  const files = [
    'apps/desktop/src/locale.ts', 'apps/desktop/src/main.ts', 'apps/desktop/package.json',
    'apps/desktop/scripts/development-app.ts', 'apps/desktop/scripts/electron-builder-config.mjs',
    'scripts/client-build-environment.ts', 'apps/web/index.html', 'apps/web/vite.config.ts',
    'apps/web/public/manifest.webmanifest',
    'packages/client/locale/src/locales/en.ts', 'packages/client/locale/src/locales/zh.ts',
  ]
  for (const file of files) {
    await mkdir(join(harness, file, '..'), { recursive: true })
    await cp(join(harnessRoot, file), join(harness, file))
  }
  const originalLocale = await readFile(join(harnessRoot, 'apps/desktop/src/locale.ts'), 'utf8')
  await prepareDesktopBranding({ harness })
  const { en, zh } = await import(pathToFileURL(join(harness, 'apps/desktop/src/locale.ts')))
  for (const messages of [en, zh]) {
    for (const key of ['aboutMenu', 'aboutProduct', 'hideApplication', 'quitApplication', 'openApplication', 'quitTitle', 'startupFailed', 'welcomeTitle', 'welcomeBrand', 'welcomeTaglineBrand', 'updateTitle']) {
      assert.ok(messages[key].includes('TP Cowork'), `${key} must carry the product name`)
    }
    assert.doesNotMatch(JSON.stringify(messages), /DeepSeek Harness|using Harness/u)
  }
  assert.equal(en.welcomeKeyDescription, 'Configure DeepSeek models to start using TP Cowork')
  const developerApp = await import(pathToFileURL(join(harness, 'apps/desktop/scripts/development-app.ts')))
  const launcher = developerApp.developmentLauncher({ home: 'home', primaryRuntimeDir: 'runtime', hostPort: 9230,
    openDevtools: '0', mainPort: 9229, rendererPort: 9222, userData: 'user data', appRoot: 'app root' }, '/TP Cowork.app')
  assert.match(launcher, /TP Cowork\.app/u)
  const developerSource = await readFile(join(harness, 'apps/desktop/scripts/development-app.ts'), 'utf8')
  assert.match(developerSource, /CFBundleIconFile: 'tpcowork\.icns'/u)
  assert.match(developerSource, /com\.tparuyi\.tpcowork\.dsh\.dev\./u)
  assert.match(developerSource, /copyFileSync\(join\(options\.appRoot, 'resources', 'icon\.icns'\)/u)
  const main = await readFile(join(harness, 'apps/desktop/src/main.ts'), 'utf8')
  assert.match(main, /label: darwin \? currentDesktopLocale\(\)\.messages\.aboutProduct/u)
  assert.match(main, /@deepseek-ai\/dsh-deepseek-account|@deepseek-ai\/dsh-client-product-analytics/u)
  const official = await readFile(join(harness, 'scripts/client-build-environment.ts'), 'utf8')
  assert.match(official, /DSH_CLIENT_TITLE: 'TP Cowork'/u)
  const manifest = JSON.parse(await readFile(join(harness, 'apps/web/public/manifest.webmanifest'), 'utf8'))
  assert.equal(manifest.name, 'TP Cowork')
  assert.equal(manifest.short_name, 'TP Cowork')
  assert.equal(JSON.parse(await readFile(join(harness, 'apps/desktop/package.json'), 'utf8')).productName, 'TP Cowork')
  assert.equal(await readFile(join(harnessRoot, 'apps/desktop/src/locale.ts'), 'utf8'), originalLocale)

  const icon = await readFile(join(productRoot, 'plugins/tpcowork-ui/icon.png'))
  assert.deepEqual(await readFile(join(harness, 'apps/desktop/resources/icon-windows.png')), icon)
  const wordmark = await readFile(join(harness, 'apps/desktop/renderer/assets/welcome-brand.svg'), 'utf8')
  assert.ok(wordmark.includes(icon.toString('base64')))
  assert.match(wordmark, />TP Cowork<\/text>/u)
  const ico = await readFile(join(harness, 'apps/desktop/resources/tray-windows.ico'))
  assert.equal(ico.readUInt16LE(2), 1)
  assert.equal(ico.readUInt16LE(4), 7)
  for (let index = 0; index < 7; index++) {
    const offset = ico.readUInt32LE(6 + index * 16 + 12)
    assert.deepEqual(ico.subarray(offset, offset + 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  }
  const icns = await readFile(join(harness, 'apps/desktop/resources/icon.icns'))
  assert.equal(icns.toString('ascii', 0, 4), 'icns')
  assert.equal(icns.readUInt32BE(4), icns.length)
  for (const size of ['ic07', 'ic08', 'ic09', 'ic10']) assert.ok(icns.includes(Buffer.from(size)))

  const first = await Promise.all(files.map(file => readFile(join(harness, file))))
  await prepareDesktopBranding({ harness })
  const again = await Promise.all(files.map(file => readFile(join(harness, file))))
  assert.deepEqual(again, first, 'repeated product preparation must preserve the generated source')
})
