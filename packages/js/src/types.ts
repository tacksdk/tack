// Public API contract — frozen across the @tacksdk SDK and the tack-app backend.
// Do NOT change field names without bumping the package major and the API URL
// version (/v1 -> /v2).

export interface TackUser {
  id?: string
  email?: string
  name?: string
}

export interface TackWidgetProps {
  projectId: string
  endpoint?: string
  user?: TackUser
  metadata?: Record<string, unknown>
  theme?: 'auto' | 'dark' | 'light'
  placement?: 'br' | 'bl'
  onSubmit?: (result: TackFeedbackCreated) => void
  onError?: (err: TackErrorBody['error']) => void
}

export interface TackFeedbackCreated {
  id: string
  url: string
  created_at: string
}

export type TackErrorType =
  | 'invalid_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'payload_too_large'
  | 'rate_limited'
  | 'internal_error'
  | 'network_error'

export interface TackErrorBody {
  error: {
    type: TackErrorType
    message: string
    doc_url: string
  }
}

export interface TackSubmitRequest {
  projectId: string
  rating?: number
  body: string
  url?: string
  appVersion?: string
  userAgent?: string
  viewport?: string
  user?: TackUser
  metadata?: Record<string, unknown>
  screenshot?: string
}
