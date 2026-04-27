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

/**
 * Named theme preset — a curated bundle of Layer 1 + Layer 2 design tokens.
 *
 * Presets are static objects exported from `tack/packages/js/src/themes/` and
 * registered in `themes/index.ts`. Apply via `Tack.init({ preset: 'midnight' })`.
 *
 * - `name` — kebab-case identifier matching the registry key.
 * - `scheme` — drives `data-tack-scheme` attribute and disables the
 *   `prefers-color-scheme` media-query path. `'auto'` means "respect host
 *   light/dark preference"; `'light'` or `'dark'` force the palette.
 * - `tokens` — record of CSS custom-property values applied as inline styles
 *   on the dialog element. Any token not provided falls through to the
 *   defaults baked into the widget stylesheet.
 *
 * Adding a new preset: see `DESIGN.md` "Adding a new preset" checklist
 * (file under `themes/`, register in `themes/index.ts`, screenshot, contrast
 * audit, set all ~30 Layer 2 tokens).
 */
export interface TackThemePreset {
  name: string
  scheme: 'light' | 'dark' | 'auto'
  tokens: Record<`--tack-${string}`, string>
}
