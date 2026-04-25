import type { TackErrorBody, TackErrorType } from './types'

export class TackError extends Error {
  readonly type: TackErrorType
  readonly docUrl: string
  readonly status: number | null

  constructor(body: TackErrorBody['error'], status: number | null = null) {
    super(body.message)
    this.name = 'TackError'
    this.type = body.type
    this.docUrl = body.doc_url
    this.status = status
  }
}

/**
 * Canonical doc URL for a given error type. Single source of truth so a
 * domain rename only edits one place.
 */
export function docUrl(type: TackErrorType): string {
  return `https://tacksdk.com/docs/errors#${type}`
}

export function isTackErrorBody(v: unknown): v is TackErrorBody {
  if (!v || typeof v !== 'object') return false
  const err = (v as { error?: unknown }).error
  if (!err || typeof err !== 'object') return false
  const e = err as Record<string, unknown>
  return typeof e.type === 'string' && typeof e.message === 'string' && typeof e.doc_url === 'string'
}
