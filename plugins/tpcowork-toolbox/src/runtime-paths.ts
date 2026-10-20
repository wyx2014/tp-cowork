/** Interpreter paths passed to operating-system subprocesses must be outside Electron ASAR. */
import { fileURLToPath } from 'node:url'

/** Return the packaged interpreter for this platform, including Electron's unpacked resource tree. */
export function bundledPythonPath(platform = process.platform, moduleUrl = import.meta.url): string {
  const path = fileURLToPath(new URL(`../runtime/python/${platform === 'win32' ? 'python.exe' : 'python'}`, moduleUrl))
  return path.replace(/([\\/])app\.asar([\\/])/u, '$1app.asar.unpacked$2')
}
