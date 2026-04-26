// Headless entry point for `@tacksdk/js/headless`.
//
// Pure-function `submit()` for callers that want to post feedback without
// mounting any DOM. Zero widget cost: this file imports nothing from
// widget.ts or launcher.ts, so bundlers tree-shake those out of the headless
// chunk. Verify with the bundle-size regression test in __tests__/bundle.
//
// Unlike the legacy module-level `init()` + `submit()` in index.ts (slated
// for removal in S8), this surface takes `projectId` inline on every call.
// No init step. No module state. Two consumers on the same page can submit
// to different projects without any coordination.

import { TackError } from './errors'
import {
  DEFAULT_ENDPOINT,
  SDK_VERSION,
  browserDefaults,
  postFeedback,
} from './transport'
import type { TackFeedbackCreated, TackSubmitRequest, TackUser } from './types'

export interface HeadlessSubmitOptions {
  /** Public project id from the Tack dashboard, e.g. "proj_..." */
  projectId: string
  /** Override the API endpoint. Defaults to https://tacksdk.com */
  endpoint?: string
  /** Feedback body text (required, non-empty). */
  body: string
  rating?: number
  /** Base64 data URL screenshot (optional). */
  screenshot?: string
  /** Defaults to `window.location.href` in a browser context. */
  url?: string
  /** Defaults to `navigator.userAgent` in a browser context. */
  userAgent?: string
  /** Defaults to `${innerWidth}x${innerHeight}` in a browser context. */
  viewport?: string
  /** Host app version (any format, e.g. "1.4.2" or a git sha). */
  appVersion?: string
  user?: TackUser
  metadata?: Record<string, unknown>
  /** Custom dedup key. Auto-generated when omitted. */
  idempotencyKey?: string
  /** Caller-controlled abort. The transport composes this with a 30s timeout. */
  signal?: AbortSignal
}

export async function submit(
  opts: HeadlessSubmitOptions,
): Promise<TackFeedbackCreated> {
  if (!opts.projectId || typeof opts.projectId !== 'string') {
    throw new Error('[tack] submit() requires a projectId')
  }
  if (!opts.body || typeof opts.body !== 'string') {
    throw new Error('[tack] submit() requires a non-empty body')
  }

  const defaults = browserDefaults()
  const req: TackSubmitRequest = {
    projectId: opts.projectId,
    body: opts.body,
    rating: opts.rating,
    screenshot: opts.screenshot,
    url: opts.url ?? defaults.url,
    userAgent: opts.userAgent ?? defaults.userAgent,
    viewport: opts.viewport ?? defaults.viewport,
    appVersion: opts.appVersion,
    user: opts.user,
    metadata: opts.metadata,
  }

  return postFeedback({
    endpoint: opts.endpoint ?? DEFAULT_ENDPOINT,
    body: req,
    idempotencyKey: opts.idempotencyKey,
    signal: opts.signal,
  })
}

export { TackError, SDK_VERSION }
export type {
  TackFeedbackCreated,
  TackUser,
  TackSubmitRequest,
} from './types'
export type { TackErrorBody, TackErrorType } from './types'
