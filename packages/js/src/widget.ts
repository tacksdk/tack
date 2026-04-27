// Vanilla DOM widget with closed shadow DOM isolation.
//
// Architecture:
//   container ─ <tack-widget-host> ─ #shadow-root (closed)
//                                      ├── <style> or adoptedStyleSheets
//                                      └── <dialog data-tack-widget>
//                                          └── <form> ─ title, textarea, actions
//
// Mounting inside a closed shadow root (per DESIGN.md "Font-Safety Defenses"
// + "Locked Typography") is the chameleon-widget contract: host page CSS like
// `body { font-size: 12px; line-height: 1 }` cannot bleed into the dialog
// because `:host { all: initial }` blocks inheritance, and the shadow tree's
// styles are scoped to the root. Native `<dialog>` + `showModal()` still
// escape to the top layer correctly from inside a shadow root.
//
// `mode: 'closed'` blocks `host.shadowRoot` (returns null) so host JS can't
// monkey-patch the dialog. Test code reaches the root via `__testShadowRoots`
// (a WeakMap exported below); production callers have no path in.
//
// See docs/phase-2-extraction.md "Step 2" for the full spec this is the
// foundation of.

import { TackError, docUrl } from './errors'
import { bindHotkey } from './hotkey'
import { type BuiltinPresetName, resolvePreset } from './themes'
import {
  DEFAULT_ENDPOINT,
  SDK_VERSION,
  browserDefaults,
  postFeedback,
} from './transport'
import type {
  TackFeedbackCreated,
  TackSubmitRequest,
  TackThemePreset,
  TackUser,
} from './types'

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
   * Named theme preset — a curated bundle of all ~30 Layer 2 design tokens
   * (DESIGN.md "Theme Presets"). Built-ins: `'default'` (Tack green, light/
   * dark auto), `'midnight'` (electric violet, forced dark), `'paper'` (warm
   * rust on cream, forced light). Defaults to `'default'`.
   *
   * Preset tokens are applied as inline custom-property values on the dialog
   * element — they override the bundled stylesheet defaults but are
   * themselves overridden by per-token `style={{}}` overrides on the dialog
   * (Layer 3). Pass a `TackThemePreset` object directly to ship a custom
   * preset without registering it.
   *
   * The preset's `scheme` ('light' | 'dark' | 'auto') controls
   * `data-tack-scheme` on the dialog — overrides the legacy `theme` prop
   * when both are present.
   */
  preset?: BuiltinPresetName | TackThemePreset
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
  /**
   * Optional global keyboard shortcut that toggles the dialog. None by
   * default. Combo syntax: `+`-separated tokens, case-insensitive.
   *   modifiers: mod | cmd | meta | ctrl | alt | option | shift
   *   key: single character or named ('escape', 'enter', 'space', 'tab',
   *        'backspace', 'delete', 'up'/'down'/'left'/'right', 'f1'-'f12')
   *   examples: 'mod+alt+f', 'ctrl+shift+/', 'cmd+k'
   *
   * `mod` resolves to ⌘ on mac and ctrl elsewhere. The shortcut is skipped
   * when focus is in an input/textarea/contenteditable. For full control
   * (custom guards, scope, action), import `bindHotkey` and call it
   * directly against the returned handle.
   */
  hotkey?: string
}

export interface TackHandle {
  /** Open the feedback dialog. Idempotent. No-op after destroy(). */
  open: () => void
  /** Close the dialog. Aborts any in-flight submit. Idempotent. */
  close: () => void
  /** Open if closed, close if open. No-op after destroy(). */
  toggle: () => void
  /** True when the dialog is currently open. False after destroy(). */
  isOpen: () => boolean
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
  /** Light-DOM host element holding the closed shadow root. */
  host: HTMLElement | null
  dialog: HTMLDialogElement | null
  textarea: HTMLTextAreaElement | null
  submitBtn: HTMLButtonElement | null
  abort: AbortController | null
  destroyed: boolean
}

/**
 * Closed shadow roots are not reachable via `host.shadowRoot` from the host
 * page. Tests need a way back in to assert DOM state inside the dialog. This
 * WeakMap is the test-only backdoor: keyed by the host element, value is the
 * shadow root. Cleared automatically when the host is garbage-collected.
 *
 * NOT part of the public API. Production code MUST NOT read from this map.
 * Renamed to `__testShadowRoots` so it's grep-visible as a test affordance.
 */
const _testShadowRoots: WeakMap<Element, ShadowRoot> = new WeakMap()
export { _testShadowRoots as __testShadowRoots }

/**
 * Single shared CSSStyleSheet instance used across every widget when
 * `adoptedStyleSheets` is supported. Constructable stylesheets are
 * reference-shared, so this keeps DOM weight constant regardless of how many
 * widget instances mount on the page. Safari 15.4-16.3 falls back to a per-
 * shadow-root `<style>` element (see ensureStylesInShadow).
 */
let _sharedSheet: CSSStyleSheet | null = null

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
    return {
      open() {},
      close() {},
      toggle() {},
      isOpen: () => false,
      destroy() {},
      update() {},
    }
  }

  const state: InternalState = {
    config: { ...config, endpoint: config.endpoint ?? DEFAULT_ENDPOINT },
    host: null,
    dialog: null,
    textarea: null,
    submitBtn: null,
    abort: null,
    destroyed: false,
  }

  function ensureMounted(): HTMLDialogElement {
    if (state.dialog) return state.dialog

    const container = state.config.container ?? document.body
    const { host, shadow } = mountShadowHost(container)
    state.host = host

    if (state.config.injectStyles !== false) ensureStylesInShadow(shadow)

    const dialog = document.createElement('dialog')
    dialog.setAttribute('data-tack-widget', '')

    // Theme presets (DESIGN.md "Theme Presets") drive scheme + tokens. The
    // legacy `theme` prop sets `data-tack-theme` for back-compat selectors.
    // Default preset is `'default'`; pass `preset: ...` to override or
    // provide a custom TackThemePreset object.
    const preset = resolvePreset(state.config.preset ?? 'default')
    if (preset) {
      // Apply Layer 2 tokens as inline custom properties. Inline beats sheet
      // specificity, but per-token consumer overrides on the dialog still win.
      for (const [name, value] of Object.entries(preset.tokens)) {
        dialog.style.setProperty(name, value)
      }
      // `data-tack-scheme` is the source of truth — drives the
      // forced-light/forced-dark CSS branches. Auto means follow OS pref.
      if (preset.scheme !== 'auto') {
        dialog.setAttribute('data-tack-scheme', preset.scheme)
      }
    }

    // Legacy `theme` prop — kept for back-compat with first-wave consumers.
    // Default to dark per DESIGN.md when no preset/theme provided. Preset's
    // `scheme` takes precedence when both are set.
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
    shadow.append(dialog)

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

  function isOpen(): boolean {
    return !state.destroyed && state.dialog?.open === true
  }

  function toggle(): void {
    if (state.destroyed) return
    if (isOpen()) close()
    else open()
  }

  // Pre-handle for the hotkey binding: bindHotkey reads .open/.close/.toggle
  // off the object, but we want the live functions, not stale references —
  // closures over `open`/`close`/`toggle` are fine here, just use a literal.
  let unbindHotkey: (() => void) | null = null
  if (config.hotkey) {
    unbindHotkey = bindHotkey({ open, close, toggle }, config.hotkey)
  }

  function destroy(): void {
    if (state.destroyed) return
    state.destroyed = true
    state.abort?.abort()
    unbindHotkey?.()
    unbindHotkey = null
    // Removing the host cascades: shadow root, dialog, listeners, all gone.
    // Native <dialog> in the top layer is implicitly closed when its
    // containing shadow tree is removed from the document.
    state.host?.remove()
    state.host = null
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

  return { open, close, toggle, isOpen, destroy, update }
}

// Monotonic counter for unique element ids — collision-free across the
// page lifetime, deterministic for snapshot tests.
let _dialogIdCounter = 0
function nextDialogId(): number {
  _dialogIdCounter += 1
  return _dialogIdCounter
}

/**
 * Mount a closed shadow root attached to a `<tack-widget-host>` span in the
 * light DOM. The hyphenated tag name signals to devtools what this is and
 * prevents accidental host CSS like `span { display: block }` from matching.
 *
 * Closed mode (per DESIGN.md) blocks `host.shadowRoot` access from the host
 * page. Tests reach the root via the `__testShadowRoots` WeakMap above.
 */
function mountShadowHost(container: HTMLElement): {
  host: HTMLElement
  shadow: ShadowRoot
} {
  const host = document.createElement('tack-widget-host')
  const shadow = host.attachShadow({ mode: 'closed' })
  _testShadowRoots.set(host, shadow)
  container.append(host)
  return { host, shadow }
}

/**
 * Inject the default stylesheet into a shadow root. Prefers
 * `adoptedStyleSheets` (constructable stylesheets, shared by reference across
 * every widget instance — constant DOM weight regardless of count) with a
 * runtime fallback to a per-root `<style>` element. The fallback covers
 * Safari 15.4-16.3 where adoptedStyleSheets isn't supported on shadow roots,
 * matching the OKLCH baseline already locked in DESIGN.md. Both code paths
 * produce identical visual output.
 *
 * `injectStyles: false` skips this entirely so consumers can ship their own
 * CSS by appending a stylesheet inside the shadow root via `container` +
 * a custom mount path.
 */
function ensureStylesInShadow(shadow: ShadowRoot): void {
  // adoptedStyleSheets path. Wrapped in try/catch because some jsdom builds
  // throw on assignment to shadow.adoptedStyleSheets even though the
  // descriptor is present.
  try {
    if (
      'adoptedStyleSheets' in shadow &&
      typeof CSSStyleSheet !== 'undefined' &&
      typeof (CSSStyleSheet.prototype as { replaceSync?: unknown }).replaceSync ===
        'function'
    ) {
      if (!_sharedSheet) {
        _sharedSheet = new CSSStyleSheet()
        _sharedSheet.replaceSync(TACK_DEFAULT_CSS)
      }
      ;(shadow as unknown as { adoptedStyleSheets: CSSStyleSheet[] }).adoptedStyleSheets =
        [_sharedSheet]
      return
    }
  } catch {
    // Fall through to <style> fallback. Visual output is identical.
  }
  const style = document.createElement('style')
  style.setAttribute('data-tack-styles', '')
  style.textContent = TACK_DEFAULT_CSS
  shadow.append(style)
}

const TACK_DEFAULT_CSS = `
:host {
  /*
   * DESIGN.md mandates "all: initial" on the shadow host so host page CSS
   * (font-size, line-height, color, font-family pathologies) cannot inherit
   * into the shadow tree. We then re-set the typographic primitives we
   * actually want — these are the values dialog children inherit from.
   */
  all: initial;
  font-family: var(--tack-font, ui-sans-serif, system-ui, -apple-system,
    "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif);
  font-size: var(--tack-text-base, 16px);
  line-height: 1.55;
  letter-spacing: 0;
  color: var(--tack-fg, oklch(0.22 0.01 100));
  text-align: left;
  /*
   * Without display:block the dialog inside still works (top-layer
   * positioning is independent), but the host element itself reports
   * zero size, which can confuse intersection observers and devtools.
   */
  display: block;
}
/*
 * Layer 2 token defaults (DESIGN.md "Token Layers"). Preset objects supply
 * inline overrides on the dialog (higher specificity). All ~30 tokens have
 * fallbacks here so consumers who only set a subset still render correctly.
 */
[data-tack-widget] {
  /* Surfaces (light) */
  --tack-bg: oklch(0.98 0.005 100);
  --tack-surface: oklch(1 0 0);
  --tack-surface-elevated: oklch(1 0 0);
  --tack-surface-overlay: oklch(0 0 0 / 0.4);
  /* Text (light) */
  --tack-fg: oklch(0.22 0.01 100);
  --tack-fg-muted: oklch(0.5 0.01 100);
  --tack-fg-subtle: oklch(0.65 0.01 100);
  --tack-fg-on-accent: oklch(0.99 0 0);
  /* Borders */
  --tack-border: oklch(0.9 0.005 100);
  --tack-border-strong: oklch(0.82 0.005 100);
  --tack-border-focus: oklch(0.62 0.19 145);
  /* Accent */
  --tack-accent: oklch(0.62 0.19 145);
  --tack-accent-strong: oklch(0.55 0.20 145);
  --tack-accent-soft: oklch(0.62 0.19 145 / 0.16);
  /* Semantic */
  --tack-success: oklch(0.62 0.19 145);
  --tack-warning: oklch(0.75 0.16 75);
  --tack-error: oklch(0.6 0.22 25);
  --tack-info: oklch(0.65 0.13 230);
  /* Spacing (4px base) */
  --tack-space-2xs: 2px;
  --tack-space-xs: 4px;
  --tack-space-sm: 8px;
  --tack-space-md: 12px;
  --tack-space-lg: 16px;
  --tack-space-xl: 24px;
  --tack-space-2xl: 32px;
  --tack-space-3xl: 48px;
  --tack-space-4xl: 64px;
  /* Radii */
  --tack-radius-sm: 4px;
  --tack-radius-md: 6px;
  --tack-radius-lg: 10px;
  --tack-radius-xl: 14px;
  --tack-radius-full: 9999px;
  /* Shadows */
  --tack-shadow-sm: 0 1px 2px oklch(0 0 0 / 0.06);
  --tack-shadow-md: 0 4px 12px oklch(0 0 0 / 0.08), 0 1px 3px oklch(0 0 0 / 0.06);
  --tack-shadow-lg: 0 24px 64px oklch(0 0 0 / 0.18), 0 4px 12px oklch(0 0 0 / 0.08);
  /* Typography */
  --tack-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, sans-serif;
  --tack-font-display: var(--tack-font);
  --tack-font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
    "Liberation Mono", monospace;
  --tack-text-xs: 12px;
  --tack-text-sm: 13px;
  --tack-text-base: 16px;
  --tack-text-lg: 18px;
  /* Motion */
  --tack-duration-fast: 100ms;
  --tack-duration-base: 150ms;
  --tack-duration-slow: 250ms;
  --tack-easing-out: cubic-bezier(0.2, 0.8, 0.2, 1);
  --tack-easing-in: cubic-bezier(0.4, 0, 1, 1);
  --tack-easing-inout: cubic-bezier(0.4, 0, 0.2, 1);
  /* Tap target — DESIGN.md: 44px on mobile (default), 36px when host has a
     fine pointer (mouse). Override in the @media (pointer: fine) block. */
  --tack-tap-target: 44px;
  /* Stacking */
  --tack-z-index: 2147483600;

  /* Box */
  border: 1px solid var(--tack-border);
  padding: 0;
  border-radius: var(--tack-radius-xl);
  background: var(--tack-surface);
  color: var(--tack-fg);
  box-shadow: var(--tack-shadow-lg);
  font-family: var(--tack-font);
  max-width: min(420px, calc(100vw - 32px));
  width: 100%;
}

@media (pointer: fine) {
  [data-tack-widget] {
    --tack-tap-target: 36px;
  }
}

[data-tack-widget]::backdrop {
  background: var(--tack-surface-overlay);
  backdrop-filter: blur(4px);
}
[data-tack-widget] form {
  display: flex;
  flex-direction: column;
  gap: var(--tack-space-md);
  padding: var(--tack-space-xl);
}
[data-tack-widget] [data-tack-title] {
  margin: 0;
  font-size: var(--tack-text-base);
  font-weight: 600;
  line-height: 1.3;
}
[data-tack-widget] [data-tack-input] {
  font: inherit;
  color: inherit;
  background: var(--tack-surface);
  border: 1px solid var(--tack-border);
  border-radius: var(--tack-radius-md);
  padding: 10px 12px;
  resize: vertical;
  min-height: 96px;
  width: 100%;
  box-sizing: border-box;
}
[data-tack-widget] [data-tack-input]:focus-visible {
  outline: 2px solid var(--tack-accent-soft);
  outline-offset: 1px;
  border-color: var(--tack-border-focus);
}
[data-tack-widget] [data-tack-actions] {
  display: flex;
  justify-content: flex-end;
  gap: var(--tack-space-sm);
}
[data-tack-widget] button {
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  border-radius: var(--tack-radius-md);
  padding: 8px 14px;
  min-height: var(--tack-tap-target);
  border: 1px solid transparent;
  transition:
    background var(--tack-duration-base) var(--tack-easing-out),
    border-color var(--tack-duration-base) var(--tack-easing-out),
    transform var(--tack-duration-base) var(--tack-easing-out);
}
[data-tack-widget] button:focus-visible {
  outline: 3px solid var(--tack-accent-soft);
  outline-offset: 2px;
}
[data-tack-widget] [data-tack-cancel] {
  background: transparent;
  color: var(--tack-fg-muted);
  border-color: var(--tack-border);
}
[data-tack-widget] [data-tack-cancel]:hover {
  background: var(--tack-border);
  color: var(--tack-fg);
}
[data-tack-widget] [data-tack-submit] {
  background: var(--tack-accent);
  color: var(--tack-fg-on-accent);
}
[data-tack-widget] [data-tack-submit]:hover {
  background: var(--tack-accent-strong);
}
[data-tack-widget] [data-tack-submit]:disabled,
[data-tack-widget] [data-tack-cancel]:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Forced dark — preset.scheme === 'dark' OR legacy theme="dark" prop. */
[data-tack-widget][data-tack-scheme="dark"],
[data-tack-widget][data-tack-theme="dark"] {
  --tack-bg: oklch(0.16 0.005 100);
  --tack-surface: oklch(0.2 0.005 100);
  --tack-surface-elevated: oklch(0.24 0.005 100);
  --tack-surface-overlay: oklch(0 0 0 / 0.5);
  --tack-fg: oklch(0.96 0.005 100);
  --tack-fg-muted: oklch(0.7 0.005 100);
  --tack-fg-subtle: oklch(0.5 0.005 100);
  --tack-border: oklch(0.28 0.005 100);
  --tack-border-strong: oklch(0.38 0.005 100);
  --tack-accent: oklch(0.7 0.18 145);
  --tack-accent-strong: oklch(0.78 0.18 145);
  --tack-accent-soft: oklch(0.7 0.18 145 / 0.18);
  --tack-fg-on-accent: oklch(0.16 0.005 100);
  --tack-shadow-sm: 0 1px 2px oklch(0 0 0 / 0.3);
  --tack-shadow-md: 0 4px 12px oklch(0 0 0 / 0.4), 0 1px 3px oklch(0 0 0 / 0.3);
  --tack-shadow-lg: 0 24px 64px oklch(0 0 0 / 0.4), 0 4px 12px oklch(0 0 0 / 0.18);
}

/* Auto — follow OS pref ONLY when neither preset.scheme nor theme forces it. */
@media (prefers-color-scheme: dark) {
  [data-tack-widget]:not([data-tack-scheme]):not([data-tack-theme="light"]):not([data-tack-theme="dark"]) {
    --tack-bg: oklch(0.16 0.005 100);
    --tack-surface: oklch(0.2 0.005 100);
    --tack-surface-elevated: oklch(0.24 0.005 100);
    --tack-surface-overlay: oklch(0 0 0 / 0.5);
    --tack-fg: oklch(0.96 0.005 100);
    --tack-fg-muted: oklch(0.7 0.005 100);
    --tack-fg-subtle: oklch(0.5 0.005 100);
    --tack-border: oklch(0.28 0.005 100);
    --tack-border-strong: oklch(0.38 0.005 100);
    --tack-accent: oklch(0.7 0.18 145);
    --tack-accent-strong: oklch(0.78 0.18 145);
    --tack-accent-soft: oklch(0.7 0.18 145 / 0.18);
    --tack-fg-on-accent: oklch(0.16 0.005 100);
    --tack-shadow-sm: 0 1px 2px oklch(0 0 0 / 0.3);
    --tack-shadow-md: 0 4px 12px oklch(0 0 0 / 0.4), 0 1px 3px oklch(0 0 0 / 0.3);
    --tack-shadow-lg: 0 24px 64px oklch(0 0 0 / 0.4), 0 4px 12px oklch(0 0 0 / 0.18);
  }
}

/*
 * Mobile bottom-sheet (DESIGN.md "Widget breakpoints"). Below 640px the
 * dialog becomes a full-bleed sheet anchored to the bottom edge with
 * safe-area-inset padding, drag-handle affordance, and slide-up entrance.
 */
@media (max-width: 639px) {
  [data-tack-widget] {
    max-width: 100vw;
    width: 100vw;
    margin: 0;
    margin-top: auto;
    margin-bottom: 0;
    inset: auto 0 0 0;
    border-radius: var(--tack-radius-xl) var(--tack-radius-xl) 0 0;
    border-bottom: 0;
    /* Safe-area-inset bottom keeps the form clear of iOS home indicators. */
    padding-bottom: env(safe-area-inset-bottom, 0);
    animation: tack-sheet-slide-in var(--tack-duration-slow) var(--tack-easing-out);
  }
  [data-tack-widget] form {
    padding: var(--tack-space-lg);
    gap: var(--tack-space-md);
  }
  /* Drag handle — visual affordance only ("this can be swiped down"). We
     don't bind a swipe-to-dismiss gesture; the handle is a comprehension cue,
     not an interactive control. */
  [data-tack-widget] form::before {
    content: "";
    align-self: center;
    width: 36px;
    height: 4px;
    border-radius: var(--tack-radius-full);
    background: var(--tack-border-strong);
    margin-bottom: var(--tack-space-xs);
  }
  /* Submit goes full-width on mobile per DESIGN.md "Mobile a11y rules". */
  [data-tack-widget] [data-tack-actions] {
    flex-direction: column-reverse;
    gap: var(--tack-space-sm);
  }
  [data-tack-widget] [data-tack-submit],
  [data-tack-widget] [data-tack-cancel] {
    width: 100%;
  }
}

@keyframes tack-sheet-slide-in {
  from {
    transform: translateY(100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

/*
 * Reduced-motion (DESIGN.md "Motion"). Disable the slide-up entrance and
 * shorten transitions to near-instant.
 */
@media (prefers-reduced-motion: reduce) {
  [data-tack-widget] {
    animation: none;
  }
  [data-tack-widget] button,
  [data-tack-widget] [data-tack-input] {
    transition-duration: 1ms;
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
