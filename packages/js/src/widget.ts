// Walking skeleton for the vanilla DOM widget.
//
// Intentionally minimal: native <dialog>, textarea, submit button. No theming,
// no a11y polish beyond what <dialog> gives for free, no screenshot, no state
// machine, no error UI inside the dialog. The point is to prove the
// architecture (returned handle, no module-level singleton, two widgets per
// page work, abortable, leak-free destroy) so subsequent PRs can layer
// theming / a11y / capture / lifecycle states on top.
//
// See docs/phase-2-extraction.md "Step 2" for the full spec this is the
// foundation of.

import { TackError, docUrl } from './errors'
import {
  DEFAULT_ENDPOINT,
  SDK_VERSION,
  browserDefaults,
  postFeedback,
} from './transport'
import type { TackFeedbackCreated, TackSubmitRequest, TackUser } from './types'

export interface TackWidgetConfig {
  /** Public project id from the Tack dashboard, e.g. "proj_..." */
  projectId: string
  /** Override the API endpoint. Defaults to https://tacksdk.com */
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
  /** Open the feedback dialog. Idempotent. No-op after destroy(). */
  open: () => void
  /** Close the dialog. Aborts any in-flight submit. Idempotent. */
  close: () => void
  /** Remove the dialog, abort in-flight submit, drop refs. Idempotent. */
  destroy: () => void
}

interface InternalState {
  config: TackWidgetConfig & { endpoint: string }
  dialog: HTMLDialogElement | null
  textarea: HTMLTextAreaElement | null
  submitBtn: HTMLButtonElement | null
  abort: AbortController | null
  destroyed: boolean
}

/**
 * Mount a feedback widget. Returns a handle for open/close/destroy. Each
 * call returns an independent instance — there is no module-level singleton,
 * so two widgets on the same page work.
 *
 * On the server (no `window`), returns a no-op handle so call sites don't
 * need to gate on `typeof window`.
 */
function init(config: TackWidgetConfig): TackHandle {
  if (!config.projectId || typeof config.projectId !== 'string') {
    throw new Error('[tack] Tack.init() requires a projectId')
  }
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { open() {}, close() {}, destroy() {} }
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

    // Plain form, NOT method="dialog" — we always preventDefault and run
    // submit asynchronously, so the native dialog-form behaviour is unused.
    const form = document.createElement('form')

    const textarea = document.createElement('textarea')
    textarea.required = true
    textarea.rows = 4
    textarea.placeholder = 'Send feedback'
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
    if (state.destroyed || !state.textarea || !state.submitBtn) return
    const body = state.textarea.value.trim()
    if (!body) return

    state.submitBtn.disabled = true
    state.abort = new AbortController()
    const abortSignal = state.abort.signal

    const defaults = browserDefaults()
    const req: TackSubmitRequest = {
      projectId: state.config.projectId,
      body,
      url: defaults.url,
      userAgent: defaults.userAgent,
      viewport: defaults.viewport,
      user: state.config.user,
      metadata: state.config.metadata,
    }

    try {
      const result = await postFeedback({
        endpoint: state.config.endpoint,
        body: req,
        signal: abortSignal,
      })
      // Suppress side effects if the widget was destroyed or the request
      // was cancelled while in flight — the user is no longer there to see
      // success UI, and firing onSubmit after destroy is surprising.
      if (state.destroyed || abortSignal.aborted) return
      state.textarea.value = ''
      close()
      state.config.onSubmit?.(result)
    } catch (err) {
      if (state.destroyed || abortSignal.aborted) return
      const tackErr =
        err instanceof TackError
          ? err
          : new TackError(
              {
                type: 'internal_error',
                message: err instanceof Error ? err.message : 'Unknown error',
                doc_url: docUrl('internal_error'),
              },
              null,
            )
      state.config.onError?.(tackErr)
    } finally {
      if (!state.destroyed && state.submitBtn) state.submitBtn.disabled = false
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
    state.abort?.abort()
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

/**
 * Public widget API. Use `Tack.init({ projectId })` to mount a widget; the
 * returned handle controls open/close/destroy.
 *
 * `Tack.version` is the build-time SDK version, also sent as the
 * `X-Tack-SDK-Version` header on every submit.
 */
export const Tack = { init, version: SDK_VERSION }
