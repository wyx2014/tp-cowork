import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveHubEnvironment } from '../src/host/tpcoworkhub/hub-environment.ts'
import { LOCAL_HUB_ENDPOINT } from '../src/host/tpcoworkhub/index.ts'

const table = JSON.parse(readFileSync(new URL('../hub-environments.json', import.meta.url), 'utf8')) as Record<string, unknown>

describe('hub-environments.json', () => {
  it('maps local runs to the local Hub, test to the shared test Hub, and production to internal/outsource Hubs', () => {
    expect(resolveHubEnvironment(table, undefined)).toEqual({ environment: 'local', endpoint: 'http://localhost:8080' })
    expect(resolveHubEnvironment(table, '', 'test')).toEqual({ environment: 'test', endpoint: 'http://isptest.tpasset.com:54905' })
    expect(resolveHubEnvironment(table, 'production')).toEqual({
      environment: 'production',
      endpoint: 'https://isp.tpasset.com',
      outsourceEndpoint: 'https://api.isp.tpasset.com',
    })
    expect(resolveHubEnvironment(table, 'local').endpoint).toBe(LOCAL_HUB_ENDPOINT)
  })
  it('refuses to build for an environment without an address, or with an unsafe one', () => {
    if (!table.production) expect(() => resolveHubEnvironment(table, 'production')).toThrow(/no Hub address for "production"/u)
    expect(() => resolveHubEnvironment(table, 'staging')).toThrow(/TPCOWORK_HUB_ENV must be/u)
    expect(() => resolveHubEnvironment({ production: 'http://8.8.8.8:80' }, 'production')).toThrow(/must be an HTTPS address/u)
    expect(() => resolveHubEnvironment({ production: { internal: 'https://isp.tpasset.com', outsource: 'http://8.8.8.8:80' } }, 'production')).toThrow(/must be an HTTPS address/u)
    expect(() => resolveHubEnvironment({ production: 'https://hub.example.com/app' }, 'production')).toThrow(/no path/u)
    expect(resolveHubEnvironment({ production: 'https://hub.example.com/' }, 'production').endpoint).toBe('https://hub.example.com')
  })
})
