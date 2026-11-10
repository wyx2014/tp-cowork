import { describe, expect, it } from 'vitest'
import { unpackedLibrary } from '../src/helper.ts'

describe('unpackedLibrary', () => {
  const windows = 'C:\\Users\\a\\AppData\\Local\\Programs\\TP Cowork\\resources\\app.asar\\dsh\\node_modules\\@trycua\\cua-driver-win32-x64-msvc\\cua_driver_sdk.dll'
  const unpacked = windows.replace('\\app.asar\\', '\\app.asar.unpacked\\')

  it('opens a packaged native library from the unpacked copy', () => {
    expect(unpackedLibrary(windows, path => path === unpacked)).toBe(unpacked)
    const mac = '/Applications/TP Cowork.app/Contents/Resources/app.asar/dsh/node_modules/@trycua/cua-driver-darwin-arm64/libcua_driver_sdk.dylib'
    expect(unpackedLibrary(mac, () => true)).toBe(mac.replace('/app.asar/', '/app.asar.unpacked/'))
  })

  it('keeps the path when there is no archive or no unpacked copy', () => {
    expect(unpackedLibrary(windows, () => false)).toBe(windows)
    const development = '/work/node_modules/@trycua/cua-driver-darwin-x64/libcua_driver_sdk.dylib'
    expect(unpackedLibrary(development, () => true)).toBe(development)
  })
})
