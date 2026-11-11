import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveHubEnvironment } from '../src/host/tpcoworkhub/hub-environment.ts'
import { LOCAL_HUB_ENDPOINT } from '../src/host/tpcoworkhub/index.ts'

const table = JSON.parse(readFileSync(new URL('../hub-environments.json', import.meta.url), 'utf8')) as Record<string, string | null>

describe('hub-environments.json', () => {
  it('maps local runs to the local Hub and installers to the test Hub by default', () => {
    expect(resolveHubEnvironment(table, undefined)).toEqual({ environment: 'local', endpoint: 'http://localhost:8080' })
    expect(resolveHubEnvironment(table, '', 'test')).toEqual({ environment: 'test', endpoint: 'http://10.17.12.229:20255' })
    expect(resolveHubEnvironment(table, 'local').endpoint).toBe(LOCAL_HUB_ENDPOINT)
  })
  it('refuses to build for an environment without an address, or with an unsafe one', () => {
    if (!table.production) expect(() => resolveHubEnvironment(table, 'production')).toThrow(/no Hub address for "production"/u)
    expect(() => resolveHubEnvironment(table, 'staging')).toThrow(/TPCOWORK_HUB_ENV must be/u)
    expect(() => resolveHubEnvironment({ production: 'http://8.8.8.8:80' }, 'production')).toThrow(/must be an HTTPS address/u)
    expect(() => resolveHubEnvironment({ production: 'https://hub.example.com/app' }, 'production')).toThrow(/no path/u)
    expect(resolveHubEnvironment({ production: 'https://hub.example.com/' }, 'production').endpoint).toBe('https://hub.example.com')
  })
})
