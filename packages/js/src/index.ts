import type {
  TackFeedbackCreated,
  TackSubmitRequest,
  TackUser,
} from './types'
import { DEFAULT_ENDPOINT, SDK_VERSION, browserDefaults, postFeedback } from './transport'

export * from './types'
export { TackError, docUrl } from './errors'
export { Tack } from './widget'
export type { TackWidgetConfig, TackHandle } from './widget'
export { SDK_VERSION } from './transport'

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

let _config: TackConfig | null = null
let _warned = false

export function init(config: TackConfig): void {
  if (!config.projectId || typeof config.projectId !== 'string') {
    throw new Error('[tack] init() requires a projectId')
  }
  // Spread first, THEN apply the endpoint fallback. Reversed order means a
  // caller passing `endpoint: undefined` (common from React wrappers that
  // forward optional props) overwrites the default with undefined.
  _config = { ...config, endpoint: config.endpoint ?? DEFAULT_ENDPOINT }
  if (!config.silent && !_warned && typeof console !== 'undefined') {
    _warned = true
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

  const defaults = browserDefaults()
  const req: TackSubmitRequest = {
    projectId: _config.projectId,
    body: input.body,
    rating: input.rating,
    screenshot: input.screenshot,
    url: input.url ?? defaults.url,
    userAgent: input.userAgent ?? defaults.userAgent,
    viewport: input.viewport ?? defaults.viewport,
    user: input.user ?? _config.user,
    metadata: input.metadata ?? _config.metadata,
  }

  return postFeedback({
    endpoint: _config.endpoint!,
    body: req,
    idempotencyKey: input.idempotencyKey,
  })
}
