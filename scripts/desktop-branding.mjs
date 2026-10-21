/** Apply the product identity before building the sibling desktop shell. */
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { harnessRoot, productRoot } from './package-command.mjs'

export function productText(text, name) {
  return text.replaceAll('DeepSeek Harness', name)
    .replaceAll('Harness Dev', name)
    .replaceAll('DSH Local Build', name)
    .replaceAll('DSH 本地构建', name)
    .replaceAll('Configure official DeepSeek models to start using Harness', `Configure DeepSeek models to start using ${name}`)
    .replaceAll('Another DSH instance', `Another ${name} instance`)
    .replaceAll('running DSH instance', `running ${name} instance`)
    .replaceAll('运行的 DSH', `运行的 ${name}`)
}

/** Keep one PNG source for native icons, the welcome wordmark, and browser icons. */
export function productSvg(icon, name, wordmark = false) {
  const label = name.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
  const image = `data:image/png;base64,${icon.toString('base64')}`
  return wordmark
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="48" viewBox="0 0 320 48" role="img" aria-label="${label}"><style>text{fill:#0f1115}@media(prefers-color-scheme:dark){text{fill:#f9fafb}}</style><image href="${image}" width="48" height="48"/><text x="62" y="34" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="32" font-weight="600">${label}</text></svg>\n`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" role="img" aria-label="${label}"><image href="${image}" width="256" height="256"/></svg>\n`
}

async function transform(path, change) {
  const previous = await readFile(path, 'utf8')
  const next = change(previous)
  if (next !== previous) await writeFile(path, next)
}

/** Package PNG-compressed images in a standard multi-resolution Windows ICO. */
export async function windowsIcon(icon, sharp) {
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const images = await Promise.all(sizes.map(size => sharp(icon).resize(size, size).png().toBuffer()))
  const table = Buffer.alloc(6 + sizes.length * 16)
  table.writeUInt16LE(1, 2)
  table.writeUInt16LE(sizes.length, 4)
  let offset = table.length
  for (let index = 0; index < sizes.length; index++) {
    const row = 6 + index * 16
    table[row] = table[row + 1] = sizes[index] % 256
    table.writeUInt16LE(1, row + 4)
    table.writeUInt16LE(32, row + 6)
    table.writeUInt32LE(images[index].length, row + 8)
    table.writeUInt32LE(offset, row + 12)
    offset += images[index].length
  }
  return Buffer.concat([table, ...images])
}

export async function macIcon(icon, sharp) {
  const sizes = [128, 256, 512, 1024]
  const chunks = await Promise.all(sizes.map(async (size, index) => {
    const png = await sharp(icon).resize(size, size).png().toBuffer()
    const header = Buffer.alloc(8)
    header.write(['ic07', 'ic08', 'ic09', 'ic10'][index])
    header.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([header, png])
  }))
  const header = Buffer.alloc(8)
  header.write('icns')
  header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4)
  return Buffer.concat([header, ...chunks])
}

function developmentBrand(text) {
  if (text.includes("CFBundleIconFile: 'tpcowork.icns'")) return text
  return text.replace('existsSync, readFileSync, rmSync, writeFileSync', 'copyFileSync, existsSync, readFileSync, rmSync, writeFileSync')
    .replace('JSON.stringify({ ...options, launcher, plist:', "JSON.stringify({ ...options, launcher, icon: createHash('sha256').update(readFileSync(join(options.appRoot, 'resources', 'icon.icns'))).digest('hex'), plist:")
    .replace("execFileSync('/usr/bin/ditto', [source, bundle])", "execFileSync('/usr/bin/ditto', [source, bundle])\n    copyFileSync(join(options.appRoot, 'resources', 'icon.icns'), join(bundle, 'Contents', 'Resources', 'tpcowork.icns'))")
    .replace('const values = {', "const values = {\n      CFBundleIconFile: 'tpcowork.icns',")
}

/** Product builds run this before the framework compiler and runtime inventories. */
export async function prepareDesktopBranding({ harness = harnessRoot, product = productRoot, imageProcessor } = {}) {
  const config = JSON.parse(await readFile(join(product, 'desktop-product.json'), 'utf8'))
  const name = config.productName
  const icon = await readFile(resolve(product, config.icon))
  const desktop = join(harness, 'apps/desktop')
  const sharp = imageProcessor ?? createRequire(join(harnessRoot, 'apps/desktop/package.json'))('sharp')
  const textFiles = [
    'apps/desktop/src/locale.ts', 'apps/desktop/src/main.ts',
    'apps/desktop/scripts/development-app.ts', 'apps/desktop/scripts/electron-builder-config.mjs',
    'scripts/client-build-environment.ts', 'apps/web/index.html', 'apps/web/vite.config.ts',
    'packages/client/locale/src/locales/en.ts', 'packages/client/locale/src/locales/zh.ts',
  ]
  for (const file of textFiles) {
    await transform(join(harness, file), text => productText(file.endsWith('development-app.ts') ? developmentBrand(text) : text, name)
      .replaceAll('com.deepseek.harness.dev.', `${config.appId}.dev.`)
      .replace(/label:(\s*)darwin \? app\.name/g, 'label:$1darwin ? currentDesktopLocale().messages.aboutProduct'))
  }
  const manifestPath = join(desktop, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.productName = name
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  const webManifestPath = join(harness, 'apps/web/public/manifest.webmanifest')
  const webManifest = JSON.parse(await readFile(webManifestPath, 'utf8'))
  webManifest.name = webManifest.short_name = name
  await writeFile(webManifestPath, JSON.stringify(webManifest, null, 2) + '\n')
  const favicon = productSvg(icon, name)
  const images = [
    ['apps/desktop/resources/icon.png', icon],
    ['apps/desktop/resources/icon-windows.png', icon],
    ['apps/desktop/resources/icon-macos.png', await sharp(icon).resize(1024, 1024).png().toBuffer()],
    ['apps/desktop/resources/icon.icns', await macIcon(icon, sharp)],
    ['apps/desktop/resources/tray-windows.ico', await windowsIcon(icon, sharp)],
    ['apps/desktop/renderer/assets/welcome-brand.svg', productSvg(icon, name, true)],
    ['apps/web/public/favicon.svg', favicon], ['apps/web/public/favicon-dark.svg', favicon],
  ]
  for (const [file, content] of images) {
    await mkdir(dirname(join(harness, file)), { recursive: true })
    await writeFile(join(harness, file), content)
  }
  return { productName: name, appId: config.appId, icons: images.length }
}

/** Build a local preview from existing artifacts without modifying the sibling checkout. */
export async function stageBrandedDesktop(destination = join(productRoot, '.desktop-build/branded-desktop')) {
  const desktop = join(harnessRoot, 'apps/desktop')
  for (const directory of ['lib', 'renderer', 'resources']) {
    await cp(join(desktop, directory), join(destination, directory), { recursive: true, filter: path => !path.endsWith('.map') && !path.startsWith(join(desktop, 'lib/types')) })
  }
  const config = JSON.parse(await readFile(join(productRoot, 'desktop-product.json'), 'utf8'))
  const manifest = JSON.parse(await readFile(join(desktop, 'package.json'), 'utf8'))
  manifest.productName = config.productName
  await writeFile(join(destination, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  for (const entry of await readdir(join(destination, 'lib'), { withFileTypes: true })) {
    if (entry.isFile() && /\.(?:c?js)$/u.test(entry.name)) {
      await transform(join(destination, 'lib', entry.name), text => productText(text, config.productName)
        .replace(/label:(\s*)darwin \? app\.name/g, 'label:$1darwin ? currentDesktopLocale().messages.aboutProduct'))
    }
  }
  const icon = await readFile(resolve(productRoot, config.icon))
  const sharp = createRequire(join(desktop, 'package.json'))('sharp')
  await writeFile(join(destination, 'renderer/assets/welcome-brand.svg'), productSvg(icon, config.productName, true))
  for (const file of ['icon.png', 'icon-windows.png']) await writeFile(join(destination, 'resources', file), icon)
  await writeFile(join(destination, 'resources/icon-macos.png'), await sharp(icon).resize(1024, 1024).png().toBuffer())
  await writeFile(join(destination, 'resources/tray-windows.ico'), await windowsIcon(icon, sharp))
  await writeFile(join(destination, 'resources/icon.icns'), await macIcon(icon, sharp))
  return destination
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.includes('--stage')) console.log(await stageBrandedDesktop())
  else console.log(JSON.stringify(await prepareDesktopBranding()))
}
