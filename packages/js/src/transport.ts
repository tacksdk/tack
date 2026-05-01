// Shared HTTP transport + small browser-env helpers. Used by both the
// module-level submit() and the handle-based widget so request building,
// error mapping, and version reporting live in one place.

import { TackError, docUrl, isTackErrorBody } from './errors'
import type { TackFeedbackCreated, TackSubmitRequest } from './types'

export const DEFAULT_ENDPOINT = 'https://tacksdk.com'

// Updated by tsup `define` at build time. Falls back to a sentinel for
// type-check + dev-mode imports straight from src/.
declare const __TACK_VERSION__: string | undefined
export const SDK_VERSION: string =
  typeof __TACK_VERSION__ === 'string' ? __TACK_VERSION__ : '0.0.0-dev'

export interface PostFeedbackOptions {
  endpoint: string
  body: TackSubmitRequest
  idempotencyKey?: string
  signal?: AbortSignal
  /**
   * Request timeout in ms. Defaults to REQUEST_TIMEOUT_MS. Exposed for tests
   * that want to assert timeout behavior without waiting 30 seconds.
   */
  timeoutMs?: number
  /**
   * Custom fetch implementation. Defaults to `globalThis.fetch`. Use for
   * corporate proxies, tracing libraries, or test fakes that need to wrap
   * the network call.
   */
  fetch?: typeof fetch
  /**
   * Extra request headers, merged after the SDK's defaults. Cannot override
   * `X-Tack-SDK-Version` (rewritten last so the version stamp is reliable
   * for server-side analytics and bug reports).
   */
  headers?: Record<string, string>
}

/**
 * Hard upper bound on a single submit. Without this, a stalled network
 * leaves the caller (widget or headless) hanging until the OS-level fetch
 * timeout (~2-5min) eventually fires. We surface as `network_error` so
 * callers can branch on `TackError.type` and offer a retry.
 */
export const REQUEST_TIMEOUT_MS = 30_000

export async function postFeedback(
  opts: PostFeedbackOptions,
): Promise<TackFeedbackCreated> {
  // User headers come first so SDK defaults (Content-Type, Idempotency-Key,
  // X-Tack-SDK-Version) overwrite any user attempt to set them — the version
  // stamp must be honest for server-side analytics.
  const headers: Record<string, string> = {
    ...(opts.headers ?? {}),
    'Content-Type': 'application/json',
    'Idempotency-Key': opts.idempotencyKey ?? cryptoRandomId(),
    'X-Tack-SDK-Version': SDK_VERSION,
  }
  const doFetch = opts.fetch ?? globalThis.fetch

  // Compose the caller's signal with a timeout. Manual coordination instead
  // of `AbortSignal.any` so we don't depend on a 2024-baseline API. Tracks
  // `timedOut` separately because a fired AbortSignal surfaces to fetch as
  // a single "AbortError" regardless of cause — but the catch checks the
  // user signal FIRST so a user cancel always wins, even in a race where
  // the timer happens to also fire in the same tick.
  const controller = new AbortController()
  let timedOut = false
  const onUserAbort = () => controller.abort()
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort()
    else opts.signal.addEventListener('abort', onUserAbort, { once: true })
  }
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS
  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  // The timeout MUST cover the body read, not just `fetch()` resolution.
  // `fetch` resolves once headers arrive; an upstream that sends 200 OK and
  // then stalls the body would otherwise hang the caller forever. So we
  // wrap fetch + res.text() in a single try/finally.
  let res: Response
  let text: string
  try {
    // projectId goes on the URL as well as in the body. The server's CORS
    // preflight (OPTIONS) has no body to read, so it looks up the project
    // from the query string to find the right originAllowlist. Without this,
    // every cross-origin call fails preflight with "no ACAO header" even
    // when the origin IS allowlisted.
    const url = `${opts.endpoint}/api/v1/feedback?projectId=${encodeURIComponent(opts.body.projectId)}`
    res = await doFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(opts.body),
      signal: controller.signal,
    })
    text = await res.text()
  } catch (err) {
    // User-initiated abort takes precedence over timeout. Even if the timer
    // races and flips `timedOut` true between the user calling abort() and
    // the rejected fetch reaching this catch, an aborted user signal means
    // the caller cancelled, so re-throw AbortError (not network_error).
    if (
      opts.signal?.aborted &&
      err instanceof Error &&
      err.name === 'AbortError'
    ) {
      throw err
    }
    if (timedOut) {
      throw new TackError(
        {
          type: 'network_error',
          message: `Request timed out after ${timeoutMs}ms`,
          doc_url: docUrl('network_error'),
        },
        null,
      )
    }
    // Defense in depth: any other AbortError (controller aborted by code we
    // didn't write — shouldn't happen) bubbles up unchanged.
    if (err instanceof Error && err.name === 'AbortError') throw err
    throw new TackError(
      {
        type: 'network_error',
        message: err instanceof Error ? err.message : 'Network request failed',
        doc_url: docUrl('network_error'),
      },
      null,
    )
  } finally {
    clearTimeout(timeoutId)
    if (opts.signal) opts.signal.removeEventListener('abort', onUserAbort)
  }

  const json = text ? safeJson(text) : null

  if (!res.ok) {
    if (isTackErrorBody(json)) throw new TackError(json.error, res.status)
    throw new TackError(
      {
        type: 'internal_error',
        message: `Unexpected ${res.status} response`,
        doc_url: docUrl('internal_error'),
      },
      res.status,
    )
  }

  if (!json || typeof json !== 'object' || typeof (json as TackFeedbackCreated).id !== 'string') {
    throw new TackError(
      {
        type: 'internal_error',
        message: 'Malformed success response',
        doc_url: docUrl('internal_error'),
      },
      res.status,
    )
  }

  return json as TackFeedbackCreated
}

export function browserDefaults(): Pick<TackSubmitRequest, 'url' | 'userAgent' | 'viewport'> {
  return {
    url: typeof window !== 'undefined' ? window.location.href : undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    viewport:
      typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : undefined,
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// Idempotency keys are server-trusted-by-presence-only — not security-
// critical — so the Math.random fallback is acceptable when crypto.randomUUID
// is unavailable (older Safari, Node < 19 without polyfill).
export function cryptoRandomId(): string {
  const g =
    typeof globalThis !== 'undefined' && 'crypto' in globalThis
      ? (globalThis as { crypto?: Crypto }).crypto
      : undefined
  if (g && typeof g.randomUUID === 'function') return g.randomUUID()
  return `idm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}
