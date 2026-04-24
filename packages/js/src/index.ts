import { TackError, isTackErrorBody } from './errors'
import type {
  TackFeedbackCreated,
  TackSubmitRequest,
  TackUser,
} from './types'

export * from './types'
export { TackError } from './errors'

export interface TackConfig {
  /** Public project id from the Tack dashboard, e.g. "proj_..." */
  projectId: string
  /** Override the API endpoint. Defaults to https://tacksdk.com */
  endpoint?: string
  /** Default user attached to every submission */
  user?: TackUser
  /** Default metadata attached to every submission */
  metadata?: Record<string, unknown>
  /** Suppress the one-time pre-1.0 stability warning. See STABILITY.md. */
  silent?: boolean
}

const DEFAULT_ENDPOINT = 'https://tacksdk.com'
// Updated by tsup define at build time. Falls back to the source default so
// type-check and dev-mode imports from src/ keep working.
declare const __TACK_VERSION__: string | undefined
const SDK_VERSION = typeof __TACK_VERSION__ === 'string' ? __TACK_VERSION__ : '0.0.0-dev'

let _config: TackConfig | null = null
let _warned = false

export function init(config: TackConfig): void {
  if (!config.projectId || typeof config.projectId !== 'string') {
    throw new Error('[tack] init() requires a projectId')
  }
  // Spread config first, THEN apply the endpoint fallback. If we did the
  // reverse, a caller passing `endpoint: undefined` (common from React
  // wrappers that forward optional props) would overwrite the default with
  // undefined, and submit() would fetch `undefined/v1/feedback`.
  _config = { ...config, endpoint: config.endpoint ?? DEFAULT_ENDPOINT }
  if (!config.silent && !_warned && typeof console !== 'undefined') {
    _warned = true
    // Intentional: "no semver" without this warning is undocumented breakage.
    // Pass silent: true once you've read STABILITY.md and pinned a version.
    console.warn(
      `[tack] Running SDK v${SDK_VERSION} (pre-1.0). Pin the version and read ` +
        'STABILITY.md before upgrading: ' +
        'https://github.com/tacksdk/tack/blob/main/STABILITY.md',
    )
  }
}

export function getConfig(): TackConfig | null {
  return _config
}

export function reset(): void {
  _config = null
  _warned = false
}

export type SubmitInput = Omit<TackSubmitRequest, 'projectId' | 'url' | 'userAgent' | 'viewport'> & {
  url?: string
  userAgent?: string
  viewport?: string
  idempotencyKey?: string
}

export async function submit(input: SubmitInput): Promise<TackFeedbackCreated> {
  if (!_config) {
    throw new Error('[tack] Call init({ projectId }) before submitting feedback.')
  }
  if (!input.body || typeof input.body !== 'string') {
    throw new Error('[tack] submit() requires a non-empty body')
  }

  const req: TackSubmitRequest = {
    projectId: _config.projectId,
    body: input.body,
    rating: input.rating,
    screenshot: input.screenshot,
    url: input.url ?? (typeof window !== 'undefined' ? window.location.href : undefined),
    userAgent:
      input.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : undefined),
    viewport:
      input.viewport ??
      (typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : undefined),
    user: input.user ?? _config.user,
    metadata: input.metadata ?? _config.metadata,
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Idempotency-Key': input.idempotencyKey ?? cryptoRandomId(),
  }

  let res: Response
  try {
    res = await fetch(`${_config.endpoint}/v1/feedback`, {
      method: 'POST',
      headers,
      body: JSON.stringify(req),
    })
  } catch (err) {
    throw new TackError(
      {
        type: 'network_error',
        message: err instanceof Error ? err.message : 'Network request failed',
        doc_url: 'https://tacksdk.com/docs/errors#network_error',
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
        doc_url: 'https://tacksdk.com/docs/errors#internal_error',
      },
      res.status,
    )
  }

  if (!json || typeof json !== 'object' || typeof (json as TackFeedbackCreated).id !== 'string') {
    throw new TackError(
      {
        type: 'internal_error',
        message: 'Malformed success response',
        doc_url: 'https://tacksdk.com/docs/errors#internal_error',
      },
      res.status,
    )
  }

  return json as TackFeedbackCreated
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function cryptoRandomId(): string {
  const g =
    typeof globalThis !== 'undefined' && 'crypto' in globalThis
      ? (globalThis as { crypto?: Crypto }).crypto
      : undefined
  if (g && typeof g.randomUUID === 'function') return g.randomUUID()
  return `idm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}
