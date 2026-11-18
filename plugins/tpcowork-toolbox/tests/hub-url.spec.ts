import { expect, it } from 'vitest'
import { allowedHubUrl } from '../src/host/tpcoworkhub/hub-url.ts'

it('accepts HTTPS, local HTTP and the exact configured HTTP test origin', () => {
  const ok = (url: string) => allowedHubUrl(new URL(url))
  for (const url of ['https://hub.example.com', 'http://127.0.0.1:1', 'http://localhost:8080', 'http://10.17.12.229:20255/', 'http://172.16.0.1', 'http://172.31.255.1', 'http://192.168.1.2', 'http://isptest.tpasset.com:54905', 'http://isptest.tpasset.com:54905/tp-cowork/desktop/authorize'])
    expect(ok(url), url).toBe(true)
  for (const url of ['http://hub.example.com', 'http://8.8.8.8', 'http://172.32.0.1', 'http://11.0.0.1', 'http://10.1.2.3.example.com', 'ftp://10.0.0.1', 'https://user:pw@hub.example.com', 'http://user@10.0.0.1', 'http://isptest.tpasset.com', 'http://isptest.tpasset.com:54906', 'http://sub.isptest.tpasset.com:54905', 'http://isptest.tpasset.com.evil.example:54905', 'http://user@isptest.tpasset.com:54905'])
    expect(ok(url), url).toBe(false)
})
