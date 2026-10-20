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
  return config;
}
