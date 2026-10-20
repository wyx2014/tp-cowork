import { describe, expect, it } from 'vitest'
import { bundledPythonPath } from '../src/runtime-paths.ts'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

describe('toolbox interpreter paths', () => {
  it('selects an actual Windows executable outside ASAR for subprocesses', () => {
    const root = join(tmpdir(), 'installed/resources')
    expect(bundledPythonPath('win32', pathToFileURL(join(root, 'app.asar/dsh/node_modules/toolbox/lib/composition.js')).href))
      .toBe(join(root, 'app.asar.unpacked/dsh/node_modules/toolbox/runtime/python/python.exe'))
  })
  it('retains the macOS development launcher', () => {
    const root = join(tmpdir(), 'source/toolbox')
    expect(bundledPythonPath('darwin', pathToFileURL(join(root, 'lib/composition.js')).href))
      .toBe(join(root, 'runtime/python/python'))
  })
})
