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
  /**
   * Color scheme. "auto" (default) follows `prefers-color-scheme`. "light"
   * and "dark" force the corresponding palette regardless of the OS setting.
   *
   * Only meaningful when the default stylesheet is injected (i.e. when
   * `injectStyles !== false`). When you provide your own CSS, theme has no
   * effect on appearance — it just sets the `data-tack-theme` attribute on
   * the dialog so your selectors can branch.
   */
  theme?: 'auto' | 'light' | 'dark'
  /**
   * Skip injecting the default stylesheet. Use when the host wants to fully
   * own the look — target `[data-tack-widget]`, `[data-tack-input]`,
   * `[data-tack-submit]`, `[data-tack-cancel]`, `[data-tack-title]`,
   * `[data-tack-actions]` from your own CSS.
   *
   * The default sheet sets `--tack-z-index: 2147483600` so the dialog wins
   * against most third-party widgets (Intercom, Crisp, etc.). Override by
   * setting that custom property in your own CSS.
   */
  injectStyles?: boolean
  /** Title shown at the top of the dialog. Default: "Send feedback". */
  title?: string
  /** Submit button label. Default: "Send". */
  submitLabel?: string
  /** Cancel button label. Default: "Cancel". */
  cancelLabel?: string
  /** Textarea placeholder. Default: "What can we improve?". */
  placeholder?: string
  /** Called on successful submit, after the dialog closes. */
  onSubmit?: (result: TackFeedbackCreated) => void
  /** Called on submit failure. The dialog stays open. */
  onError?: (err: TackError) => void
  /** Called whenever the dialog opens (open() invocation that actually shows). */
  onOpen?: () => void
  /** Called whenever the dialog closes (cancel, ESC, programmatic close, post-submit). */
  onClose?: () => void
}

export interface TackHandle {
  /** Open the feedback dialog. Idempotent. No-op after destroy(). */
  open: () => void
  /** Close the dialog. Aborts any in-flight submit. Idempotent. */
  close: () => void
  /** Remove the dialog, abort in-flight submit, drop refs. Idempotent. */
  destroy: () => void
  /**
   * Update mutable config fields without re-mounting the dialog. Use for
   * data that may legitimately change on re-renders (current user, page
   * metadata, latest callback identity). Does NOT support changing
   * `projectId`, `endpoint`, `theme`, `injectStyles`, `container`, or copy
   * (`title`, `submitLabel`, etc.) — those would require a re-mount;
   * destroy() and init() instead.
   */
  update: (
    partial: Partial<
      Pick<
        TackWidgetConfig,
        'user' | 'metadata' | 'onSubmit' | 'onError' | 'onOpen' | 'onClose'
      >
    >,
  ) => void
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
    return { open() {}, close() {}, destroy() {}, update() {} }
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

    if (state.config.injectStyles !== false) ensureStylesInjected()

    const container = state.config.container ?? document.body
    const dialog = document.createElement('dialog')
    dialog.setAttribute('data-tack-widget', '')
    // Default theme is "dark" per DESIGN.md. Pass theme="auto" to follow
    // prefers-color-scheme, or "light" to force light.
    const resolvedTheme = state.config.theme ?? 'dark'
    if (resolvedTheme !== 'auto') {
      dialog.setAttribute('data-tack-theme', resolvedTheme)
    }

    // Plain form, NOT method="dialog" — we always preventDefault and run
    // submit asynchronously, so the native dialog-form behaviour is unused.
    const form = document.createElement('form')

    const titleEl = document.createElement('h2')
    titleEl.textContent = state.config.title ?? 'Send feedback'
    titleEl.setAttribute('data-tack-title', '')
    titleEl.id = `tack-title-${nextDialogId()}`
    dialog.setAttribute('aria-labelledby', titleEl.id)

    const textarea = document.createElement('textarea')
    textarea.required = true
    textarea.rows = 4
    textarea.placeholder = state.config.placeholder ?? 'What can we improve?'
    textarea.setAttribute('data-tack-input', '')
    textarea.setAttribute('aria-label', state.config.title ?? 'Send feedback')

    const actions = document.createElement('div')
    actions.setAttribute('data-tack-actions', '')

    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.textContent = state.config.cancelLabel ?? 'Cancel'
    cancelBtn.setAttribute('data-tack-cancel', '')

    const submitBtn = document.createElement('button')
    submitBtn.type = 'submit'
    submitBtn.textContent = state.config.submitLabel ?? 'Send'
    submitBtn.setAttribute('data-tack-submit', '')

    actions.append(cancelBtn, submitBtn)
    form.append(titleEl, textarea, actions)
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
    dialog.addEventListener('close', () => {
      if (!state.destroyed) state.config.onClose?.()
    })
    // Backdrop click closes the dialog. The native <dialog> element treats the
    // backdrop as part of itself — clicks on the backdrop fire with
    // event.target === dialog, while clicks on the form/buttons fire with
    // those nested elements as the target. Mousedown/mouseup tracked separately
    // so a textarea drag-select that ends on the backdrop doesn't dismiss.
    let pressOnBackdrop = false
    dialog.addEventListener('mousedown', (event) => {
      pressOnBackdrop = event.target === dialog
    })
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog && pressOnBackdrop) close()
      pressOnBackdrop = false
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
    if (!dialog.open) {
      dialog.showModal()
      state.config.onOpen?.()
    }
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

  function update(
    partial: Partial<
      Pick<TackWidgetConfig, 'user' | 'metadata' | 'onSubmit' | 'onError' | 'onOpen' | 'onClose'>
    >,
  ): void {
    if (state.destroyed) return
    // Only writes the fields that are actually present so callers can patch
    // selectively; `undefined` here means "intentionally clear" since we
    // checked key presence with `in`.
    if ('user' in partial) state.config.user = partial.user
    if ('metadata' in partial) state.config.metadata = partial.metadata
    if ('onSubmit' in partial) state.config.onSubmit = partial.onSubmit
    if ('onError' in partial) state.config.onError = partial.onError
    if ('onOpen' in partial) state.config.onOpen = partial.onOpen
    if ('onClose' in partial) state.config.onClose = partial.onClose
  }

  return { open, close, destroy, update }
}

// Monotonic counter for unique element ids — collision-free across the
// page lifetime, deterministic for snapshot tests.
let _dialogIdCounter = 0
function nextDialogId(): number {
  _dialogIdCounter += 1
  return _dialogIdCounter
}

/**
 * Inject the default stylesheet into <head> on first widget open. Idempotent
 * via a marker `<style data-tack-styles>` element — multiple widgets share
 * one global block. Call sites can opt out with `injectStyles: false` and
 * provide their own CSS targeting the documented data-* attributes.
 */
function ensureStylesInjected(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-tack-styles]')) return
  const style = document.createElement('style')
  style.setAttribute('data-tack-styles', '')
  style.textContent = TACK_DEFAULT_CSS
  document.head.append(style)
}

const TACK_DEFAULT_CSS = `
[data-tack-widget] {
  --tack-bg: oklch(1 0 0);
  --tack-fg: oklch(0.22 0.01 100);
  --tack-muted: oklch(0.5 0.01 100);
  --tack-border: oklch(0.9 0.005 100);
  --tack-accent: oklch(0.62 0.19 145);
  --tack-accent-fg: oklch(0.99 0 0);
  --tack-radius: 14px;
  --tack-shadow: 0 24px 64px oklch(0 0 0 / 0.18), 0 4px 12px oklch(0 0 0 / 0.08);
  --tack-z-index: 2147483600;
  --tack-font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI",
    Roboto, "Helvetica Neue", Arial, sans-serif;
  border: 1px solid var(--tack-border);
  padding: 0;
  border-radius: var(--tack-radius);
  background: var(--tack-bg);
  color: var(--tack-fg);
  box-shadow: var(--tack-shadow);
  font-family: var(--tack-font-family);
  max-width: min(420px, calc(100vw - 32px));
  width: 100%;
}
[data-tack-widget]::backdrop {
  background: oklch(0 0 0 / 0.4);
  backdrop-filter: blur(4px);
}
[data-tack-widget] form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
}
[data-tack-widget] [data-tack-title] {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.3;
}
[data-tack-widget] [data-tack-input] {
  font: inherit;
  color: inherit;
  background: var(--tack-bg);
  border: 1px solid var(--tack-border);
  border-radius: 6px;
  padding: 10px 12px;
  resize: vertical;
  min-height: 96px;
  width: 100%;
  box-sizing: border-box;
}
[data-tack-widget] [data-tack-input]:focus-visible {
  outline: 2px solid color-mix(in oklch, var(--tack-accent) 35%, transparent);
  outline-offset: 1px;
  border-color: var(--tack-accent);
}
[data-tack-widget] [data-tack-actions] {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
[data-tack-widget] button {
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  border-radius: 6px;
  padding: 8px 14px;
  min-height: 36px;
  border: 1px solid transparent;
  transition: background 150ms ease-out, border-color 150ms ease-out, transform 150ms ease-out;
}
[data-tack-widget] button:focus-visible {
  outline: 3px solid color-mix(in oklch, var(--tack-accent) 35%, transparent);
  outline-offset: 2px;
}
[data-tack-widget] [data-tack-cancel] {
  background: transparent;
  color: var(--tack-muted);
  border-color: var(--tack-border);
}
[data-tack-widget] [data-tack-cancel]:hover {
  background: var(--tack-border);
  color: var(--tack-fg);
}
[data-tack-widget] [data-tack-submit] {
  background: var(--tack-accent);
  color: var(--tack-accent-fg);
}
[data-tack-widget] [data-tack-submit]:hover {
  filter: brightness(1.05);
}
[data-tack-widget] [data-tack-submit]:disabled,
[data-tack-widget] [data-tack-cancel]:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
[data-tack-widget][data-tack-theme="dark"] {
  --tack-bg: oklch(0.2 0.005 100);
  --tack-fg: oklch(0.96 0.005 100);
  --tack-muted: oklch(0.7 0.005 100);
  --tack-border: oklch(0.28 0.005 100);
  --tack-accent: oklch(0.7 0.18 145);
  --tack-accent-fg: oklch(0.16 0.005 100);
  --tack-shadow: 0 24px 64px oklch(0 0 0 / 0.4), 0 4px 12px oklch(0 0 0 / 0.18);
}
@media (prefers-color-scheme: dark) {
  [data-tack-widget]:not([data-tack-theme="light"]) {
    --tack-bg: oklch(0.2 0.005 100);
    --tack-fg: oklch(0.96 0.005 100);
    --tack-muted: oklch(0.7 0.005 100);
    --tack-border: oklch(0.28 0.005 100);
    --tack-accent: oklch(0.7 0.18 145);
    --tack-accent-fg: oklch(0.16 0.005 100);
    --tack-shadow: 0 24px 64px oklch(0 0 0 / 0.4), 0 4px 12px oklch(0 0 0 / 0.18);
  }
}
`

/**
 * Public widget API. Use `Tack.init({ projectId })` to mount a widget; the
 * returned handle controls open/close/destroy.
 *
 * `Tack.version` is the build-time SDK version, also sent as the
 * `X-Tack-SDK-Version` header on every submit.
 */
export const Tack = { init, version: SDK_VERSION }
