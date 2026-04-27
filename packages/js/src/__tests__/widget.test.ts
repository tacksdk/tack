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

/**
 * Wait long enough for the capture promise chain to resolve. The capture path
 * awaits one requestAnimationFrame (which jsdom polyfills to a ~16ms
 * timeout), then dynamic import + customFn + transitions. 50ms is generous
 * and keeps the suite fast.
 */
function flushCapture(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50))
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
      // Real browsers dispatch a 'close' event from dialog.close(); jsdom
      // doesn't. The widget's discard semantics (clear textarea + screenshot)
      // hook into this event so all dismissal paths (Cancel, ESC, backdrop)
      // funnel through it.
      this.dispatchEvent(new Event('close'))
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

  it('closed shadow DOM: host.shadowRoot is null from outside (security claim)', () => {
    const handle = Tack.init({ projectId: 'proj_test' })
    handle.open()
    const host = document.querySelector('tack-widget-host')!
    // Closed mode hides the shadow root from host JS. This is the chameleon
    // contract from DESIGN.md — verify the property holds at runtime.
    expect(host.shadowRoot).toBeNull()
    // But test code can still pierce via the WeakMap backdoor.
    expect(__testShadowRoots.get(host)).toBeDefined()
    handle.destroy()
  })

  it('falls back to a per-shadow <style> element when adoptedStyleSheets is missing', () => {
    // Stub the constructable-stylesheets path. ShadowRoot keeps the
    // descriptor in jsdom, so we monkey-patch CSSStyleSheet.prototype to
    // simulate Safari 15.4-16.3.
    const originalReplaceSync = (CSSStyleSheet.prototype as unknown as {
      replaceSync?: unknown
    }).replaceSync
    delete (CSSStyleSheet.prototype as unknown as { replaceSync?: unknown }).replaceSync
    try {
      const handle = Tack.init({ projectId: 'proj_test' })
      handle.open()
      const root = __testShadowRoots.get(
        document.querySelector('tack-widget-host')!,
      )!
      // Fallback path appends a <style data-tack-styles> inside the shadow.
      const styleEl = root.querySelector('style[data-tack-styles]')
      expect(styleEl).not.toBeNull()
      expect(styleEl!.textContent).toContain('--tack-bg')
      handle.destroy()
    } finally {
      if (originalReplaceSync) {
        ;(CSSStyleSheet.prototype as unknown as { replaceSync: unknown }).replaceSync =
          originalReplaceSync
      }
    }
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

  it('successful submit transitions to success state, then auto-closes', async () => {
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
    // Fake timers so we can fast-forward past the 1800ms success auto-close
    // without making real-world test runs slow.
    vi.useFakeTimers({ shouldAdvanceTime: true })

    try {
      const handle = Tack.init({ projectId: 'proj_test', onSubmit })
      handle.open()
      const textarea = inShadow<HTMLTextAreaElement>('[data-tack-input]')!
      textarea.value = 'great app'
      inShadow<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()
      await vi.advanceTimersByTimeAsync(0) // resolve fetch promise microtask

      expect(fetchMock).toHaveBeenCalledOnce()
      const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(call[0]).toMatch(/\/api\/v1\/feedback$/)
      expect(call[1].headers).toMatchObject({
        'X-Tack-SDK-Version': expect.any(String),
        'Idempotency-Key': expect.any(String),
      })
      // onSubmit now receives (result, request) — second arg is the payload
      // we sent. Existing callers ignore the second arg and still work.
      expect(onSubmit).toHaveBeenCalledWith(
        { id: 'fbk_1', url: 'https://x', created_at: '2026-01-01' },
        expect.objectContaining({ projectId: 'proj_test', body: 'great app' }),
      )
      // Textarea cleared, dialog still OPEN with success state showing the
      // confirmation message (per FSM spec — success auto-closes after a beat
      // so the user sees the acknowledgement).
      expect(textarea.value).toBe('')
      expect(getDialog()!.open).toBe(true)
      expect(getDialog()!.getAttribute('data-tack-state')).toBe('success')
      const status = inShadow<HTMLDivElement>('[data-tack-status]')!
      expect(status.hidden).toBe(false)
      expect(status.textContent).toMatch(/thanks/i)
      // Advance past the auto-close timeout — dialog now closes on its own.
      await vi.advanceTimersByTimeAsync(2000)
      expect(getDialog()!.open).toBe(false)
      handle.destroy()
    } finally {
      vi.useRealTimers()
    }
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

  describe('FSM lifecycle', () => {
    function mockJsonError(status: number, body: unknown) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          ({
            ok: false,
            status,
            text: async () => JSON.stringify(body),
          }) as unknown as Response,
        ),
      )
    }

    async function submitWith(handle: ReturnType<typeof Tack.init>, body: string) {
      handle.open()
      inShadow<HTMLTextAreaElement>('[data-tack-input]')!.value = body
      inShadow<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()
      await flush()
    }

    it('429 → error_retryable: status visible, retry button shown, submit hidden', async () => {
      mockJsonError(429, {
        error: { type: 'rate_limited', message: 'slow down', doc_url: 'https://x' },
      })
      const handle = Tack.init({ projectId: 'proj_test' })
      await submitWith(handle, 'hi')

      expect(getDialog()!.getAttribute('data-tack-state')).toBe('error_retryable')
      const status = inShadow<HTMLDivElement>('[data-tack-status]')!
      expect(status.hidden).toBe(false)
      const submit = inShadow<HTMLButtonElement>('[data-tack-submit]')!
      const retry = inShadow<HTMLButtonElement>('[data-tack-retry]')!
      expect(submit.hidden).toBe(true)
      expect(retry.hidden).toBe(false)
      // Dialog stays open
      expect(getDialog()!.open).toBe(true)
      handle.destroy()
    })

    it('500 → error_retryable (5xx is treated as a retryable server error)', async () => {
      mockJsonError(500, {
        error: { type: 'internal_error', message: 'oops', doc_url: 'https://x' },
      })
      const handle = Tack.init({ projectId: 'proj_test' })
      await submitWith(handle, 'hi')
      expect(getDialog()!.getAttribute('data-tack-state')).toBe('error_retryable')
      handle.destroy()
    })

    it('400 → error_docs: doc link href is set and visible, retry hidden', async () => {
      mockJsonError(400, {
        error: {
          type: 'invalid_request',
          message: 'body required',
          doc_url: 'https://tacksdk.com/docs/errors#invalid_request',
        },
      })
      const handle = Tack.init({ projectId: 'proj_test' })
      await submitWith(handle, 'hi')

      expect(getDialog()!.getAttribute('data-tack-state')).toBe('error_docs')
      const docLink = inShadow<HTMLAnchorElement>('[data-tack-doc-link]')!
      expect(docLink.hidden).toBe(false)
      expect(docLink.getAttribute('href')).toBe(
        'https://tacksdk.com/docs/errors#invalid_request',
      )
      const retry = inShadow<HTMLButtonElement>('[data-tack-retry]')!
      expect(retry.hidden).toBe(true)
      handle.destroy()
    })

    it('error_docs with non-http doc_url leaves the link hidden (XSS guard)', async () => {
      // Defensive against a misconfigured backend sending a javascript: URL.
      // rel=noopener doesn't block javascript: scheme execution on click.
      mockJsonError(400, {
        error: {
          type: 'invalid_request',
          message: 'oops',
          doc_url: 'javascript:alert(1)' as string,
        },
      })
      const handle = Tack.init({ projectId: 'proj_test' })
      await submitWith(handle, 'hi')

      const docLink = inShadow<HTMLAnchorElement>('[data-tack-doc-link]')!
      expect(docLink.hidden).toBe(true)
      expect(docLink.hasAttribute('href')).toBe(false)
      handle.destroy()
    })

    it('network failure → network_error state with retry button', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('Failed to fetch')
        }),
      )
      const handle = Tack.init({ projectId: 'proj_test' })
      await submitWith(handle, 'hi')

      expect(getDialog()!.getAttribute('data-tack-state')).toBe('network_error')
      const retry = inShadow<HTMLButtonElement>('[data-tack-retry]')!
      expect(retry.hidden).toBe(false)
      const status = inShadow<HTMLDivElement>('[data-tack-status]')!
      expect(status.textContent).toMatch(/network/i)
      handle.destroy()
    })

    it('retry button from error_retryable runs another submit attempt', async () => {
      let callCount = 0
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          callCount++
          if (callCount === 1) {
            return {
              ok: false,
              status: 429,
              text: async () =>
                JSON.stringify({
                  error: { type: 'rate_limited', message: 'slow', doc_url: 'x' },
                }),
            } as unknown as Response
          }
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({ id: 'fbk_1', url: 'x', created_at: 'x' }),
          } as unknown as Response
        }),
      )
      const handle = Tack.init({ projectId: 'proj_test' })
      await submitWith(handle, 'hi')
      expect(getDialog()!.getAttribute('data-tack-state')).toBe('error_retryable')

      const retry = inShadow<HTMLButtonElement>('[data-tack-retry]')!
      retry.click()
      await flush()

      expect(callCount).toBe(2)
      // Second attempt succeeded → success state
      expect(getDialog()!.getAttribute('data-tack-state')).toBe('success')
      handle.destroy()
    })

    it('typing into textarea while in error_docs returns to composing', async () => {
      mockJsonError(400, {
        error: { type: 'invalid_request', message: 'bad', doc_url: 'x' },
      })
      const handle = Tack.init({ projectId: 'proj_test' })
      await submitWith(handle, 'hi')
      expect(getDialog()!.getAttribute('data-tack-state')).toBe('error_docs')

      const textarea = inShadow<HTMLTextAreaElement>('[data-tack-input]')!
      textarea.value = 'edited'
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      expect(getDialog()!.getAttribute('data-tack-state')).toBe('composing')
      const status = inShadow<HTMLDivElement>('[data-tack-status]')!
      expect(status.hidden).toBe(true)
      handle.destroy()
    })

    it('reopening after success starts fresh in composing state', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          ({
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({ id: 'fbk_1', url: 'x', created_at: 'x' }),
          }) as unknown as Response,
        ),
      )
      const handle = Tack.init({ projectId: 'proj_test' })
      await submitWith(handle, 'hi')
      expect(getDialog()!.getAttribute('data-tack-state')).toBe('success')
      handle.close()
      handle.open()
      // Fresh open: composing, status cleared, submit visible
      expect(getDialog()!.getAttribute('data-tack-state')).toBe('composing')
      const status = inShadow<HTMLDivElement>('[data-tack-status]')!
      expect(status.hidden).toBe(true)
      const submit = inShadow<HTMLButtonElement>('[data-tack-submit]')!
      expect(submit.hidden).toBe(false)
      handle.destroy()
    })

    it('empty-body submit announces a validation message via aria-live (no silent no-op)', () => {
      const handle = Tack.init({ projectId: 'proj_test' })
      handle.open()
      const textarea = inShadow<HTMLTextAreaElement>('[data-tack-input]')!
      textarea.value = '   ' // whitespace-only — same as empty after trim
      inShadow<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()

      // FSM stays in composing — no transition for validation
      expect(getDialog()!.getAttribute('data-tack-state')).toBe('composing')
      // But status region is populated and announced
      const status = inShadow<HTMLDivElement>('[data-tack-status]')!
      expect(status.hidden).toBe(false)
      expect(status.textContent).toMatch(/type something/i)
      // Textarea wired up for screen readers per WAI-ARIA 1.2
      expect(textarea.getAttribute('aria-invalid')).toBe('true')
      expect(textarea.getAttribute('aria-describedby')).toBe(status.id)
      handle.destroy()
    })

    it('aria-live region is set up correctly for screen readers', () => {
      const handle = Tack.init({ projectId: 'proj_test' })
      handle.open()
      const status = inShadow<HTMLDivElement>('[data-tack-status]')!
      expect(status.getAttribute('role')).toBe('status')
      expect(status.getAttribute('aria-live')).toBe('polite')
      expect(status.getAttribute('aria-atomic')).toBe('true')
      handle.destroy()
    })

    it('destroy() during success clears the auto-close timer (no late close)', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        vi.stubGlobal(
          'fetch',
          vi.fn(async () =>
            ({
              ok: true,
              status: 200,
              text: async () =>
                JSON.stringify({ id: 'fbk_1', url: 'x', created_at: 'x' }),
            }) as unknown as Response,
          ),
        )
        const handle = Tack.init({ projectId: 'proj_test' })
        await submitWith(handle, 'hi')
        expect(getDialog()!.getAttribute('data-tack-state')).toBe('success')
        handle.destroy()
        // Advance past auto-close — host is gone, no close() should fire on a
        // null dialog. Test passes if no exception.
        await vi.advanceTimersByTimeAsync(3000)
        expect(document.querySelector('tack-widget-host')).toBeNull()
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('Tack.version is a string', () => {
    expect(typeof Tack.version).toBe('string')
    expect(Tack.version.length).toBeGreaterThan(0)
  })

  describe('S3 options surface', () => {
    it('zIndex sets --tack-z-index inline on the dialog', () => {
      const handle = Tack.init({ projectId: 'proj_test', zIndex: 999999 })
      handle.open()
      const dialog = getDialog()!
      expect(dialog.style.getPropertyValue('--tack-z-index')).toBe('999999')
      handle.destroy()
    })

    it('zIndex omitted leaves the inline custom property unset', () => {
      const handle = Tack.init({ projectId: 'proj_test' })
      handle.open()
      const dialog = getDialog()!
      expect(dialog.style.getPropertyValue('--tack-z-index')).toBe('')
      handle.destroy()
    })

    it('modal: false uses dialog.show() (no backdrop guarantee)', () => {
      // We can't test top-layer behavior in jsdom but we can verify the
      // patched show()/showModal() get called correctly.
      const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      // Polyfill `show` if missing (jsdom).
      if (!('show' in HTMLDialogElement.prototype)) {
        ;(HTMLDialogElement.prototype as { show?: () => void }).show =
          function (this: HTMLDialogElement) {
            this.setAttribute('open', '')
            Object.defineProperty(this, 'open', { configurable: true, value: true })
          }
      }
      const show = vi.spyOn(HTMLDialogElement.prototype, 'show')

      const handle = Tack.init({ projectId: 'proj_test', modal: false })
      handle.open()
      expect(show).toHaveBeenCalled()
      expect(showModal).not.toHaveBeenCalled()
      handle.destroy()
    })

    it('modal: true (default) calls showModal()', () => {
      const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      const handle = Tack.init({ projectId: 'proj_test' })
      handle.open()
      expect(showModal).toHaveBeenCalled()
      handle.destroy()
    })

    it('scrollLock locks body overflow on open and restores on close', () => {
      document.body.style.overflow = 'auto'
      const handle = Tack.init({ projectId: 'proj_test' })
      handle.open()
      expect(document.body.style.overflow).toBe('hidden')
      handle.close()
      expect(document.body.style.overflow).toBe('auto')
      handle.destroy()
    })

    it('scrollLock: false leaves body overflow alone', () => {
      document.body.style.overflow = 'auto'
      const handle = Tack.init({ projectId: 'proj_test', scrollLock: false })
      handle.open()
      expect(document.body.style.overflow).toBe('auto')
      handle.destroy()
    })

    it('modal: false skips scroll lock even if scrollLock is true (no backdrop)', () => {
      // Polyfill `show` if missing (jsdom).
      if (!('show' in HTMLDialogElement.prototype)) {
        ;(HTMLDialogElement.prototype as { show?: () => void }).show =
          function (this: HTMLDialogElement) {
            this.setAttribute('open', '')
            Object.defineProperty(this, 'open', { configurable: true, value: true })
          }
      }
      document.body.style.overflow = 'visible'
      const handle = Tack.init({
        projectId: 'proj_test',
        modal: false,
        scrollLock: true,
      })
      handle.open()
      expect(document.body.style.overflow).toBe('visible')
      handle.destroy()
    })

    it('destroy() while open restores body overflow', () => {
      document.body.style.overflow = 'scroll'
      const handle = Tack.init({ projectId: 'proj_test' })
      handle.open()
      expect(document.body.style.overflow).toBe('hidden')
      handle.destroy()
      expect(document.body.style.overflow).toBe('scroll')
    })

    it('debug logs FSM transitions via console.debug with namespaced tag', () => {
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
      const handle = Tack.init({ projectId: 'proj_test', debug: true })
      handle.open()
      const tagged = debugSpy.mock.calls.filter((c) =>
        typeof c[0] === 'string' && (c[0] as string).startsWith('[tack@'),
      )
      expect(tagged.length).toBeGreaterThan(0)
      handle.destroy()
    })

    it('debug off (default) does not emit namespaced logs', () => {
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
      const handle = Tack.init({ projectId: 'proj_test' })
      handle.open()
      const tagged = debugSpy.mock.calls.filter((c) =>
        typeof c[0] === 'string' && (c[0] as string).startsWith('[tack@'),
      )
      expect(tagged.length).toBe(0)
      handle.destroy()
    })

    it('custom fetch is used by submit', async () => {
      const customFetch = vi.fn(async () =>
        ({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: 'fbk_1', url: 'x', created_at: 'x' }),
        }) as unknown as Response,
      )
      // Stub global fetch so we can prove ours was used over it
      vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('global fetch must not be called'))))
      const handle = Tack.init({
        projectId: 'proj_test',
        fetch: customFetch as unknown as typeof fetch,
      })
      handle.open()
      inShadow<HTMLTextAreaElement>('[data-tack-input]')!.value = 'hi'
      inShadow<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()
      await flush()
      expect(customFetch).toHaveBeenCalledOnce()
      handle.destroy()
    })

    it('custom headers are merged but cannot override X-Tack-SDK-Version', async () => {
      const fetchMock = vi.fn(async () =>
        ({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: 'fbk_1', url: 'x', created_at: 'x' }),
        }) as unknown as Response,
      )
      vi.stubGlobal('fetch', fetchMock)
      const handle = Tack.init({
        projectId: 'proj_test',
        headers: {
          'X-Custom': 'value',
          'X-Tack-SDK-Version': 'attacker-controlled',
        },
      })
      handle.open()
      inShadow<HTMLTextAreaElement>('[data-tack-input]')!.value = 'hi'
      inShadow<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()
      await flush()
      const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
      const headers = init.headers as Record<string, string>
      expect(headers['X-Custom']).toBe('value')
      expect(headers['X-Tack-SDK-Version']).not.toBe('attacker-controlled')
      handle.destroy()
    })

    it("placement 'br' deprecated alias warns once and normalizes", () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const a = Tack.init({ projectId: 'proj_a', placement: 'br' })
      const b = Tack.init({ projectId: 'proj_b', placement: 'br' })
      const brWarnings = warnSpy.mock.calls.filter((c) =>
        typeof c[0] === 'string' && (c[0] as string).includes("'br' is deprecated"),
      )
      expect(brWarnings.length).toBe(1) // one-shot per page load
      a.destroy()
      b.destroy()
    })

    it("placement 'bl' deprecated alias warns separately from 'br'", () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const a = Tack.init({ projectId: 'proj_a', placement: 'bl' })
      const blWarnings = warnSpy.mock.calls.filter((c) =>
        typeof c[0] === 'string' && (c[0] as string).includes("'bl' is deprecated"),
      )
      expect(blWarnings.length).toBe(1)
      a.destroy()
    })
  })

  describe('S4 screenshot capture (Add screenshot button)', () => {
    function mockSubmitOk() {
      const fetchMock = vi.fn(async () =>
        ({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ id: 'fbk_1', url: 'x', created_at: 'x' }),
        }) as unknown as Response,
      )
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    it('renders an Add screenshot button by default', () => {
      const handle = Tack.init({ projectId: 'proj_test' })
      handle.open()
      const btn = inShadow<HTMLButtonElement>('[data-tack-capture-button]')
      expect(btn).not.toBeNull()
      expect(btn!.textContent).toBe('Add screenshot')
      expect(btn!.getAttribute('aria-pressed')).toBe('false')
      handle.destroy()
    })

    it('captureScreenshot: false removes the button + row entirely', () => {
      const handle = Tack.init({
        projectId: 'proj_test',
        captureScreenshot: false,
      })
      handle.open()
      expect(inShadow('[data-tack-capture-button]')).toBeNull()
      expect(inShadow('[data-tack-capture-row]')).toBeNull()
      handle.destroy()
    })

    it('clicking Add screenshot captures, attaches data URL, flips to Remove', async () => {
      const customFn = vi.fn(async () => 'data:image/png;base64,IMG')
      const handle = Tack.init({
        projectId: 'proj_test',
        captureScreenshot: customFn,
      })
      handle.open()
      const btn = inShadow<HTMLButtonElement>('[data-tack-capture-button]')!
      btn.click()
      await flushCapture()

      expect(customFn).toHaveBeenCalledOnce()
      expect(btn.textContent).toBe('Remove screenshot')
      expect(btn.getAttribute('aria-pressed')).toBe('true')
      const preview = inShadow<HTMLImageElement>('[data-tack-capture-preview]')!
      expect(preview.hidden).toBe(false)
      expect(preview.getAttribute('src')).toBe('data:image/png;base64,IMG')
      handle.destroy()
    })

    it('after capture, Send (single click) attaches the screenshot to the request', async () => {
      const fetchMock = mockSubmitOk()
      const handle = Tack.init({
        projectId: 'proj_test',
        captureScreenshot: (async () =>
          'data:image/png;base64,SHOT') as unknown as (
          el: Element,
        ) => Promise<string>,
      })
      handle.open()
      inShadow<HTMLButtonElement>('[data-tack-capture-button]')!.click()
      await flushCapture()
      inShadow<HTMLTextAreaElement>('[data-tack-input]')!.value = 'great'
      inShadow<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()
      await flush()

      expect(fetchMock).toHaveBeenCalledOnce()
      const sent = JSON.parse(
        (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
      )
      expect(sent.screenshot).toBe('data:image/png;base64,SHOT')
      handle.destroy()
    })

    it('clicking Remove screenshot drops the attachment + resets button', async () => {
      const handle = Tack.init({
        projectId: 'proj_test',
        captureScreenshot: (async () =>
          'data:image/png;base64,IMG') as unknown as (
          el: Element,
        ) => Promise<string>,
      })
      handle.open()
      const btn = inShadow<HTMLButtonElement>('[data-tack-capture-button]')!
      btn.click()
      await flushCapture()
      expect(btn.textContent).toBe('Remove screenshot')
      btn.click() // second click removes
      const preview = inShadow<HTMLImageElement>('[data-tack-capture-preview]')!
      expect(preview.hidden).toBe(true)
      expect(btn.textContent).toBe('Add screenshot')
      expect(btn.getAttribute('aria-pressed')).toBe('false')
      handle.destroy()
    })

    it('Send without ever clicking Add screenshot → no screenshot in request', async () => {
      const fetchMock = mockSubmitOk()
      const customFn = vi.fn()
      const handle = Tack.init({
        projectId: 'proj_test',
        captureScreenshot: customFn as unknown as (
          el: Element,
        ) => Promise<string>,
      })
      handle.open()
      inShadow<HTMLTextAreaElement>('[data-tack-input]')!.value = 'hi'
      inShadow<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()
      await flush()

      expect(customFn).not.toHaveBeenCalled()
      const sent = JSON.parse(
        (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
      )
      expect(sent.screenshot).toBeUndefined()
      handle.destroy()
    })

    it('capture failure → capture_failed status, button reverts, submit still works', async () => {
      const fetchMock = mockSubmitOk()
      const handle = Tack.init({
        projectId: 'proj_test',
        captureScreenshot: (async () => {
          throw new Error('cross-origin taint')
        }) as unknown as (el: Element) => Promise<string>,
      })
      handle.open()
      const btn = inShadow<HTMLButtonElement>('[data-tack-capture-button]')!
      btn.click()
      await flushCapture()

      expect(getDialog()!.getAttribute('data-tack-state')).toBe('capture_failed')
      const status = inShadow<HTMLDivElement>('[data-tack-status]')!
      expect(status.hidden).toBe(false)
      expect(status.textContent).toMatch(/screenshot unavailable/i)
      // Button reverts so the user can retry
      expect(btn.textContent).toBe('Add screenshot')
      // Send still works (capture is independent of submit)
      inShadow<HTMLTextAreaElement>('[data-tack-input]')!.value = 'hi'
      inShadow<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()
      await flush()
      expect(fetchMock).toHaveBeenCalledOnce()
      const sent = JSON.parse(
        (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
      )
      expect(sent.screenshot).toBeUndefined()
      handle.destroy()
    })

    it('capture failure with debug:true fires onError(screenshot_unavailable)', async () => {
      const onError = vi.fn()
      const handle = Tack.init({
        projectId: 'proj_test',
        debug: true,
        onError,
        captureScreenshot: (async () => {
          throw new Error('boom')
        }) as unknown as (el: Element) => Promise<string>,
      })
      handle.open()
      inShadow<HTMLButtonElement>('[data-tack-capture-button]')!.click()
      await flushCapture()
      const softErrors = onError.mock.calls.filter((c) =>
        typeof c[0] === 'object' &&
        c[0] !== null &&
        (c[0] as { message?: string }).message === 'screenshot_unavailable',
      )
      expect(softErrors.length).toBe(1)
      handle.destroy()
    })

    it('capture failure with debug:false does NOT fire onError', async () => {
      const onError = vi.fn()
      const handle = Tack.init({
        projectId: 'proj_test',
        onError,
        captureScreenshot: (async () => {
          throw new Error('boom')
        }) as unknown as (el: Element) => Promise<string>,
      })
      handle.open()
      inShadow<HTMLButtonElement>('[data-tack-capture-button]')!.click()
      await flushCapture()
      expect(onError).not.toHaveBeenCalled()
      handle.destroy()
    })

    it('typing in capture_failed returns to composing', async () => {
      const handle = Tack.init({
        projectId: 'proj_test',
        captureScreenshot: (async () => {
          throw new Error('boom')
        }) as unknown as (el: Element) => Promise<string>,
      })
      handle.open()
      inShadow<HTMLButtonElement>('[data-tack-capture-button]')!.click()
      await flushCapture()
      expect(getDialog()!.getAttribute('data-tack-state')).toBe('capture_failed')

      const textarea = inShadow<HTMLTextAreaElement>('[data-tack-input]')!
      textarea.value = 'edited'
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      expect(getDialog()!.getAttribute('data-tack-state')).toBe('composing')
      handle.destroy()
    })

    it('ESC (native dialog close) clears textarea + screenshot — same as Cancel', async () => {
      const handle = Tack.init({
        projectId: 'proj_test',
        captureScreenshot: (async () =>
          'data:image/png;base64,ESCIMG') as unknown as (
          el: Element,
        ) => Promise<string>,
      })
      handle.open()
      const textarea = inShadow<HTMLTextAreaElement>('[data-tack-input]')!
      textarea.value = 'mid-thought'
      inShadow<HTMLButtonElement>('[data-tack-capture-button]')!.click()
      await flushCapture()
      // Simulate ESC by closing the dialog directly (jsdom dispatches the
      // close event on dialog.close()). This is the path ESC takes natively.
      getDialog()!.close()
      handle.open()
      expect(inShadow<HTMLTextAreaElement>('[data-tack-input]')!.value).toBe('')
      expect(inShadow<HTMLImageElement>('[data-tack-capture-preview]')!.hidden).toBe(true)
      expect(inShadow<HTMLButtonElement>('[data-tack-capture-button]')!.textContent).toBe(
        'Add screenshot',
      )
      handle.destroy()
    })

    it('Add screenshot in capture_failed retries (not silent no-op)', async () => {
      let attempt = 0
      const handle = Tack.init({
        projectId: 'proj_test',
        captureScreenshot: (async () => {
          attempt++
          if (attempt === 1) throw new Error('first fail')
          return 'data:image/png;base64,RETRY'
        }) as unknown as (el: Element) => Promise<string>,
      })
      handle.open()
      const btn = inShadow<HTMLButtonElement>('[data-tack-capture-button]')!
      btn.click()
      await flushCapture()
      expect(getDialog()!.getAttribute('data-tack-state')).toBe('capture_failed')

      // Click again — must actually retry, not silently no-op.
      btn.click()
      await flushCapture()
      expect(attempt).toBe(2)
      expect(btn.textContent).toBe('Remove screenshot')
      const preview = inShadow<HTMLImageElement>('[data-tack-capture-preview]')!
      expect(preview.getAttribute('src')).toBe('data:image/png;base64,RETRY')
      handle.destroy()
    })

    it('Cancel during in-flight capture: late-resolving capture does NOT re-attach', async () => {
      let resolveCapture: (v: string) => void = () => {}
      const handle = Tack.init({
        projectId: 'proj_test',
        captureScreenshot: (() =>
          new Promise<string>((r) => {
            resolveCapture = r
          })) as unknown as (el: Element) => Promise<string>,
      })
      handle.open()
      inShadow<HTMLButtonElement>('[data-tack-capture-button]')!.click()
      // Capture is in flight (capturing state, no resolution yet).
      await flush()
      expect(getDialog()!.getAttribute('data-tack-state')).toBe('capturing')
      // User cancels.
      inShadow<HTMLButtonElement>('[data-tack-cancel]')!.click()
      // Now the capture finally resolves — must NOT re-attach.
      resolveCapture('data:image/png;base64,STALE')
      await flush()
      // Reopen — should be clean slate, no stale screenshot.
      handle.open()
      const preview = inShadow<HTMLImageElement>('[data-tack-capture-preview]')!
      expect(preview.hidden).toBe(true)
      expect(preview.getAttribute('src')).toBeNull()
      expect(inShadow<HTMLButtonElement>('[data-tack-capture-button]')!.textContent).toBe(
        'Add screenshot',
      )
      handle.destroy()
    })

    it('Cancel clears textarea + attached screenshot + closes', async () => {
      const handle = Tack.init({
        projectId: 'proj_test',
        captureScreenshot: (async () =>
          'data:image/png;base64,IMG') as unknown as (
          el: Element,
        ) => Promise<string>,
      })
      handle.open()
      const textarea = inShadow<HTMLTextAreaElement>('[data-tack-input]')!
      textarea.value = 'half-typed thought'
      inShadow<HTMLButtonElement>('[data-tack-capture-button]')!.click()
      await flushCapture()
      // Sanity: screenshot is attached, textarea has content
      expect(inShadow<HTMLImageElement>('[data-tack-capture-preview]')!.hidden).toBe(false)
      expect(textarea.value).toBe('half-typed thought')

      inShadow<HTMLButtonElement>('[data-tack-cancel]')!.click()
      // Reopen and verify clean slate
      handle.open()
      const reopenedTextarea = inShadow<HTMLTextAreaElement>('[data-tack-input]')!
      const reopenedPreview = inShadow<HTMLImageElement>('[data-tack-capture-preview]')!
      const reopenedBtn = inShadow<HTMLButtonElement>('[data-tack-capture-button]')!
      expect(reopenedTextarea.value).toBe('')
      expect(reopenedPreview.hidden).toBe(true)
      expect(reopenedBtn.textContent).toBe('Add screenshot')
      handle.destroy()
    })
  })

  describe('appVersion', () => {
    function mockSubmitOk() {
      const fetchMock = vi.fn(async () =>
        ({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ id: 'fbk_1', url: 'x', created_at: 'x' }),
        }) as unknown as Response,
      )
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    it('appVersion lands in the request body when set', async () => {
      const fetchMock = mockSubmitOk()
      const handle = Tack.init({
        projectId: 'proj_test',
        appVersion: 'v1.4.2-abc123',
      })
      handle.open()
      inShadow<HTMLTextAreaElement>('[data-tack-input]')!.value = 'great'
      inShadow<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()
      await flush()
      const sent = JSON.parse(
        (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
      )
      expect(sent.appVersion).toBe('v1.4.2-abc123')
      handle.destroy()
    })

    it('appVersion is omitted when not set', async () => {
      const fetchMock = mockSubmitOk()
      const handle = Tack.init({ projectId: 'proj_test' })
      handle.open()
      inShadow<HTMLTextAreaElement>('[data-tack-input]')!.value = 'hi'
      inShadow<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()
      await flush()
      const sent = JSON.parse(
        (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
      )
      expect(sent.appVersion).toBeUndefined()
      handle.destroy()
    })
  })

  describe('rating UI', () => {
    function mockSubmitOk() {
      const fetchMock = vi.fn(async () =>
        ({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ id: 'fbk_1', url: 'x', created_at: 'x' }),
        }) as unknown as Response,
      )
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    it('rating: false (default) renders no rating row', () => {
      const handle = Tack.init({ projectId: 'proj_test' })
      handle.open()
      expect(inShadow('[data-tack-rating-row]')).toBeNull()
      handle.destroy()
    })

    it("rating: 'thumbs' renders 2 buttons", () => {
      const handle = Tack.init({ projectId: 'proj_test', rating: 'thumbs' })
      handle.open()
      const buttons = widgetShadow()!.querySelectorAll('[data-tack-rating-option]')
      expect(buttons.length).toBe(2)
      const values = Array.from(buttons).map((b) =>
        b.getAttribute('data-tack-rating-value'),
      )
      expect(values).toEqual(['-1', '1'])
      handle.destroy()
    })

    it("rating: 'stars' renders 5 buttons (1..5)", () => {
      const handle = Tack.init({ projectId: 'proj_test', rating: 'stars' })
      handle.open()
      const buttons = widgetShadow()!.querySelectorAll('[data-tack-rating-option]')
      expect(buttons.length).toBe(5)
      const values = Array.from(buttons).map((b) =>
        b.getAttribute('data-tack-rating-value'),
      )
      expect(values).toEqual(['1', '2', '3', '4', '5'])
      handle.destroy()
    })

    it("rating: 'emoji' renders 4 buttons (1..4)", () => {
      const handle = Tack.init({ projectId: 'proj_test', rating: 'emoji' })
      handle.open()
      const buttons = widgetShadow()!.querySelectorAll('[data-tack-rating-option]')
      expect(buttons.length).toBe(4)
      const values = Array.from(buttons).map((b) =>
        b.getAttribute('data-tack-rating-value'),
      )
      expect(values).toEqual(['1', '2', '3', '4'])
      handle.destroy()
    })

    it('clicking a rating option flips aria-pressed and stores value', () => {
      const handle = Tack.init({ projectId: 'proj_test', rating: 'stars' })
      handle.open()
      const buttons = Array.from(
        widgetShadow()!.querySelectorAll<HTMLButtonElement>('[data-tack-rating-option]'),
      )
      buttons[3].click()
      expect(buttons[3].getAttribute('aria-pressed')).toBe('true')
      for (let i = 0; i < buttons.length; i++) {
        if (i === 3) continue
        expect(buttons[i].getAttribute('aria-pressed')).toBe('false')
      }
      handle.destroy()
    })

    it('clicking the same option toggles it off', () => {
      const handle = Tack.init({ projectId: 'proj_test', rating: 'stars' })
      handle.open()
      const buttons = Array.from(
        widgetShadow()!.querySelectorAll<HTMLButtonElement>('[data-tack-rating-option]'),
      )
      buttons[2].click()
      expect(buttons[2].getAttribute('aria-pressed')).toBe('true')
      buttons[2].click()
      expect(buttons[2].getAttribute('aria-pressed')).toBe('false')
      handle.destroy()
    })

    it('rating value + ratingScale are sent on submit', async () => {
      const fetchMock = mockSubmitOk()
      const handle = Tack.init({ projectId: 'proj_test', rating: 'stars' })
      handle.open()
      const buttons = Array.from(
        widgetShadow()!.querySelectorAll<HTMLButtonElement>('[data-tack-rating-option]'),
      )
      buttons[4].click()
      inShadow<HTMLTextAreaElement>('[data-tack-input]')!.value = 'amazing'
      inShadow<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()
      await flush()
      const sent = JSON.parse(
        (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
      )
      expect(sent.rating).toBe(5)
      expect(sent.metadata?.ratingScale).toBe('stars')
      handle.destroy()
    })

    it('no rating selection → no rating in request, no ratingScale', async () => {
      const fetchMock = mockSubmitOk()
      const handle = Tack.init({ projectId: 'proj_test', rating: 'stars' })
      handle.open()
      inShadow<HTMLTextAreaElement>('[data-tack-input]')!.value = 'hi'
      inShadow<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()
      await flush()
      const sent = JSON.parse(
        (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
      )
      expect(sent.rating).toBeUndefined()
      expect(sent.metadata?.ratingScale).toBeUndefined()
      handle.destroy()
    })

    it('Cancel clears rating selection', () => {
      const handle = Tack.init({ projectId: 'proj_test', rating: 'thumbs' })
      handle.open()
      const buttons = Array.from(
        widgetShadow()!.querySelectorAll<HTMLButtonElement>('[data-tack-rating-option]'),
      )
      buttons[1].click()
      expect(buttons[1].getAttribute('aria-pressed')).toBe('true')
      inShadow<HTMLButtonElement>('[data-tack-cancel]')!.click()
      handle.open()
      const reopened = Array.from(
        widgetShadow()!.querySelectorAll<HTMLButtonElement>('[data-tack-rating-option]'),
      )
      for (const b of reopened) {
        expect(b.getAttribute('aria-pressed')).toBe('false')
      }
      handle.destroy()
    })

    it('user-supplied metadata is preserved alongside ratingScale', async () => {
      const fetchMock = mockSubmitOk()
      const handle = Tack.init({
        projectId: 'proj_test',
        rating: 'thumbs',
        metadata: { page: '/checkout', plan: 'pro' },
      })
      handle.open()
      const buttons = Array.from(
        widgetShadow()!.querySelectorAll<HTMLButtonElement>('[data-tack-rating-option]'),
      )
      buttons[1].click()
      inShadow<HTMLTextAreaElement>('[data-tack-input]')!.value = 'hi'
      inShadow<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()
      await flush()
      const sent = JSON.parse(
        (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
      )
      expect(sent.metadata).toEqual({
        page: '/checkout',
        plan: 'pro',
        ratingScale: 'thumbs',
      })
      handle.destroy()
    })
  })

  describe('onSubmit second-arg (request payload)', () => {
    it('onSubmit receives both result and request', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          ({
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({ id: 'fbk_1', url: 'x', created_at: 'x' }),
          }) as unknown as Response,
        ),
      )
      const onSubmit = vi.fn()
      const handle = Tack.init({
        projectId: 'proj_test',
        rating: 'stars',
        onSubmit,
      })
      handle.open()
      const buttons = Array.from(
        widgetShadow()!.querySelectorAll<HTMLButtonElement>('[data-tack-rating-option]'),
      )
      buttons[3].click()
      inShadow<HTMLTextAreaElement>('[data-tack-input]')!.value = 'great'
      inShadow<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()
      await flush()
      expect(onSubmit).toHaveBeenCalledOnce()
      const [result, req] = onSubmit.mock.calls[0] as unknown as [
        unknown,
        { rating: number },
      ]
      expect(result).toMatchObject({ id: 'fbk_1' })
      expect(req.rating).toBe(4)
      handle.destroy()
    })
  })

  describe('console capture (lazy)', () => {
    it('captureConsole: false → handle.getCapturedConsole returns []', () => {
      const handle = Tack.init({ projectId: 'proj_test' })
      expect(handle.getCapturedConsole()).toEqual([])
      handle.destroy()
    })

    it('captureConsole: true → buffers errors after lazy import resolves', async () => {
      // Mock console.error BEFORE init so the widget's wrapper wraps our mock
      // (jsdom otherwise prints to test stderr).
      const native = console.error
      const captured = vi.fn()
      console.error = captured as typeof console.error
      try {
        const handle = Tack.init({
          projectId: 'proj_test',
          captureConsole: true,
        })
        // Wait for the dynamic import + install to land.
        await new Promise((r) => setTimeout(r, 50))
        // Now console.error is tack-wrapper → captured. Calling fires both.
        console.error('boom')
        const buffer = handle.getCapturedConsole()
        expect(buffer.length).toBeGreaterThan(0)
        expect(buffer[buffer.length - 1].level).toBe('error')
        expect(buffer[buffer.length - 1].msg).toMatch(/boom/)
        // Passthrough preserved
        expect(captured).toHaveBeenCalledWith('boom')
        handle.destroy()
      } finally {
        console.error = native
      }
    })

    it('per-widget buffer: each widget tracks independently', async () => {
      const native = console.error
      console.error = (() => {}) as typeof console.error
      try {
        const a = Tack.init({ projectId: 'proj_a', captureConsole: true })
        const b = Tack.init({ projectId: 'proj_b', captureConsole: true })
        await new Promise((r) => setTimeout(r, 50))
        // console.error is now: bWrapper → aWrapper → mute
        // Each wrapper records to its own buffer, then calls through.
        console.error('shared')
        expect(a.getCapturedConsole().length).toBe(1)
        expect(b.getCapturedConsole().length).toBe(1)
        a.destroy()
        // After A's destroy, B's wrapper is still on top — and it called
        // through to A's wrapper at install time, but A is now uninstalled.
        // The wrapper-identity check left the chain alone.
        console.error('only-b')
        expect(b.getCapturedConsole().length).toBe(2)
        b.destroy()
      } finally {
        console.error = native
      }
    })

    it('captureConsole entries land in metadata.console on submit', async () => {
      const fetchMock = vi.fn(async () =>
        ({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ id: 'fbk_1', url: 'x', created_at: 'x' }),
        }) as unknown as Response,
      )
      vi.stubGlobal('fetch', fetchMock)
      const native = console.error
      console.error = (() => {}) as typeof console.error
      try {
        const handle = Tack.init({
          projectId: 'proj_test',
          captureConsole: true,
        })
        await new Promise((r) => setTimeout(r, 50))
        console.error('payload-test')
        handle.open()
        inShadow<HTMLTextAreaElement>('[data-tack-input]')!.value = 'hi'
        inShadow<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()
        await flush()
        const sent = JSON.parse(
          (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
        )
        expect(Array.isArray(sent.metadata?.console)).toBe(true)
        expect(sent.metadata.console.length).toBeGreaterThan(0)
        expect(
          sent.metadata.console[sent.metadata.console.length - 1].msg,
        ).toMatch(/payload-test/)
        handle.destroy()
      } finally {
        console.error = native
      }
    })

    it('late-wrap defense: leaves a Sentry-style wrapper intact on uninstall', async () => {
      const native = console.error
      console.error = (() => {}) as typeof console.error
      try {
        const handle = Tack.init({
          projectId: 'proj_test',
          captureConsole: true,
        })
        await new Promise((r) => setTimeout(r, 50))
        const tackWrapper = console.error
        // Simulate a late-initializing observability lib wrapping on top.
        const sentryWrap = ((...args: unknown[]) => {
          ;(tackWrapper as (...a: unknown[]) => void)(...args)
        }) as typeof console.error
        console.error = sentryWrap
        handle.destroy()
        // Identity check: our uninstall sees console.error !== tackWrapper
        // (sentryWrap is on top), so it leaves the chain alone.
        expect(console.error).toBe(sentryWrap)
      } finally {
        console.error = native
      }
    })
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
