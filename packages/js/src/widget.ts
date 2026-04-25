// Walking skeleton for the vanilla DOM widget.
//
// Intentionally minimal: native <dialog>, textarea, submit button. No theming,
// no a11y polish beyond what <dialog> gives for free, no screenshot, no state
// machine, no error UI. The point is to prove the architecture (returned
// handle, no module-level singleton, two widgets per page work) so subsequent
// PRs can layer theming / a11y / capture / lifecycle states on top.
//
// See docs/phase-2-extraction.md "Step 2" for the full spec this is the
// foundation of.

import { TackError, isTackErrorBody } from './errors'
import type {
  TackFeedbackCreated,
  TackSubmitRequest,
  TackUser,
} from './types'

const DEFAULT_ENDPOINT = 'https://api.tacksdk.com'

export interface TackWidgetConfig {
  /** Public project id from the Tack dashboard, e.g. "proj_..." */
  projectId: string
  /** Override the API endpoint. Defaults to https://api.tacksdk.com */
  endpoint?: string
  /** Default user attached to every submission */
  user?: TackUser
  /** Default metadata attached to every submission */
  metadata?: Record<string, unknown>
  /** Container to mount the dialog in. Defaults to document.body. */
  container?: HTMLElement
  /** Called on successful submit, after the dialog closes. */
  onSubmit?: (result: TackFeedbackCreated) => void
  /** Called on submit failure. The dialog stays open. */
  onError?: (err: TackError) => void
}

export interface TackHandle {
  /** Open the feedback dialog. Idempotent. */
  open: () => void
  /** Close the dialog without submitting. Idempotent. */
  close: () => void
  /** Remove the dialog from the DOM and detach all listeners. */
  destroy: () => void
}

interface InternalState {
  config: Required<Pick<TackWidgetConfig, 'endpoint'>> & TackWidgetConfig
  dialog: HTMLDialogElement | null
  textarea: HTMLTextAreaElement | null
  submitBtn: HTMLButtonElement | null
  abort: AbortController | null
  destroyed: boolean
}

export function init(config: TackWidgetConfig): TackHandle {
  if (typeof window === 'undefined') {
    throw new Error('[tack] init() requires a browser environment')
  }
  if (!config.projectId || typeof config.projectId !== 'string') {
    throw new Error('[tack] init() requires a projectId')
  }

  const state: InternalState = {
    config: { ...config, endpoint: config.endpoint ?? DEFAULT_ENDPOINT },
    dialog: null,
    textarea: null,
    submitBtn: null,
    abort: null,
    destroyed: false,
  }

  function ensureMounted(): HTMLDialogElement {
    if (state.dialog) return state.dialog

    const container = state.config.container ?? document.body
    const dialog = document.createElement('dialog')
    dialog.setAttribute('data-tack-widget', '')

    const form = document.createElement('form')
    form.method = 'dialog'

    const textarea = document.createElement('textarea')
    textarea.required = true
    textarea.rows = 4
    textarea.placeholder = 'What’s on your mind?'
    textarea.setAttribute('data-tack-input', '')

    const actions = document.createElement('div')
    actions.setAttribute('data-tack-actions', '')

    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.textContent = 'Cancel'
    cancelBtn.setAttribute('data-tack-cancel', '')

    const submitBtn = document.createElement('button')
    submitBtn.type = 'submit'
    submitBtn.textContent = 'Send'
    submitBtn.setAttribute('data-tack-submit', '')

    actions.append(cancelBtn, submitBtn)
    form.append(textarea, actions)
    dialog.append(form)
    container.append(dialog)

    state.dialog = dialog
    state.textarea = textarea
    state.submitBtn = submitBtn

    cancelBtn.addEventListener('click', () => close())
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      void handleSubmit()
    })

    return dialog
  }

  async function handleSubmit(): Promise<void> {
    if (!state.textarea || !state.submitBtn) return
    const body = state.textarea.value.trim()
    if (!body) return

    state.submitBtn.disabled = true
    state.abort = new AbortController()

    try {
      const result = await postFeedback(state.config, { body }, state.abort.signal)
      state.textarea.value = ''
      close()
      state.config.onSubmit?.(result)
    } catch (err) {
      const tackErr =
        err instanceof TackError
          ? err
          : new TackError(
              {
                type: 'internal_error',
                message: err instanceof Error ? err.message : 'Unknown error',
                doc_url: 'https://tacksdk.com/docs/errors#internal_error',
              },
              null,
            )
      state.config.onError?.(tackErr)
    } finally {
      state.submitBtn.disabled = false
      state.abort = null
    }
  }

  function open(): void {
    if (state.destroyed) return
    const dialog = ensureMounted()
    if (!dialog.open) dialog.showModal()
    state.textarea?.focus()
  }

  function close(): void {
    if (state.destroyed) return
    if (state.dialog?.open) state.dialog.close()
  }

  function destroy(): void {
    if (state.destroyed) return
    state.destroyed = true
    state.abort?.abort()
    state.dialog?.remove()
    state.dialog = null
    state.textarea = null
    state.submitBtn = null
  }

  return { open, close, destroy }
}

async function postFeedback(
  config: TackWidgetConfig & { endpoint: string },
  input: { body: string },
  signal: AbortSignal,
): Promise<TackFeedbackCreated> {
  const req: TackSubmitRequest = {
    projectId: config.projectId,
    body: input.body,
    url: typeof window !== 'undefined' ? window.location.href : undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    viewport:
      typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : undefined,
    user: config.user,
    metadata: config.metadata,
  }

  let res: Response
  try {
    res = await fetch(`${config.endpoint}/api/v1/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': cryptoRandomId(),
      },
      body: JSON.stringify(req),
      signal,
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

export const Tack = { init }
