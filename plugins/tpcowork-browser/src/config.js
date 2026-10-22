import { isAbsolute } from 'node:path';
import { BrowserError } from './protocol.js';

/** Resolve and validate Host configuration again at the native IPC entry. */
export function resolveConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BrowserError('invalid_config', 'Expected browser plugin configuration');
  const limits = { timeoutMs: [40000, 1000, 180000], attachTimeoutMs: [15000, 1000, 60000], tabLimit: [64, 1, 128], permissionTimeoutMs: [60000, 1000, 180000] };
  const config = {};
  for (const [name, [fallback, min, max]] of Object.entries(limits)) {
    const value = input[name] ?? fallback;
    if (!Number.isInteger(value) || value < min || value > max) throw new BrowserError('invalid_config', `Browser ${name} must be an integer between ${min} and ${max}`);
    config[name] = value;
  }
  const ambient = input.ambientContext ?? true;
  if (typeof ambient !== 'boolean') throw new BrowserError('invalid_config', 'Browser ambientContext must be a boolean');
  config.ambientContext = ambient;
  // headless is opt-in, as in the reference CLI; auto uses it only without the desktop bridge.
  const backend = input.backend ?? 'desktop';
  if (!['desktop', 'headless', 'auto'].includes(backend)) throw new BrowserError('invalid_config', 'Browser backend must be desktop, headless or auto');
  config.backend = backend;
  if (input.executablePath !== undefined) {
    if (typeof input.executablePath !== 'string' || !isAbsolute(input.executablePath)) throw new BrowserError('invalid_config', 'Browser executablePath must be an absolute path');
    config.executablePath = input.executablePath;
  }
  return config;
}
