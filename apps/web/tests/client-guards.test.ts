import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test'
import {
  isBlockedShortcut,
  preventDefaultHandler,
  createDevToolsDetector,
  type WindowLike,
} from '@/components/security/client-guards'

function key(init: KeyboardEventInit): KeyboardEvent {
  return {
    key: init.key,
    ctrlKey: !!init.ctrlKey,
    shiftKey: !!init.shiftKey,
    metaKey: !!init.metaKey,
    altKey: !!init.altKey,
  } as unknown as KeyboardEvent
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isBlockedShortcut', () => {
  it('blocks F12', () => {
    expect(isBlockedShortcut(key({ key: 'F12' }))).toBe(true)
  })

  it('blocks Ctrl+Shift developer shortcuts (I, J, C, K, U, S)', () => {
    for (const k of ['i', 'I', 'j', 'c', 'C', 'k', 'u', 'U', 's', 'S']) {
      expect(isBlockedShortcut(key({ key: k, shiftKey: true, ctrlKey: true }))).toBe(true)
    }
  })

  it('blocks Ctrl+U, Ctrl+S, Ctrl+P', () => {
    expect(isBlockedShortcut(key({ key: 'u', ctrlKey: true }))).toBe(true)
    expect(isBlockedShortcut(key({ key: 's', ctrlKey: true }))).toBe(true)
    expect(isBlockedShortcut(key({ key: 'p', ctrlKey: true }))).toBe(true)
  })

  it('blocks Ctrl+Shift+S', () => {
    expect(isBlockedShortcut(key({ key: 's', shiftKey: true, ctrlKey: true }))).toBe(true)
  })

  it('blocks Cmd (meta) equivalents', () => {
    expect(isBlockedShortcut(key({ key: 'i', shiftKey: true, metaKey: true }))).toBe(true)
    expect(isBlockedShortcut(key({ key: 'u', metaKey: true }))).toBe(true)
  })

  it('does not block unmodified or single-modifier keys', () => {
    expect(isBlockedShortcut(key({ key: 'u' }))).toBe(false)
    expect(isBlockedShortcut(key({ key: 'c', ctrlKey: true }))).toBe(false)
    expect(isBlockedShortcut(key({ key: 'u', ctrlKey: true, altKey: true }))).toBe(false)
    expect(isBlockedShortcut(key({ key: 'F11' }))).toBe(false)
    expect(isBlockedShortcut(key({ key: 'Escape' }))).toBe(false)
  })
})

describe('preventDefaultHandler', () => {
  it('calls preventDefault on the event', () => {
    const preventDefault = vi.fn()
    preventDefaultHandler({ preventDefault } as unknown as Event)
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })
})

describe('createDevToolsDetector', () => {
  const openWindow = {
    outerWidth: 2000,
    innerWidth: 800,
    outerHeight: 1500,
    innerHeight: 800,
  } as unknown as WindowLike

  const closedWindow = {
    outerWidth: 800,
    innerWidth: 800,
    outerHeight: 800,
    innerHeight: 800,
  } as unknown as WindowLike

  it('reports open when the chrome/window diff exceeds thresholds', () => {
    const detector = createDevToolsDetector({ windowLike: openWindow })
    detector.start()
    expect(detector.isOpen).toBe(true)
    detector.stop()
  })

  it('reports closed when within thresholds', () => {
    const detector = createDevToolsDetector({ windowLike: closedWindow })
    detector.start()
    expect(detector.isOpen).toBe(false)
    detector.stop()
  })

  it('notifies onChange on state transitions', () => {
    const changes: boolean[] = []
    const closed = createDevToolsDetector({ windowLike: closedWindow })
    closed.onChange((open) => changes.push(open))
    closed.start()
    expect(changes).toEqual([])
    expect(closed.isOpen).toBe(false)
    closed.stop()

    const open = createDevToolsDetector({ windowLike: openWindow })
    open.onChange((open) => changes.push(open))
    open.start()
    expect(changes).toEqual([true])
    expect(open.isOpen).toBe(true)
    open.stop()
  })

  it('starts the debugger trap interval only when trap is enabled and open', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    const detector = createDevToolsDetector({ windowLike: openWindow, trap: true })
    detector.start()

    expect(
      setIntervalSpy.mock.calls.some(([, ms]) => ms === 100),
    ).toBe(true)

    detector.stop()
    expect(clearIntervalSpy).toHaveBeenCalled()
  })
})
