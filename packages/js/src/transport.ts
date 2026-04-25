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
}

export async function postFeedback(
  opts: PostFeedbackOptions,
): Promise<TackFeedbackCreated> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Idempotency-Key': opts.idempotencyKey ?? cryptoRandomId(),
    'X-Tack-SDK-Version': SDK_VERSION,
  }

  let res: Response
  try {
    res = await fetch(`${opts.endpoint}/api/v1/feedback`, {
      method: 'POST',
      headers,
      body: JSON.stringify(opts.body),
      signal: opts.signal,
    })
  } catch (err) {
    // AbortError surfaces as DOMException; preserve it so callers can
    // distinguish a user-initiated cancel from a real network failure.
    if (err instanceof Error && err.name === 'AbortError') throw err
    throw new TackError(
      {
        type: 'network_error',
        message: err instanceof Error ? err.message : 'Network request failed',
        doc_url: docUrl('network_error'),
      },
      null,
    )
  }

  const text = await res.text()
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
