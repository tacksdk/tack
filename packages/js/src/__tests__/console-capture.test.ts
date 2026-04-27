// Direct tests for the console-capture module: serializer correctness on
// nasty inputs (cycles, errors, DOM, depth, size cap), buffer FIFO, custom
// levels + maxEntries, late-wrap-safe uninstall.
//
// The serializer is the most-bug-prone surface: a single throw inside a
// console.error wrapper would break the host page. Tested here to keep the
// coverage explicit even though the integration tests in widget.test.ts
// also exercise it indirectly.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installConsoleCapture } from '../console-capture'

let restoreFns: (() => void)[] = []

beforeEach(() => {
  restoreFns = []
  vi.restoreAllMocks()
})

afterEach(() => {
  for (const fn of restoreFns.reverse()) fn()
  restoreFns = []
})

/** Suppress real console output for the duration of the test. */
function muteConsole(level: 'error' | 'warn' | 'info' | 'log') {
  const original = console[level]
  console[level] = (() => {}) as typeof console[typeof level]
  restoreFns.push(() => {
    console[level] = original
  })
}

describe('installConsoleCapture', () => {
  it('captureConsole: false returns a no-op handle', () => {
    const handle = installConsoleCapture(false)
    expect(handle.snapshot()).toEqual([])
    handle.uninstall() // no-op, no throw
  })

  it('default (true) captures error + warn at last 20 entries', () => {
    muteConsole('error')
    muteConsole('warn')
    const handle = installConsoleCapture(true)
    for (let i = 0; i < 25; i++) console.error(`e${i}`)
    const buf = handle.snapshot()
    expect(buf.length).toBe(20) // FIFO eviction at 20
    // Oldest evicted; newest preserved
    expect(buf[0].msg).toBe('e5')
    expect(buf[19].msg).toBe('e24')
    expect(buf.every((e) => e.level === 'error')).toBe(true)
    handle.uninstall()
  })

  it('custom levels + maxEntries respected', () => {
    muteConsole('log')
    muteConsole('info')
    const handle = installConsoleCapture({
      levels: ['log', 'info'],
      maxEntries: 3,
    })
    console.log('a')
    console.info('b')
    console.log('c')
    console.log('d')
    const buf = handle.snapshot()
    expect(buf.length).toBe(3)
    expect(buf.map((e) => e.msg)).toEqual(['b', 'c', 'd'])
    handle.uninstall()
  })

  it('snapshot returns a copy, not a live reference', () => {
    muteConsole('error')
    const handle = installConsoleCapture(true)
    console.error('x')
    const snap = handle.snapshot()
    console.error('y')
    expect(snap.length).toBe(1) // didn't grow after snapshot
    expect(handle.snapshot().length).toBe(2)
    handle.uninstall()
  })

  it('passthrough preserves original console output', () => {
    const calls: unknown[][] = []
    const original = console.error
    console.error = ((...args: unknown[]) => {
      calls.push(args)
    }) as typeof console.error
    restoreFns.push(() => {
      console.error = original
    })

    const handle = installConsoleCapture(true)
    console.error('hello', { x: 1 })
    expect(calls.length).toBe(1)
    expect(calls[0]).toEqual(['hello', { x: 1 }])
    handle.uninstall()
  })

  it('uninstall is wrapper-identity-safe (Sentry-style late wrap)', () => {
    muteConsole('error')
    const native = console.error
    const handle = installConsoleCapture(true)
    const tackWrapper = console.error
    expect(tackWrapper).not.toBe(native)

    // Simulate a late-initializing observability lib wrapping on top.
    const sentryWrapper = ((...args: unknown[]) => {
      ;(tackWrapper as (...a: unknown[]) => void)(...args)
    }) as typeof console.error
    console.error = sentryWrapper

    handle.uninstall()
    // Our uninstall should NOT have restored — current wrapper is sentry's,
    // not ours, so we leave it alone.
    expect(console.error).toBe(sentryWrapper)
  })

  it('post-destroy passthrough: orphaned wrapper does not keep buffering', () => {
    const native = console.error
    console.error = (() => {}) as typeof console.error
    try {
      const a = installConsoleCapture(true)
      const aWrapper = console.error
      // Late wrap on top of A.
      const sentryInner = vi.fn()
      const sentryWrap = ((...args: unknown[]) => {
        sentryInner(...args)
        ;(aWrapper as (...a: unknown[]) => void)(...args)
      }) as typeof console.error
      console.error = sentryWrap
      // Destroy A. Wrapper-identity check fails (Sentry's on top), so A's
      // wrapper stays in the call chain. But the destroyed flag flips, so
      // A's wrapper becomes a passthrough.
      a.uninstall()
      expect(console.error).toBe(sentryWrap)
      console.error('after-destroy')
      expect(sentryInner).toHaveBeenCalledWith('after-destroy')
      // A's snapshot returns [] (buffer cleared on uninstall), and the
      // orphaned A wrapper did NOT push (passthrough mode).
      expect(a.snapshot()).toEqual([])
    } finally {
      console.error = native
    }
  })

  it('uninstall clears the buffer', () => {
    muteConsole('error')
    const handle = installConsoleCapture(true)
    console.error('x')
    expect(handle.snapshot().length).toBe(1)
    handle.uninstall()
    expect(handle.snapshot()).toEqual([])
  })
})

describe('serializer (via captured wrapper)', () => {
  it('does NOT throw on circular references', () => {
    muteConsole('error')
    const handle = installConsoleCapture(true)
    const obj: Record<string, unknown> = { a: 1 }
    obj.self = obj
    expect(() => console.error(obj)).not.toThrow()
    const buf = handle.snapshot()
    expect(buf.length).toBe(1)
    expect(buf[0].msg).toMatch(/Circular/)
    handle.uninstall()
  })

  it('renders Error objects with name + message', () => {
    muteConsole('error')
    const handle = installConsoleCapture(true)
    console.error(new TypeError('bad input'))
    const buf = handle.snapshot()
    expect(buf[0].msg).toMatch(/TypeError: bad input/)
    handle.uninstall()
  })

  it('renders functions as [Function: name]', () => {
    muteConsole('log')
    const handle = installConsoleCapture({ levels: ['log'] })
    function namedFn() {}
    console.log(namedFn)
    expect(handle.snapshot()[0].msg).toBe('[Function: namedFn]')
    handle.uninstall()
  })

  it('caps depth at 3 (deeply nested objects)', () => {
    muteConsole('log')
    const handle = installConsoleCapture({ levels: ['log'] })
    const deep = { a: { b: { c: { d: { e: 'deep' } } } } }
    console.log(deep)
    // At depth 3 we should see [...] for the inner object
    const msg = handle.snapshot()[0].msg
    expect(msg).toContain('[…]')
    expect(msg).not.toContain('deep') // truncated before reaching the leaf
    handle.uninstall()
  })

  it('handles symbols without throwing', () => {
    muteConsole('log')
    const handle = installConsoleCapture({ levels: ['log'] })
    expect(() => console.log(Symbol('test'))).not.toThrow()
    expect(handle.snapshot()[0].msg).toBe('Symbol(test)')
    handle.uninstall()
  })

  it('truncates DOM nodes via outerHTML', () => {
    muteConsole('log')
    const handle = installConsoleCapture({ levels: ['log'] })
    const el = document.createElement('div')
    el.id = 'test'
    el.textContent = 'hello'
    console.log(el)
    expect(handle.snapshot()[0].msg).toMatch(/^<div id="test">hello<\/div>/)
    handle.uninstall()
  })

  it('renders arrays with element separation', () => {
    muteConsole('log')
    const handle = installConsoleCapture({ levels: ['log'] })
    console.log([1, 'two', { x: 3 }])
    expect(handle.snapshot()[0].msg).toBe('[1, two, {x: 3}]')
    handle.uninstall()
  })
})
