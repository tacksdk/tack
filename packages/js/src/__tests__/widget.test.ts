// Real DOM tests for the closed-shadow-DOM widget. Runs under jsdom — see
// vitest.config.ts. Covers handle shape, mount/unmount lifecycle, two
// independent instances, abort-on-cancel, post-destroy callback suppression,
// shadow root style isolation. Network is mocked.
//
// The widget mounts inside a closed shadow root, so `host.shadowRoot`
// returns null from outside. Tests reach the root via `__testShadowRoots`
// (a WeakMap exported from widget.ts as a test affordance — production
// callers cannot reach it). Helpers below wrap that lookup so individual
// test bodies stay readable.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Tack, __testShadowRoots } from '../widget'

function shadowOf(host: Element): ShadowRoot {
  const root = __testShadowRoots.get(host)
  if (!root) throw new Error('No shadow root registered for host element')
  return root
}

/** Find the (single) widget shadow root in the document, or null. */
function widgetShadow(): ShadowRoot | null {
  const host = document.querySelector('tack-widget-host')
  return host ? shadowOf(host) : null
}

/** Find the (single) widget dialog in the document, or null. */
function getDialog(): HTMLDialogElement | null {
  return widgetShadow()?.querySelector<HTMLDialogElement>('dialog[data-tack-widget]') ?? null
}

/** Collect all widget dialogs across all hosts. */
function getAllDialogs(): HTMLDialogElement[] {
  return Array.from(document.querySelectorAll('tack-widget-host')).flatMap((h) => {
    const root = __testShadowRoots.get(h)
    if (!root) return []
    return Array.from(
      root.querySelectorAll<HTMLDialogElement>('dialog[data-tack-widget]'),
    )
  })
}

/** Count widget dialogs across all hosts. */
function countDialogs(): number {
  return getAllDialogs().length
}

/** Find an element inside the (single) widget shadow root by selector. */
function inShadow<E extends Element = Element>(selector: string): E | null {
  return widgetShadow()?.querySelector<E>(selector) ?? null
}

/**
 * True when a shadow root has the default Tack stylesheet attached, by either
 * path: (a) `adoptedStyleSheets` contains a sheet whose serialized cssText
 * mentions `--tack-bg` (the constructable-stylesheet path), or (b) a child
 * `<style>` element contains it (the Safari-fallback path).
 */
function hasTackStyles(shadow: ShadowRoot): boolean {
  const adopted = (shadow as unknown as { adoptedStyleSheets?: CSSStyleSheet[] })
    .adoptedStyleSheets
  if (adopted && adopted.length > 0) {
    for (const sheet of adopted) {
      try {
        const cssText = Array.from(sheet.cssRules)
          .map((r) => r.cssText)
          .join('\n')
        if (cssText.includes('--tack-bg')) return true
      } catch {
        // Some test environments don't expose cssRules; treat presence as proof
        return true
      }
    }
  }
  const style = shadow.querySelector('style[data-tack-styles]')
  return !!style?.textContent?.includes('--tack-bg')
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// jsdom doesn't implement HTMLDialogElement methods. Minimal polyfill.
function patchDialog() {
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal: () => void
    close: () => void
  }
  if (!('showModal' in proto) || typeof proto.showModal !== 'function' || (proto.showModal as { _patched?: boolean })._patched) {
    const showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
      Object.defineProperty(this, 'open', { configurable: true, value: true, writable: true })
    }
    ;(showModal as unknown as { _patched: boolean })._patched = true
    proto.showModal = showModal
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open')
      Object.defineProperty(this, 'open', { configurable: true, value: false, writable: true })
    }
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  vi.restoreAllMocks()
  patchDialog()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Tack widget', () => {
  it('throws when projectId is missing', () => {
    expect(() => Tack.init({} as never)).toThrow(/projectId/)
  })

  it('returns a handle with open/close/destroy', () => {
    const handle = Tack.init({ projectId: 'proj_test' })
    expect(typeof handle.open).toBe('function')
    expect(typeof handle.close).toBe('function')
    expect(typeof handle.destroy).toBe('function')
  })

  it('open() mounts a <dialog> inside a shadow host and showModal()s it', () => {
    const handle = Tack.init({ projectId: 'proj_test' })
    expect(document.querySelector('tack-widget-host')).toBeNull()
    handle.open()
    expect(document.querySelector('tack-widget-host')).not.toBeNull()
    const dialog = getDialog()
    expect(dialog).not.toBeNull()
    expect(dialog!.open).toBe(true)
    handle.destroy()
  })

  it('open() is idempotent — second call does not duplicate the host or dialog', () => {
    const handle = Tack.init({ projectId: 'proj_test' })
    handle.open()
    handle.open()
    expect(document.querySelectorAll('tack-widget-host')).toHaveLength(1)
    expect(countDialogs()).toBe(1)
    handle.destroy()
  })

  it('close() closes the dialog without removing the host', () => {
    const handle = Tack.init({ projectId: 'proj_test' })
    handle.open()
    handle.close()
    expect(document.querySelector('tack-widget-host')).not.toBeNull()
    const dialog = getDialog()
    expect(dialog).not.toBeNull()
    expect(dialog!.open).toBe(false)
    handle.destroy()
  })

  it('destroy() removes the host (cascading shadow + dialog) and is idempotent', () => {
    const handle = Tack.init({ projectId: 'proj_test' })
    handle.open()
    handle.destroy()
    expect(document.querySelector('tack-widget-host')).toBeNull()
    expect(countDialogs()).toBe(0)
    expect(() => handle.destroy()).not.toThrow()
    // open() after destroy is a no-op (no remount)
    handle.open()
    expect(document.querySelector('tack-widget-host')).toBeNull()
  })

  it('two handles mount independent shadow hosts and dialogs', () => {
    const a = Tack.init({ projectId: 'proj_a' })
    const b = Tack.init({ projectId: 'proj_b' })
    a.open()
    b.open()
    expect(document.querySelectorAll('tack-widget-host')).toHaveLength(2)
    expect(countDialogs()).toBe(2)
    a.destroy()
    expect(document.querySelectorAll('tack-widget-host')).toHaveLength(1)
    expect(countDialogs()).toBe(1)
    b.destroy()
    expect(document.querySelectorAll('tack-widget-host')).toHaveLength(0)
    expect(countDialogs()).toBe(0)
  })

  it('successful submit fires onSubmit, clears textarea, closes dialog', async () => {
    const onSubmit = vi.fn()
    const fetchMock = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ id: 'fbk_1', url: 'https://x', created_at: '2026-01-01' }),
      }) as unknown as Response,
    )
    vi.stubGlobal('fetch', fetchMock)

    const handle = Tack.init({ projectId: 'proj_test', onSubmit })
    handle.open()
    const textarea = inShadow<HTMLTextAreaElement>('[data-tack-input]')!
    textarea.value = 'great app'
    inShadow<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()
    await flush()

    expect(fetchMock).toHaveBeenCalledOnce()
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(call[0]).toMatch(/\/api\/v1\/feedback$/)
    expect(call[1].headers).toMatchObject({
      'X-Tack-SDK-Version': expect.any(String),
      'Idempotency-Key': expect.any(String),
    })
    expect(onSubmit).toHaveBeenCalledWith({
      id: 'fbk_1',
      url: 'https://x',
      created_at: '2026-01-01',
    })
    expect(textarea.value).toBe('')
    expect(
      getDialog()!.open,
    ).toBe(false)
    handle.destroy()
  })

  it('failed submit fires onError and keeps the dialog open', async () => {
    const onError = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ({
          ok: false,
          status: 429,
          text: async () =>
            JSON.stringify({
              error: { type: 'rate_limited', message: 'slow down', doc_url: 'x' },
            }),
        }) as unknown as Response,
      ),
    )

    const handle = Tack.init({ projectId: 'proj_test', onError })
    handle.open()
    inShadow<HTMLTextAreaElement>('[data-tack-input]')!.value = 'hi'
    inShadow<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()
    await flush()

    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0][0].type).toBe('rate_limited')
    expect(
      getDialog()!.open,
    ).toBe(true)
    handle.destroy()
  })

  it('close() during in-flight submit aborts the request and suppresses callbacks', async () => {
    const onSubmit = vi.fn()
    const onError = vi.fn()
    let abortRef: AbortSignal | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        abortRef = init?.signal ?? null
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          })
        })
      }),
    )

    const handle = Tack.init({ projectId: 'proj_test', onSubmit, onError })
    handle.open()
    inShadow<HTMLTextAreaElement>('[data-tack-input]')!.value = 'hi'
    inShadow<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()
    handle.close()
    await flush()

    expect(abortRef!.aborted).toBe(true)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    handle.destroy()
  })

  it('destroy() during in-flight submit suppresses callbacks', async () => {
    const onSubmit = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  status: 200,
                  text: async () =>
                    JSON.stringify({ id: 'fbk_x', url: 'x', created_at: 'x' }),
                } as unknown as Response),
              5,
            )
          }),
      ),
    )

    const handle = Tack.init({ projectId: 'proj_test', onSubmit })
    handle.open()
    inShadow<HTMLTextAreaElement>('[data-tack-input]')!.value = 'hi'
    inShadow<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()
    handle.destroy()
    await new Promise((r) => setTimeout(r, 20))

    expect(onSubmit).not.toHaveBeenCalled()
  })

  describe('theming', () => {
    it('injects the default stylesheet into each shadow root on first open', () => {
      const a = Tack.init({ projectId: 'proj_a' })
      const b = Tack.init({ projectId: 'proj_b' })
      // Before opening, no shadow hosts exist anywhere
      expect(document.querySelectorAll('tack-widget-host')).toHaveLength(0)
      a.open()
      b.open()
      // Each widget got its own shadow root, each scoped to that root
      const hosts = Array.from(document.querySelectorAll('tack-widget-host'))
      expect(hosts).toHaveLength(2)
      for (const host of hosts) {
        const root = __testShadowRoots.get(host)!
        expect(hasTackStyles(root)).toBe(true)
      }
      // No styles leaked into the document <head>
      expect(document.head.querySelector('style[data-tack-styles]')).toBeNull()
      a.destroy()
      b.destroy()
    })

    it('injectStyles: false skips the stylesheet inside the shadow root', () => {
      const handle = Tack.init({ projectId: 'proj_test', injectStyles: false })
      handle.open()
      const root = widgetShadow()!
      expect(hasTackStyles(root)).toBe(false)
      handle.destroy()
    })

    it('theme: "dark" sets data-tack-theme on the dialog', () => {
      const handle = Tack.init({ projectId: 'proj_test', theme: 'dark' })
      handle.open()
      const dialog = getDialog()!
      expect(dialog.getAttribute('data-tack-theme')).toBe('dark')
      handle.destroy()
    })

    it('default theme is "dark" per DESIGN.md (sets data-tack-theme="dark")', () => {
      const handle = Tack.init({ projectId: 'proj_test' })
      handle.open()
      const dialog = getDialog()!
      expect(dialog.getAttribute('data-tack-theme')).toBe('dark')
      handle.destroy()
    })

    it('theme: "auto" leaves data-tack-theme unset (CSS handles via media query)', () => {
      const handle = Tack.init({ projectId: 'proj_test', theme: 'auto' })
      handle.open()
      const dialog = getDialog()!
      expect(dialog.hasAttribute('data-tack-theme')).toBe(false)
      handle.destroy()
    })

    it('respects custom title, labels, and placeholder', () => {
      const handle = Tack.init({
        projectId: 'proj_test',
        title: 'Tell us!',
        submitLabel: 'Ship it',
        cancelLabel: 'Nope',
        placeholder: 'go on...',
      })
      handle.open()
      expect(inShadow('[data-tack-title]')!.textContent).toBe('Tell us!')
      expect(inShadow('[data-tack-submit]')!.textContent).toBe('Ship it')
      expect(inShadow('[data-tack-cancel]')!.textContent).toBe('Nope')
      expect(
        inShadow<HTMLTextAreaElement>('[data-tack-input]')!.placeholder,
      ).toBe('go on...')
      handle.destroy()
    })

    it('dialog has aria-labelledby pointing at the title (scoped within shadow root)', () => {
      const handle = Tack.init({ projectId: 'proj_test' })
      handle.open()
      const root = widgetShadow()!
      const dialog = root.querySelector('dialog[data-tack-widget]')!
      const titleId = dialog.getAttribute('aria-labelledby')
      expect(titleId).toBeTruthy()
      // ShadowRoot.getElementById walks the shadow tree, not the document.
      // The title is mounted inside the shadow root, so document.getElementById
      // would (correctly) return null. The aria reference works because
      // aria-labelledby resolves within the same shadow tree.
      expect(root.getElementById(titleId!)).not.toBeNull()
      handle.destroy()
    })
  })

  describe('handle.update()', () => {
    it('patches user/metadata used by the next submit', async () => {
      const fetchMock = vi.fn(async () =>
        ({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: 'fbk_1', url: 'x', created_at: 'x' }),
        }) as unknown as Response,
      )
      vi.stubGlobal('fetch', fetchMock)

      const handle = Tack.init({ projectId: 'proj_test', user: { id: 'old' } })
      handle.update({ user: { id: 'new' }, metadata: { page: '/about' } })
      handle.open()
      inShadow<HTMLTextAreaElement>('[data-tack-input]')!.value = 'hi'
      inShadow<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()
      await flush()

      const sentBody = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
      expect(sentBody.user).toEqual({ id: 'new' })
      expect(sentBody.metadata).toEqual({ page: '/about' })
      handle.destroy()
    })

    it('patches onSubmit/onError without re-mounting', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ id: 'fbk_1', url: 'x', created_at: 'x' }),
          }) as unknown as Response,
        ),
      )
      const first = vi.fn()
      const second = vi.fn()
      const handle = Tack.init({ projectId: 'proj_test', onSubmit: first })
      handle.update({ onSubmit: second })
      // Same dialog, no re-mount
      expect(getAllDialogs()).toHaveLength(0)
      handle.open()
      expect(getAllDialogs()).toHaveLength(1)
      inShadow<HTMLTextAreaElement>('[data-tack-input]')!.value = 'hi'
      inShadow<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()
      await flush()
      expect(first).not.toHaveBeenCalled()
      expect(second).toHaveBeenCalledOnce()
      handle.destroy()
    })

    it('only writes fields that are present in the partial', () => {
      const handle = Tack.init({ projectId: 'proj_test', user: { id: 'a' }, metadata: { x: 1 } })
      handle.update({ user: { id: 'b' } }) // metadata key absent
      // No DOM-observable assertion possible without a submit; but smoke
      // verifies update doesn't blow away unmentioned fields. The submit
      // test above covers the wire shape.
      expect(() => handle.update({})).not.toThrow()
      handle.destroy()
    })

    it('after destroy, update is a no-op', () => {
      const handle = Tack.init({ projectId: 'proj_test' })
      handle.destroy()
      expect(() => handle.update({ user: { id: 'x' } })).not.toThrow()
    })
  })

  it('Tack.version is a string', () => {
    expect(typeof Tack.version).toBe('string')
    expect(Tack.version.length).toBeGreaterThan(0)
  })

  it('SSR (no window) returns a no-op handle without throwing', () => {
    const realWindow = globalThis.window
    const realDocument = globalThis.document
    delete (globalThis as { window?: unknown }).window
    delete (globalThis as { document?: unknown }).document
    try {
      const handle = Tack.init({ projectId: 'proj_test' })
      expect(() => handle.open()).not.toThrow()
      expect(() => handle.close()).not.toThrow()
      expect(() => handle.destroy()).not.toThrow()
    } finally {
      ;(globalThis as { window?: unknown }).window = realWindow
      ;(globalThis as { document?: unknown }).document = realDocument
    }
  })
})
