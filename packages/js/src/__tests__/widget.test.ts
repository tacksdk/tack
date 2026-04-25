// Real DOM tests for the walking-skeleton widget. Runs under jsdom — see
// vitest.config.ts. Covers handle shape, mount/unmount lifecycle, two
// independent instances, abort-on-cancel, and post-destroy callback
// suppression. Network is mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Tack } from '../widget'

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

  it('open() mounts a <dialog> and showModal()s it', () => {
    const handle = Tack.init({ projectId: 'proj_test' })
    expect(document.querySelector('dialog[data-tack-widget]')).toBeNull()
    handle.open()
    const dialog = document.querySelector<HTMLDialogElement>('dialog[data-tack-widget]')
    expect(dialog).not.toBeNull()
    expect(dialog!.open).toBe(true)
    handle.destroy()
  })

  it('open() is idempotent — second call does not duplicate the dialog', () => {
    const handle = Tack.init({ projectId: 'proj_test' })
    handle.open()
    handle.open()
    expect(document.querySelectorAll('dialog[data-tack-widget]')).toHaveLength(1)
    handle.destroy()
  })

  it('close() closes the dialog without removing it', () => {
    const handle = Tack.init({ projectId: 'proj_test' })
    handle.open()
    handle.close()
    const dialog = document.querySelector<HTMLDialogElement>('dialog[data-tack-widget]')
    expect(dialog).not.toBeNull()
    expect(dialog!.open).toBe(false)
    handle.destroy()
  })

  it('destroy() removes the dialog and is idempotent', () => {
    const handle = Tack.init({ projectId: 'proj_test' })
    handle.open()
    handle.destroy()
    expect(document.querySelector('dialog[data-tack-widget]')).toBeNull()
    expect(() => handle.destroy()).not.toThrow()
    // open() after destroy is a no-op (no remount)
    handle.open()
    expect(document.querySelector('dialog[data-tack-widget]')).toBeNull()
  })

  it('two handles mount independent dialogs', () => {
    const a = Tack.init({ projectId: 'proj_a' })
    const b = Tack.init({ projectId: 'proj_b' })
    a.open()
    b.open()
    expect(document.querySelectorAll('dialog[data-tack-widget]')).toHaveLength(2)
    a.destroy()
    expect(document.querySelectorAll('dialog[data-tack-widget]')).toHaveLength(1)
    b.destroy()
    expect(document.querySelectorAll('dialog[data-tack-widget]')).toHaveLength(0)
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
    const textarea = document.querySelector<HTMLTextAreaElement>('[data-tack-input]')!
    textarea.value = 'great app'
    document.querySelector<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()
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
      document.querySelector<HTMLDialogElement>('dialog[data-tack-widget]')!.open,
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
    document.querySelector<HTMLTextAreaElement>('[data-tack-input]')!.value = 'hi'
    document.querySelector<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()
    await flush()

    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0][0].type).toBe('rate_limited')
    expect(
      document.querySelector<HTMLDialogElement>('dialog[data-tack-widget]')!.open,
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
    document.querySelector<HTMLTextAreaElement>('[data-tack-input]')!.value = 'hi'
    document.querySelector<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()
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
    document.querySelector<HTMLTextAreaElement>('[data-tack-input]')!.value = 'hi'
    document.querySelector<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()
    handle.destroy()
    await new Promise((r) => setTimeout(r, 20))

    expect(onSubmit).not.toHaveBeenCalled()
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
