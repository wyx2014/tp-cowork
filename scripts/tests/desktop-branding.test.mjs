import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { createRequire } from 'node:module'
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

  const sharp = createRequire(join(harnessRoot, 'apps/desktop/package.json'))('sharp')
  const product = JSON.parse(await readFile(join(productRoot, 'desktop-product.json'), 'utf8'))
  const source = await sharp(await readFile(join(productRoot, product.icon))).metadata()
  assert.equal(source.width, 1024, 'the product icon source is high resolution')
  const edgeAlpha = async file => (await sharp(await readFile(file)).ensureAlpha().extract({ left: 40, top: 512, width: 1, height: 1 }).raw().toBuffer())[3]
  assert.equal(await edgeAlpha(join(harness, 'apps/desktop/resources/icon-macos.png')), 0, 'the macOS icon keeps the Dock margin')
  assert.equal(await edgeAlpha(join(productRoot, product.icon)), 255, 'other platforms use the full-bleed icon')
  for (const [file, size] of [['icon-windows.png', 512], ['icon.png', 512], ['icon-macos.png', 1024]]) {
    assert.equal((await sharp(await readFile(join(harness, 'apps/desktop/resources', file))).metadata()).width, size)
  }
  const startupLogo = await sharp(await readFile(join(harness, 'apps/web/public/startup-logo.png'))).metadata()
  assert.deepEqual([startupLogo.width, startupLogo.height], [192, 192], 'the startup cover logo is twice its 96px size')
  const wordmark = await readFile(join(harness, 'apps/desktop/renderer/assets/welcome-brand.svg'), 'utf8')
  const embedded = Buffer.from(/base64,([^"]+)"/u.exec(wordmark)[1], 'base64')
  assert.equal((await sharp(embedded).metadata()).width, 256, 'the wordmark embeds a small rendition')
  assert.match(wordmark, />TP Cowork<\/text>/u)
  const ico = await readFile(join(harness, 'apps/desktop/resources/tray-windows.ico'))
  assert.equal(ico.readUInt16LE(2), 1)
  assert.equal(ico.readUInt16LE(4), 7)
  for (let index = 0; index < 7; index++) {
    const offset = ico.readUInt32LE(6 + index * 16 + 12)
    assert.deepEqual(ico.subarray(offset, offset + 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  }
  assert.deepEqual(await readFile(join(harness, 'apps/desktop/resources/icon-windows.ico')), ico)

  // Load the branded builder configuration with its real helpers, without changing the checkout.
  for (const file of await readdir(join(harnessRoot, 'apps/desktop/scripts'))) {
    if (file.endsWith('.mjs') && file !== 'electron-builder-config.mjs') {
      await symlink(join(harnessRoot, 'apps/desktop/scripts', file), join(harness, 'apps/desktop/scripts', file), 'file')
    }
  }
  await symlink(join(harnessRoot, 'scripts/libreoffice-packages.mjs'), join(harness, 'scripts/libreoffice-packages.mjs'), 'file')
  const { createElectronBuilderConfig } = await import(pathToFileURL(join(harness, 'apps/desktop/scripts/electron-builder-config.mjs')))
  const config = createElectronBuilderConfig({ DSH_DESKTOP_APP_ID: product.appId, DSH_DESKTOP_UNSIGNED: '1',
    DSH_DESKTOP_STANDALONE: '1', DSH_DESKTOP_PRODUCT_CONFIG: join(productRoot, 'desktop-product.json'),
    DSH_DESKTOP_PRODUCT_ICON: join(productRoot, product.icon) }, 'win32', 'x64')
  const { convertIcon } = createRequire(join(harnessRoot, 'apps/desktop/package.json'))('app-builder-lib/out/util/iconConverter.js')
  const emptyToolset = join(harness, 'empty-icon-toolset')
  await mkdir(emptyToolset)
  const previousToolset = process.env.ELECTRON_BUILDER_ICONS_TOOLSET_DIR
  try {
    // Any attempt to use the downloaded converter fails; the generated ICO must work without it.
    process.env.ELECTRON_BUILDER_ICONS_TOOLSET_DIR = emptyToolset
    const options = { roots: [harness], fallbackSources: [], format: 'ico', outDir: join(harness, 'converted-icons') }
    const result = await convertIcon({ ...options, sources: [config.win.icon] })
    assert.deepEqual(result.icons, [{ file: await realpath(join(harness, 'apps/desktop/resources/icon-windows.ico')), size: 256 }])
    const oldInput = join(harness, 'old-input.png')
    await cp(join(productRoot, product.icon), oldInput)
    await assert.rejects(convertIcon({ ...options, sources: [oldInput] }), /Icons tool not found/u)
  } finally {
    if (previousToolset === undefined) delete process.env.ELECTRON_BUILDER_ICONS_TOOLSET_DIR
    else process.env.ELECTRON_BUILDER_ICONS_TOOLSET_DIR = previousToolset
  }
  const icns = await readFile(join(harness, 'apps/desktop/resources/icon.icns'))
  assert.equal(icns.toString('ascii', 0, 4), 'icns')
  assert.equal(icns.readUInt32BE(4), icns.length)
  for (const size of ['ic07', 'ic08', 'ic09', 'ic10']) assert.ok(icns.includes(Buffer.from(size)))

  for (const [asset, width, height] of [['dmg-background', 540, 380], ['dmg-background@2x', 1080, 760]]) {
    const path = `apps/desktop/resources/${asset}.png`
    const metadata = await sharp(await readFile(join(harness, path))).metadata()
    assert.deepEqual([metadata.width, metadata.height], [width, height])
    files.push(path)
  }
  files.push('apps/desktop/resources/icon-windows.ico')

  const first = await Promise.all(files.map(file => readFile(join(harness, file))))
  await prepareDesktopBranding({ harness })
  const again = await Promise.all(files.map(file => readFile(join(harness, file))))
  assert.deepEqual(again, first, 'repeated product preparation must preserve the generated source')

  await prepareDesktopBranding({ harness, configFile: 'desktop-product.linux-basic.json' })
  assert.equal(JSON.parse(await readFile(join(harness, 'apps/desktop/package.json'), 'utf8')).productName, 'TP Cowork Basic')
  assert.match(await readFile(join(harness, 'apps/desktop/src/main.ts'), 'utf8'), /process\.env\.DSH_HOME = join\(app\.getPath\('userData'\), 'harness'\)/u)
  assert.match(await readFile(join(harness, 'apps/web/index.html'), 'utf8'), /<title>TP Cowork Basic<\/title>/u)
  const basicFirst = await Promise.all(files.map(file => readFile(join(harness, file))))
  await prepareDesktopBranding({ harness, configFile: 'desktop-product.linux-basic.json' })
  assert.deepEqual(await Promise.all(files.map(file => readFile(join(harness, file)))), basicFirst)
  await prepareDesktopBranding({ harness, configFile: 'desktop-product.linux.json' })
  assert.equal(JSON.parse(await readFile(join(harness, 'apps/desktop/package.json'), 'utf8')).productName, 'TP Cowork Linux')
  assert.match(await readFile(join(harness, 'apps/desktop/src/main.ts'), 'utf8'), /process\.env\.DSH_HOME = join\(app\.getPath\('userData'\), 'harness'\)/u)
  assert.match(await readFile(join(harness, 'apps/web/index.html'), 'utf8'), /<title>TP Cowork Linux<\/title>/u)
  const linuxFirst = await Promise.all(files.map(file => readFile(join(harness, file))))
  await prepareDesktopBranding({ harness, configFile: 'desktop-product.linux.json' })
  assert.deepEqual(await Promise.all(files.map(file => readFile(join(harness, file)))), linuxFirst)
  await prepareDesktopBranding({ harness })
  assert.deepEqual(await Promise.all(files.map(file => readFile(join(harness, file)))), first, 'full preparation must restore its original identity')
})
