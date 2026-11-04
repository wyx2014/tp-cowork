import { describe, expect, it } from 'vitest'
import { allowedHubUrl } from '../src/host/tpcoworkhub/hub-url.ts'
import { defaultHubEndpoint } from '../src/host/tpcoworkhub/index.ts'

it('accepts HTTPS anywhere and plain HTTP only on this machine or a private intranet address', () => {
  const ok = (url: string) => allowedHubUrl(new URL(url))
  for (const url of ['https://hub.example.com', 'http://localhost:8080', 'http://127.0.0.1:1', 'http://10.17.12.229:20255/', 'http://172.16.0.1', 'http://172.31.255.1', 'http://192.168.1.2'])
    expect(ok(url), url).toBe(true)
  for (const url of ['http://hub.example.com', 'http://8.8.8.8', 'http://172.32.0.1', 'http://11.0.0.1', 'http://10.1.2.3.example.com', 'ftp://10.0.0.1', 'https://user:pw@hub.example.com', 'http://user@10.0.0.1'])
    expect(ok(url), url).toBe(false)
})

describe('default Hub endpoint', () => {
  it('uses the local Hub in the desktop development app and the release Hub otherwise, unless overridden', () => {
    expect(defaultHubEndpoint({})).toBe('http://10.17.12.229:20255')
    expect(defaultHubEndpoint({ DSH_DESKTOP_DEV_APP: '1' })).toBe('http://localhost:8080')
    expect(defaultHubEndpoint({ DSH_DESKTOP_DEV_APP: '1', DSH_TPCOWORKHUB_URL: 'http://192.168.1.2:9000' })).toBe('http://192.168.1.2:9000')
    expect(defaultHubEndpoint({ DSH_TPCOWORKHUB_URL: 'https://hub.example.com' })).toBe('https://hub.example.com')
  })
})
