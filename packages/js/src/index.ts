export interface TackConfig {
  /** Your project API key from the Tack dashboard */
  apiKey: string
  /** Override the API endpoint (defaults to https://api.usetack.dev) */
  apiUrl?: string
}

export interface FeedbackPayload {
  message: string
  /** Optional: identify the submitting user */
  userId?: string
  /** Additional metadata attached to the submission */
  meta?: Record<string, unknown>
}

export interface TackClient {
  submit: (payload: FeedbackPayload) => Promise<void>
}

let _config: TackConfig | null = null

export function init(config: TackConfig): void {
  _config = {
    apiUrl: 'https://api.usetack.dev',
    ...config,
  }
}

export async function submit(payload: FeedbackPayload): Promise<void> {
  if (!_config) {
    throw new Error('[tack] Call tack.init({ apiKey }) before submitting feedback.')
  }

  const res = await fetch(`${_config.apiUrl}/v1/feedback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tack-Key': _config.apiKey,
    },
    body: JSON.stringify({
      ...payload,
      url: typeof window !== 'undefined' ? window.location.href : undefined,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    }),
  })

  if (!res.ok) {
    throw new Error(`[tack] Submission failed: ${res.status} ${res.statusText}`)
  }
}

export function getConfig(): TackConfig | null {
  return _config
}
// test
// e2e hook test
