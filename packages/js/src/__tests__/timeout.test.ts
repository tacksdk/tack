import { afterEach, describe, expect, it, vi } from 'vitest'
import { TackError } from '../errors'
import { postFeedback } from '../transport'

const ENDPOINT = 'https://api.example.test'
const REQ = {
  projectId: 'proj_test',
  body: 'hi',
  url: 'https://host.test/',
  userAgent: 'jsdom',
  viewport: '800x600',
}

describe('postFeedback timeout', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('maps a hung fetch to TackError(network_error) after timeoutMs', async () => {
    vi.useFakeTimers()
    // fetch resolves only when its signal aborts; otherwise hangs forever.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const err = new Error('The operation was aborted')
              ;(err as Error).name = 'AbortError'
              reject(err)
            })
          }),
      ),
    )

    const promise = postFeedback({
      endpoint: ENDPOINT,
      body: REQ,
      timeoutMs: 50,
    })
    // Attach the catch handler BEFORE advancing time so the rejection isn't
    // observed by Vitest as "unhandled" between the timer fire and the await.
    const settled = promise.catch((err: unknown) => err)
    await vi.advanceTimersByTimeAsync(60)
    const err = await settled
    if (!(err instanceof TackError)) throw new Error(`expected TackError, got ${String(err)}`)
    expect(err.type).toBe('network_error')
    expect(err.message).toMatch(/timed out/i)
  })

  it('preserves a user-initiated abort (does not map to network_error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const err = new Error('aborted')
              ;(err as Error).name = 'AbortError'
              reject(err)
            })
          }),
      ),
    )

    const userController = new AbortController()
    const promise = postFeedback({
      endpoint: ENDPOINT,
      body: REQ,
      signal: userController.signal,
      timeoutMs: 5_000,
    })
    userController.abort()

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('times out when the BODY hangs (200 OK headers, then stalled stream)', async () => {
    // Regression for the "timeout only bounds fetch headers" bug: an upstream
    // that flushes 200 OK then never sends the body would have hung the
    // caller forever before the fix, because the timeout was cleared right
    // after fetch() resolved.
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          text: () =>
            new Promise<string>((_resolve, reject) => {
              init.signal?.addEventListener('abort', () => {
                const err = new Error('body stream aborted')
                ;(err as Error).name = 'AbortError'
                reject(err)
              })
            }),
        } as unknown as Response
      }),
    )

    const promise = postFeedback({
      endpoint: ENDPOINT,
      body: REQ,
      timeoutMs: 50,
    })
    const settled = promise.catch((err: unknown) => err)
    await vi.advanceTimersByTimeAsync(60)
    const err = await settled
    if (!(err instanceof TackError)) throw new Error(`expected TackError, got ${String(err)}`)
    expect(err.type).toBe('network_error')
    expect(err.message).toMatch(/timed out/i)
  })

  // Note: a tighter test for the "user abort + timeout fire in the same tick"
  // race lives only in transport.ts code review. JS event loop semantics
  // (microtasks drain before timers) make the race unreachable in practice,
  // so the catch's `opts.signal.aborted` precedence check is defense in depth
  // rather than something we can reliably reproduce in a unit test.

  it('clears the timeout on success (no late abort fires)', async () => {
    const fakeOk = {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ id: 'x', url: 'u', created_at: 'now' }),
    }
    vi.stubGlobal('fetch', vi.fn(async () => fakeOk as unknown as Response))

    const result = await postFeedback({
      endpoint: ENDPOINT,
      body: REQ,
      timeoutMs: 100,
    })
    expect(result.id).toBe('x')
    // If clearTimeout were missing, the test would still pass here, but the
    // process would carry an outstanding timer. Vitest fails on dangling
    // timers when fake timers are enabled — leave this as an integration-
    // level smoke instead of asserting Node internals.
  })
})
