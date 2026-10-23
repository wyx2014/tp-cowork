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

/** Artwork for the native NSIS pages; these bitmaps are independent of Electron's icons. */
function installerSvg(icon, name, dark, sidebar = false) {
  const label = name.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
  const width = sidebar ? 164 : 600, height = sidebar ? 314 : 196
  const size = sidebar ? 96 : 112, y = sidebar ? 68 : 12
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${dark ? '#151517' : '#ffffff'}"/><image href="data:image/png;base64,${icon.toString('base64')}" x="${(width - size) / 2}" y="${y}" width="${size}" height="${size}"/><text x="${width / 2}" y="${sidebar ? 206 : 176}" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="${sidebar ? 22 : 32}" font-weight="600" fill="${dark ? '#f9fafb' : '#0f1115'}">${label}</text></svg>`
}

/** The browser tab favicon historically was a single flat-filled mark on a transparent
 * background (black in light mode, white in dark mode) rather than the app icon's own
 * filled square — derive that same silhouette from the current icon instead of embedding
 * the square wholesale, so the favicon keeps that lighter, theme-matched effect. */
async function faviconMark(icon, sharp, name, hex) {
  const { data, info } = await sharp(icon).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  const bgIndex = (Math.floor(height * 0.03) * width + Math.floor(width / 2)) * channels
  const bg = [data[bgIndex], data[bgIndex + 1], data[bgIndex + 2]]
  const [r, g, b] = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
  const mark = Buffer.alloc(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel++) {
    const source = pixel * channels, target = pixel * 4
    const alpha = channels === 4 ? data[source + 3] : 255
    const distance = Math.hypot(data[source] - bg[0], data[source + 1] - bg[1], data[source + 2] - bg[2])
    mark[target] = r; mark[target + 1] = g; mark[target + 2] = b
    mark[target + 3] = alpha === 0 ? 0 : Math.max(0, Math.min(255, Math.round((distance - 40) * 8)))
  }
  const png = await sharp(mark, { raw: { width, height, channels: 4 } }).png().toBuffer()
  const label = name.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}"><image href="data:image/png;base64,${png.toString('base64')}" width="${width}" height="${height}"/></svg>\n`
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

/** Filter the Windows caption's Application popup using its current localized labels. */
function windowsApplicationMenu(text) {
  return text.replace(/name === (['"])application\1 \? applicationItems\(\)(?!\.filter\()/u, expression =>
    `${expression}.filter(item => ![currentDesktopLocale().messages.checkUpdatesMenu, currentDesktopLocale().messages.cliCommandMenu].includes(item.label ?? ''))`
    + ".filter((item, index, items) => item.type !== 'separator' || (index > 0 && index < items.length - 1 && items[index - 1]?.type !== 'separator'))")
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
    'apps/desktop/installer/strings.nsh', 'apps/desktop/installer/extract-report.h',
    'scripts/client-build-environment.ts', 'apps/web/index.html', 'apps/web/vite.config.ts',
    'packages/client/locale/src/locales/en.ts', 'packages/client/locale/src/locales/zh.ts',
  ]
  for (const file of textFiles) {
    await transform(join(harness, file), text => productText(file.endsWith('development-app.ts') ? developmentBrand(text)
      : file.endsWith('/main.ts') ? windowsApplicationMenu(text) : text, name)
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
  const images = [
    ['apps/desktop/resources/icon.png', icon],
    ['apps/desktop/resources/icon-windows.png', icon],
    ['apps/desktop/resources/icon-macos.png', await sharp(icon).resize(1024, 1024).png().toBuffer()],
    ['apps/desktop/resources/icon.icns', await macIcon(icon, sharp)],
    ['apps/desktop/resources/tray-windows.ico', await windowsIcon(icon, sharp)],
    ['apps/desktop/renderer/assets/welcome-brand.svg', productSvg(icon, name, true)],
    ['apps/web/public/favicon.svg', await faviconMark(icon, sharp, name, '#000000')],
    ['apps/web/public/favicon-dark.svg', await faviconMark(icon, sharp, name, '#ffffff')],
  ]
  for (const dark of [false, true]) {
    for (const scale of [1, 2]) {
      const filename = `brand${dark ? '-dark' : ''}${scale === 2 ? '-2x' : ''}.png`
      const svg = installerSvg(icon, name, dark)
      images.push([`apps/desktop/installer/assets/${filename}`, await sharp(Buffer.from(svg), { density: 72 * scale }).png().toBuffer()])
    }
  }
  images.push(['apps/desktop/installer/assets/uninstaller-sidebar.png', await sharp(Buffer.from(installerSvg(icon, name, false, true))).png().toBuffer()])
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
      await transform(join(destination, 'lib', entry.name), text => productText(windowsApplicationMenu(text), config.productName)
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
