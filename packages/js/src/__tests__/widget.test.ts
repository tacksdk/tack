// Smoke tests for the walking-skeleton widget. Real DOM behaviour (open
// renders <dialog>, submit posts, destroy cleans up) is not covered here —
// jsdom isn't wired into the test runner yet. A follow-up PR will add it
// alongside the lifecycle state machine.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { init } from '../widget'

const realWindow = (globalThis as { window?: unknown }).window
const realDocument = (globalThis as { document?: unknown }).document

beforeEach(() => {
  // Minimum viable DOM stubs — enough for init() to not blow up. Anything
  // that touches actual elements is exercised in follow-up DOM tests.
  vi.stubGlobal('window', {})
  vi.stubGlobal('document', { body: { append() {} }, createElement: () => ({}) })
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (realWindow !== undefined) (globalThis as { window?: unknown }).window = realWindow
  if (realDocument !== undefined) (globalThis as { document?: unknown }).document = realDocument
})

describe('Tack widget — walking skeleton', () => {
  it('throws when projectId is missing', () => {
    expect(() => init({} as never)).toThrow(/projectId/)
  })

  it('returns a handle with open/close/destroy', () => {
    const handle = init({ projectId: 'proj_test' })
    expect(typeof handle.open).toBe('function')
    expect(typeof handle.close).toBe('function')
    expect(typeof handle.destroy).toBe('function')
  })

  it('destroy is idempotent and prevents subsequent open', () => {
    const handle = init({ projectId: 'proj_test' })
    handle.destroy()
    expect(() => handle.destroy()).not.toThrow()
    // post-destroy open is a no-op (no DOM access, no throw)
    expect(() => handle.open()).not.toThrow()
  })

  it('two handles are independent (no module-level singleton)', () => {
    const a = init({ projectId: 'proj_a' })
    const b = init({ projectId: 'proj_b' })
    expect(a).not.toBe(b)
    a.destroy()
    expect(() => b.destroy()).not.toThrow()
  })
})
