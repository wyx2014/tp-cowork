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

/** The application's Zai Light and Zai Dark surfaces, shared by every installer surface. */
export const installerPalette = {
  light: { background: '#f8f8f8', text: '#0d0d0d', subtle: 'rgba(13,13,13,0.6)', border: 'rgba(13,13,13,0.1)' },
  dark: { background: '#161616', text: '#f8f8f8', subtle: 'rgba(255,255,255,0.6)', border: 'rgba(255,255,255,0.1)' },
}
const installerFont = "'Segoe UI Semibold','Segoe UI','Microsoft YaHei UI','PingFang SC',Arial,sans-serif"

function escapeXml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
}

/**
 * Artwork for the native NSIS pages; these bitmaps are independent of Electron's icons.
 * The window art sits on the installer's own surface; the uninstaller sidebar is a panel beside the white wizard page.
 */
function installerSvg(icon, name, dark, sidebar = false) {
  const label = escapeXml(name)
  const colors = installerPalette[dark ? 'dark' : 'light']
  const image = `data:image/png;base64,${icon.toString('base64')}`
  if (sidebar) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314"><rect width="164" height="314" fill="${colors.background}"/><rect x="163" width="1" height="314" fill="${colors.border}"/><image href="${image}" x="42" y="76" width="80" height="80"/><text x="82" y="190" text-anchor="middle" font-family="${installerFont}" font-size="20" font-weight="600" fill="${colors.text}">${label}</text></svg>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="196" viewBox="0 0 600 196"><rect width="600" height="196" fill="${colors.background}"/><image href="${image}" x="244" y="12" width="112" height="112"/><text x="300" y="176" text-anchor="middle" font-family="${installerFont}" font-size="30" font-weight="600" fill="${colors.text}">${label}</text></svg>`
}

/** macOS disk-image window art: 540x380 points; the builder places the app and Applications icons over the arrow ends. */
export const dmgLayout = { width: 540, height: 380, iconSize: 96, app: { x: 140, y: 214 }, applications: { x: 400, y: 214 } }
function dmgSvg(icon, name) {
  const label = escapeXml(name)
  const { light } = installerPalette
  const { width, height, app, applications } = dmgLayout
  // Disk images are built on macOS, so the art uses its system faces.
  const font = "'PingFang SC','Helvetica Neue',Arial,sans-serif"
  const from = app.x + 70, to = applications.x - 70, y = app.y
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${light.background}"/><image href="data:image/png;base64,${icon.toString('base64')}" x="${width / 2 - 88}" y="40" width="32" height="32"/><text x="${width / 2 - 48}" y="65" font-family="${font}" font-size="24" font-weight="600" fill="${light.text}">${label}</text><text x="${width / 2}" y="106" text-anchor="middle" font-family="${font}" font-size="13" fill="${light.subtle}">将 ${label} 拖到“应用程序”文件夹以完成安装</text><text x="${width / 2}" y="126" text-anchor="middle" font-family="${font}" font-size="12" fill="${light.subtle}">Drag ${label} to Applications to install</text><path d="M${from} ${y}H${to}M${to - 10} ${y - 10}L${to} ${y}L${to - 10} ${y + 10}" fill="none" stroke="${light.text}" stroke-opacity="0.3" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}

/** NSIS colors as RRGGBB, GDI+ ARGB and GDI COLORREF (0xBBGGRR). */
function nsisColor(hex) {
  const value = hex.replace('#', '').toUpperCase()
  return { hex: value, argb: `0xFF${value}`, colorref: `0x${value.slice(4, 6)}${value.slice(2, 4)}${value.slice(0, 2)}` }
}

/** The installer window palette (installer/theme.nsh defaults are the framework's). */
export function installerTheme() {
  const light = { bg: nsisColor('#f8f8f8'), text: nsisColor('#0d0d0d') }
  const dark = { bg: nsisColor('#161616'), text: nsisColor('#f8f8f8') }
  const lines = [
    '; Generated by TP Cowork scripts/desktop-branding.mjs: the Zai Light and Zai Dark application surfaces.',
    '!define INSTALLER_BUTTON_DIAMETER 16',
    `!define INSTALLER_LIGHT_BG_HEX ${light.bg.hex}`, `!define INSTALLER_LIGHT_TEXT_HEX ${light.text.hex}`,
    `!define INSTALLER_LIGHT_BG_ARGB ${light.bg.argb}`, `!define INSTALLER_LIGHT_BG_COLORREF ${light.bg.colorref}`,
    `!define INSTALLER_TEXT_COLORREF ${light.text.colorref}`,
    '!define INSTALLER_PRIMARY 0xFF000000', '!define INSTALLER_PRIMARY_HOVER 0xFF333333', '!define INSTALLER_PRIMARY_PRESSED 0xFF000000',
    '!define INSTALLER_CONTROL_HOVER 0xFFECECEC', '!define INSTALLER_TRACK_COLOR 0xFFE0E0E0',
    '!define INSTALLER_LIGHT_BUTTON_TEXT 0xFFFFFF', '!define INSTALLER_LIGHT_BORDER 0xFFD5D5D5',
    `!define INSTALLER_DARK_BG_HEX ${dark.bg.hex}`, `!define INSTALLER_DARK_TEXT_HEX ${dark.text.hex}`,
    `!define INSTALLER_DARK_BG_ARGB ${dark.bg.argb}`, `!define INSTALLER_DARK_BG_COLORREF ${dark.bg.colorref}`,
    `!define INSTALLER_DARK_TEXT_COLORREF ${dark.text.colorref}`,
    '!define INSTALLER_DARK_PRIMARY 0xFFFFFFFF', '!define INSTALLER_DARK_PRIMARY_HOVER 0xFFE5E5E5', '!define INSTALLER_DARK_PRIMARY_PRESSED 0xFFCCCCCC',
    '!define INSTALLER_DARK_CONTROL_HOVER 0xFF222222', '!define INSTALLER_DARK_TRACK_COLOR 0xFF2D2D2D',
    '!define INSTALLER_DARK_BUTTON_TEXT 0x000000', '!define INSTALLER_DARK_BORDER 0xFF393939',
  ]
  return `${lines.join('\r\n')}\r\n`
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
  // The source is high resolution for the Dock and Linux; embedded and window icons use smaller renditions.
  const icon512 = await sharp(icon).resize(512, 512).png().toBuffer()
  const icon256 = await sharp(icon).resize(256, 256).png().toBuffer()
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
    ['apps/desktop/resources/icon.png', icon512],
    ['apps/desktop/resources/icon-windows.png', icon512],
    ['apps/desktop/resources/icon-macos.png', await sharp(icon).resize(1024, 1024).png().toBuffer()],
    ['apps/desktop/resources/icon.icns', await macIcon(icon, sharp)],
    ['apps/desktop/resources/tray-windows.ico', await windowsIcon(icon, sharp)],
    ['apps/desktop/renderer/assets/welcome-brand.svg', productSvg(icon256, name, true)],
    ['apps/web/public/favicon.svg', productSvg(icon256, name)],
    ['apps/web/public/favicon-dark.svg', productSvg(icon256, name)],
    // The startup cover shows the logo at 96 CSS pixels; twice that stays sharp on high-density displays.
    ['apps/web/public/startup-logo.png', await sharp(icon).resize(192, 192).png().toBuffer()],
    ['apps/desktop/installer/product-theme.nsh', installerTheme()],
  ]
  for (const dark of [false, true]) {
    for (const scale of [1, 2]) {
      const filename = `brand${dark ? '-dark' : ''}${scale === 2 ? '-2x' : ''}.png`
      const svg = installerSvg(icon512, name, dark)
      images.push([`apps/desktop/installer/assets/${filename}`, await sharp(Buffer.from(svg), { density: 72 * scale }).png().toBuffer()])
    }
  }
  images.push(['apps/desktop/installer/assets/uninstaller-sidebar.png', await sharp(Buffer.from(installerSvg(icon512, name, false, true))).png().toBuffer()])
  // electron-builder pairs name@2x.png with name.png into one Retina disk-image background.
  for (const scale of [1, 2]) {
    images.push([`apps/desktop/resources/dmg-background${scale === 2 ? '@2x' : ''}.png`,
      await sharp(Buffer.from(dmgSvg(icon512, name)), { density: 72 * scale }).png().toBuffer()])
  }
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
  await writeFile(join(destination, 'renderer/assets/welcome-brand.svg'), productSvg(await sharp(icon).resize(256, 256).png().toBuffer(), config.productName, true))
  const icon512 = await sharp(icon).resize(512, 512).png().toBuffer()
  for (const file of ['icon.png', 'icon-windows.png']) await writeFile(join(destination, 'resources', file), icon512)
  await writeFile(join(destination, 'resources/icon-macos.png'), await sharp(icon).resize(1024, 1024).png().toBuffer())
  await writeFile(join(destination, 'resources/tray-windows.ico'), await windowsIcon(icon, sharp))
  await writeFile(join(destination, 'resources/icon.icns'), await macIcon(icon, sharp))
  return destination
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.includes('--stage')) console.log(await stageBrandedDesktop())
  else console.log(JSON.stringify(await prepareDesktopBranding()))
}
