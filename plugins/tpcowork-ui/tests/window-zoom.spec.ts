import { describe, expect, it } from 'vitest'
import { createWindowZoom, zoomAction } from '../src/window-zoom.js'

const key = (code: string, modifiers: Partial<KeyboardEvent> = {}) => ({ code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false, keyCode: 0, ...modifiers }) as KeyboardEvent

describe('interface zoom', () => {
  it('takes Command +, - and 0 on macOS and Control on other systems', () => {
    expect(zoomAction(key('Equal', { metaKey: true }), true)).toBe('in')
    expect(zoomAction(key('Equal', { metaKey: true, shiftKey: true }), true)).toBe('in')
    expect(zoomAction(key('NumpadAdd', { metaKey: true }), true)).toBe('in')
    expect(zoomAction(key('Minus', { metaKey: true }), true)).toBe('out')
    expect(zoomAction(key('Digit0', { metaKey: true }), true)).toBe('reset')
    expect(zoomAction(key('Minus', { ctrlKey: true }), false)).toBe('out')
    // Wrong primary, extra modifiers and composition leave the key alone.
    expect(zoomAction(key('Equal', { ctrlKey: true }), true)).toBeNull()
    expect(zoomAction(key('Equal', { metaKey: true }), false)).toBeNull()
    expect(zoomAction(key('Minus', { metaKey: true, shiftKey: true }), true)).toBeNull()
    expect(zoomAction(key('Digit0', { metaKey: true, altKey: true }), true)).toBeNull()
    expect(zoomAction(key('Equal', { metaKey: true, isComposing: true }), true)).toBeNull()
  })

  it('applies steps in order through the desktop bridge, publishes the factor, and consumes the keys', async () => {
    let level = 1
    const calls: string[] = []
    const bridge = { request: async (op: string, payload: { action: string }) => {
      calls.push(`${op}:${payload.action}`)
      level = payload.action === 'reset' ? 0 : Math.min(5, level + (payload.action === 'in' ? 1 : payload.action === 'out' ? -1 : 0))
      return { level, min: -3, max: 5 }
    } }
    const root = document.createElement('div')
    const zoom = createWindowZoom(bridge, root)
    await zoom.run('in')
    expect(zoom.source.getSnapshot()).toEqual({ available: true, level: 2, min: -3, max: 5 })
    expect(Number(root.style.getPropertyValue('--tpcowork-zoom'))).toBeCloseTo(1.21)

    const target = new EventTarget()
    const off = zoom.listen(target, true)
    const event = new KeyboardEvent('keydown', { code: 'Minus', metaKey: true, cancelable: true })
    target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    // While the shortcuts page records a key, the zoom keys stand down.
    root.dataset.tpcoworkShortcutRecording = ''
    const recorded = new KeyboardEvent('keydown', { code: 'Digit0', metaKey: true, cancelable: true })
    target.dispatchEvent(recorded)
    expect(recorded.defaultPrevented).toBe(false)
    off()
    await zoom.run('get')
    expect(calls).toEqual(['windowZoom:get', 'windowZoom:in', 'windowZoom:out', 'windowZoom:get'])
    expect(zoom.source.getSnapshot().level).toBe(1)
  })

  it('stays unavailable without the desktop bridge', async () => {
    const zoom = createWindowZoom(undefined, document.createElement('div'))
    expect((await zoom.run('in')).available).toBe(false)
    expect(zoom.listen(new EventTarget(), true)).toBeTypeOf('function')
  })
})
