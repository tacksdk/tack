// S11 — host font safety defenses.
//
// Tests assert:
//   1. blacklist match → host gets safe stack, warn fires once
//   2. safe font → no override, no warn
//   3. injectStyles: false → skipped entirely
//   4. repeat mounts on the same page only warn once
//   5. blacklist override is set as inline `font-family` on the host element

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetFontSafetyCache, applyFontSafety } from '../font-safety'
import { Tack } from '../widget'

function patchDialog() {
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal?: () => void
    close?: () => void
  }
  if (!proto.showModal) {
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
      Object.defineProperty(this, 'open', {
        configurable: true,
        value: true,
        writable: true,
      })
    }
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open')
      Object.defineProperty(this, 'open', {
        configurable: true,
        value: false,
        writable: true,
      })
    }
  }
}

function stubBodyFont(family: string) {
  // jsdom's getComputedStyle returns a CSSStyleDeclaration; we can shadow it
  // for the duration of the test by stubbing window.getComputedStyle.
  const real = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation(((el: Element) => {
    if (el === document.body) {
      return { fontFamily: family } as unknown as CSSStyleDeclaration
    }
    return real(el as HTMLElement)
  }) as typeof window.getComputedStyle)
}

beforeEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  vi.restoreAllMocks()
  __resetFontSafetyCache()
  patchDialog()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('applyFontSafety (unit)', () => {
  it('blacklist match → sets inline font-family + warns once', () => {
    stubBodyFont('"Cabinet Grotesk", sans-serif')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = document.createElement('div')
    applyFontSafety(host)
    expect(host.style.fontFamily).toMatch(/system-ui|sans-serif/)
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0][0]).toMatch(/unsafe for body text/)
  })

  it('safe font → no override, no warn', () => {
    stubBodyFont('-apple-system, system-ui, sans-serif')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = document.createElement('div')
    applyFontSafety(host)
    expect(host.style.fontFamily).toBe('')
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('injectStyles: false → skipped entirely (no override, no warn)', () => {
    stubBodyFont('"Cabinet Grotesk", sans-serif')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = document.createElement('div')
    applyFontSafety(host, { injectStyles: false })
    expect(host.style.fontFamily).toBe('')
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('multiple mounts → only one warning per page load', () => {
    stubBodyFont('Lobster, cursive')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const a = document.createElement('div')
    const b = document.createElement('div')
    const c = document.createElement('div')
    applyFontSafety(a)
    applyFontSafety(b)
    applyFontSafety(c)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    // But every mount got the override — defense is not optional after warn
    expect(a.style.fontFamily).toMatch(/system-ui|sans-serif/)
    expect(b.style.fontFamily).toMatch(/system-ui|sans-serif/)
    expect(c.style.fontFamily).toMatch(/system-ui|sans-serif/)
  })

  it('matches the " Display" suffix wildcard from the blacklist', () => {
    stubBodyFont('"Some Custom Display", sans-serif')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = document.createElement('div')
    applyFontSafety(host)
    expect(host.style.fontFamily).toMatch(/system-ui|sans-serif/)
    expect(warnSpy).toHaveBeenCalledOnce()
  })
})

describe('font safety integration via Tack.init', () => {
  it('unsafe host font triggers fallback on the shadow host element', () => {
    stubBodyFont('"Comic Sans MS", cursive')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handle = Tack.init({ projectId: 'proj_test' })
    handle.open()
    const host = document.querySelector('tack-widget-host') as HTMLElement
    expect(host).not.toBeNull()
    expect(host.style.fontFamily).toMatch(/system-ui|sans-serif/)
    handle.destroy()
  })

  it('safe host font leaves the shadow host alone', () => {
    stubBodyFont('-apple-system, system-ui, sans-serif')
    const handle = Tack.init({ projectId: 'proj_test' })
    handle.open()
    const host = document.querySelector('tack-widget-host') as HTMLElement
    expect(host.style.fontFamily).toBe('')
    handle.destroy()
  })

  it('injectStyles: false skips font-safety even on unsafe host', () => {
    stubBodyFont('"Bebas Neue", sans-serif')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handle = Tack.init({ projectId: 'proj_test', injectStyles: false })
    handle.open()
    const host = document.querySelector('tack-widget-host') as HTMLElement
    expect(host.style.fontFamily).toBe('')
    expect(warnSpy).not.toHaveBeenCalled()
    handle.destroy()
  })
})
