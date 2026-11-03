import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { beginBrowserNavigation, browserAddress, trackBrowserNavigation } from '../src/navigation.js'

function fixture(row: Record<string, unknown> = {}) {
  const guest = Object.assign(new EventEmitter(), {
    url: 'about:blank#tpcowork-browser-private', title: 'about:blank', loading: false,
    isDestroyed: () => false, getURL: () => guest.url, getTitle: () => guest.title, isLoading: () => guest.loading,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
  })
  const publish = vi.fn()
  trackBrowserNavigation(row, guest, (url: string) => /^https?:\/\//u.test(url), publish)
  return { row, guest, publish }
}

it('shows the target before attachment and keeps bootstrap metadata out of the page address', () => {
  const { row, guest } = fixture({ initialUrl: 'https://example.com/' })
  expect(browserAddress(row)).toBe('https://example.com/')
  expect(row.url).toBeUndefined()
  expect(row.title).toBeUndefined()
  expect(browserAddress({ url: guest.url })).toBe('')
  expect(browserAddress({ url: 'about:blank' })).toBe('')
  expect(browserAddress()).toBe('')
  beginBrowserNavigation(row, 'https://example.com/')
  guest.emit('page-title-updated')
  expect(browserAddress(row)).toBe('https://example.com/')
  expect(row.loading).toBe(true)
})

it('tracks redirects while connecting and replaces the requested address with the committed URL', () => {
  const { row, guest, publish } = fixture({ url: 'https://previous.example/' })
  guest.loading = true
  guest.emit('did-start-navigation', {}, 'https://example.com/', false, true)
  expect(browserAddress(row)).toBe('https://example.com/')
  expect(row.loading).toBe(true)
  guest.emit('did-start-loading')
  guest.emit('did-redirect-navigation', {}, 'https://example.com/home', false, true)
  guest.emit('page-title-updated')
  expect(browserAddress(row)).toBe('https://example.com/home')
  guest.url = 'https://example.com/home'
  guest.title = 'Example'
  guest.emit('did-navigate', {}, guest.url)
  guest.loading = false
  guest.emit('did-stop-loading')
  expect(row).toMatchObject({ url: guest.url, title: 'Example', loading: false })
  expect(row.pendingUrl).toBeUndefined()
  expect(browserAddress(row)).toBe(guest.url)
  expect(publish).toHaveBeenCalled()
})

it('preserves a failed target through stop/title events and clears the error when retrying', () => {
  const { row, guest } = fixture({ url: 'https://previous.example/' })
  const target = 'https://unavailable.example/'
  beginBrowserNavigation(row, target)
  guest.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', target, true)
  guest.emit('did-stop-loading')
  guest.emit('page-title-updated')
  expect(browserAddress(row)).toBe(target)
  expect(row).toMatchObject({ loading: false, error: 'ERR_NAME_NOT_RESOLVED', loadErrorCode: -105 })
  guest.emit('did-start-navigation', {}, target, false, true)
  expect(row.error).toBeUndefined()
  expect(row.loadErrorCode).toBeUndefined()
  expect(row.loading).toBe(true)
  guest.url = target
  guest.emit('did-navigate', {}, target)
  guest.emit('did-stop-loading')
  expect(browserAddress(row)).toBe(target)
  expect(row.loading).toBe(false)
  expect(row.pendingUrl).toBeUndefined()
})

it('ignores subframes and aborted requests, and finishes same-document navigation without a loading event', () => {
  const { row, guest } = fixture({ url: 'https://example.com/' })
  guest.url = String(row.url)
  guest.emit('did-start-navigation', {}, 'https://frame.example/', false, false)
  guest.emit('did-navigate-in-page', {}, 'https://frame.example/#hash', false)
  guest.emit('did-fail-load', {}, -105, 'Frame failed', 'https://frame.example/', false)
  guest.emit('did-fail-load', {}, -3, 'ERR_ABORTED', guest.url, true)
  expect(browserAddress(row)).toBe('https://example.com/')
  expect(row.error).toBeUndefined()
  guest.url += '#section'
  guest.emit('did-start-navigation', {}, guest.url, true, true)
  guest.emit('did-navigate-in-page', {}, guest.url, true)
  expect(browserAddress(row)).toBe('https://example.com/#section')
  expect(row.loading).toBe(false)
})
