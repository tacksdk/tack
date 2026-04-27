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

import type { CaptureHandle } from './console-capture'
import { TackError, docUrl } from './errors'
import { applyFontSafety } from './font-safety'
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
   *
   * @deprecated Use `preset` (with a TackThemePreset whose `scheme` field
   * supplies the color mode). The `theme` prop and `preset.scheme` both
   * produce CSS attributes (`data-tack-theme` and `data-tack-scheme`) and
   * the dark/light selectors group both via comma — meaning if a consumer
   * sets `theme="dark"` AND `preset.scheme="light"`, the dark branch wins
   * (CSS doesn't know which is "newer"). Resolution: scheduled for removal
   * in S8 (public surface consolidation). Pass `preset` only.
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
  /**
   * Called on successful submit. Receives the server response and the full
   * request payload that was sent. The second arg is provided so consumers
   * can fire their own analytics on submission contents (e.g. "user gave
   * 5 stars") without having to track that state themselves.
   *
   * Backwards compatible: existing `(result) => void` callers ignore the
   * second arg.
   */
  onSubmit?: (
    result: TackFeedbackCreated,
    request: TackSubmitRequest,
  ) => void
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
  /**
   * Launcher placement, when `trigger: 'auto'` mounts a launcher. Has no
   * effect on the dialog itself — `<dialog>` lives in the top layer and is
   * centered by the browser regardless. Accepts the legacy short forms
   * `'br'` and `'bl'` with a one-shot deprecation warning per page load.
   */
  placement?:
    | 'bottom-right'
    | 'bottom-left'
    | 'top-right'
    | 'top-left'
    | 'custom'
    | 'br'
    | 'bl'
  /**
   * `'auto'` reserves a slot for the SDK to mount a launcher button.
   * `'none'` (current default) means the host owns its trigger and calls
   * `handle.open()`. The `'auto'` path is wired through but is currently a
   * no-op when invoked via `Tack.init` — use `TackLauncher.mount()` for the
   * launcher today; this option exists so consumer code can adopt the final
   * surface ahead of the auto-mount landing.
   */
  trigger?: 'auto' | 'none'
  /**
   * Stacking context for the dialog. Applied as inline `--tack-z-index`.
   * Default keeps Tack above most third-party widgets (Intercom, Crisp, …).
   */
  zIndex?: number
  /**
   * `true` (default) opens via `dialog.showModal()` — top-layer rendering,
   * focus trap, ESC dismissal, backdrop. `false` calls `dialog.show()` —
   * non-modal, no focus trap, no backdrop. Opt out only when you really
   * need a non-blocking surface; you give up the a11y guarantees the modal
   * path provides.
   */
  modal?: boolean
  /**
   * Lock body scroll while the dialog is open. Default `true`. Skipped when
   * `modal: false` (no backdrop = non-blocking surface, host scroll is
   * intentionally available).
   */
  scrollLock?: boolean
  /**
   * Verbose lifecycle logging via `console.debug`. Off by default. When on,
   * every FSM transition, capture attempt, and lifecycle boundary is
   * namespaced as `[tack@<version>]` so it's filterable in devtools.
   */
  debug?: boolean
  /**
   * Custom fetch implementation passed to the transport. Useful for
   * corporate proxies, tracing libraries, or test fakes. Defaults to
   * `globalThis.fetch`.
   */
  fetch?: typeof fetch
  /**
   * Extra request headers merged into the submit POST. Cannot override
   * `X-Tack-SDK-Version` — that one is locked last so the version stamp is
   * always honest for server-side analytics.
   */
  headers?: Record<string, string>
  /**
   * Screenshot capture escape hatch.
   *   - `false` disables capture entirely (no toggle in the UI, no module
   *     load)
   *   - a function overrides the default html-to-image path; called with
   *     the capture target element (the host page body), should resolve to
   *     a `data:image/...;base64,...` URL
   *   - `undefined` (default) uses the lazy-loaded html-to-image path
   *
   * The default capture path is lazy-imported so the main bundle stays
   * under its size cap.
   */
  captureScreenshot?: ((el: Element) => Promise<string>) | false
  /**
   * Host app version, e.g. "1.4.2" or a git SHA. Sent on every submission
   * as `appVersion` so feedback can be bucketed by release. No format
   * constraint — the dashboard treats this as an opaque string.
   *
   * Common bundler patterns:
   *   - Next.js:  `process.env.NEXT_PUBLIC_APP_VERSION`
   *   - Vite:     `import.meta.env.VITE_APP_VERSION`
   *   - Custom:   `__APP_VERSION__` (define via webpack/rollup `DefinePlugin`)
   */
  appVersion?: string
  /**
   * Rating UI variant. When set, renders a control above the textarea and
   * sends the selected value as `rating` on submission. Also auto-attaches
   * `metadata.ratingScale` so the dashboard can label the value
   * unambiguously (4 of 5 stars vs 4 of 4 emoji vs +1 thumbs).
   *   - `false` (default) — no rating UI, no `rating` in the request
   *   - `'thumbs'` — 👍 / 👎, sends `+1` or `-1`
   *   - `'stars'` — 1-5 stars, sends `1..5`
   *   - `'emoji'` — 😞 😐 🙂 😄, sends `1..4`
   */
  rating?: false | 'thumbs' | 'stars' | 'emoji'
  /**
   * Capture host console output and attach to submissions in
   * `metadata.console`. Off by default. Privacy footgun — read the README
   * before enabling. The captured buffer is per-widget (no cross-widget
   * leakage) and the host's existing console wrappers (Sentry, Datadog) are
   * preserved on uninstall via wrapper-identity check.
   *
   *   - `false` (default) — no patching, no capture
   *   - `true` — capture `error` + `warn`, last 20 entries, default config
   *   - object — fine-grained: `{ levels: ['error', 'warn'], maxEntries: 50 }`
   *
   * Inspect what's been captured at any point via `handle.getCapturedConsole()`
   * — useful in dev mode to verify nothing sensitive will ship.
   */
  captureConsole?: boolean | CaptureConsoleConfig
}

/**
 * Console-capture configuration. Named + exported so TypeScript autocomplete
 * reveals the shape on `{` keystroke and consumers can reference the type
 * from their own code.
 */
export interface CaptureConsoleConfig {
  /** Console levels to capture. Default: `['error', 'warn']`. */
  levels?: ('error' | 'warn' | 'info' | 'log')[]
  /** Maximum entries kept in the buffer (FIFO eviction). Default: 20. */
  maxEntries?: number
}

/**
 * One captured console entry. Returned from `handle.getCapturedConsole()`
 * and shipped as `metadata.console[]` on submissions.
 */
export interface ConsoleEntry {
  level: 'error' | 'warn' | 'info' | 'log'
  /** Wall-clock timestamp at capture (ms since epoch). */
  ts: number
  /** Serialized arg list. Each arg is rendered safely (cycles, errors, DOM, depth-capped). */
  msg: string
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
   * Snapshot of the console buffer for THIS widget instance. Returns a copy
   * (not a live reference); safe to log or pass through analytics. Returns
   * `[]` when `captureConsole` is off or no entries have been captured yet.
   *
   * Useful in dev mode to verify what would ship before enabling capture in
   * production: `console.log(handle.getCapturedConsole())`.
   */
  getCapturedConsole: () => ConsoleEntry[]
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

/**
 * Lifecycle state machine. Per docs/phase-2-extraction.md "Step 2":
 *
 *   idle ─open()→ composing ─submit→ submitting ─┬→ success ─1500ms→ closed
 *                  ↑                              ├→ error_retryable
 *                  ├─ retry ─────────────────────┤   (429, 5xx — retry button)
 *                  ├─ retry ─────────────────────┤→ error_docs
 *                  └─ keystroke ─────────────────┤   (4xx — doc link)
 *                                                 └→ network_error
 *                                                    (fetch threw — retry button)
 *
 *   close()/destroy() reset to idle from any state.
 *
 * Each state controls visible DOM regions: status (aria-live), submit, retry,
 * doc link. Illegal transitions are no-ops with a console.debug log so bugs
 * surface in dev without crashing in prod.
 */
type WidgetState =
  | 'idle'
  | 'composing'
  | 'capturing'
  | 'capture_failed'
  | 'submitting'
  | 'success'
  | 'error_retryable'
  | 'error_docs'
  | 'network_error'

const LEGAL_TRANSITIONS: Record<WidgetState, readonly WidgetState[]> = {
  idle: ['composing'],
  // composing → capturing on Add-screenshot click; → submitting on Send.
  composing: ['capturing', 'submitting', 'idle'],
  // capturing is the snapshot substate. Success returns to composing with
  // the screenshot stashed on state; failure flips to capture_failed.
  // submitting from capturing is gone — capture is independent of submit
  // now, so the user clicks Send when they're ready.
  capturing: ['composing', 'capture_failed', 'idle'],
  // capture_failed → composing on dismiss (keystroke or new button click);
  // → submitting if the user clicks Send anyway (capture is optional).
  capture_failed: ['composing', 'capturing', 'submitting', 'idle'],
  submitting: ['success', 'error_retryable', 'error_docs', 'network_error', 'idle'],
  success: ['idle'],
  error_retryable: ['submitting', 'composing', 'idle'],
  error_docs: ['composing', 'idle'],
  network_error: ['submitting', 'composing', 'idle'],
}

/** ms to wait on `success` before auto-closing the dialog. Plan minimum: 1500. */
const SUCCESS_AUTOCLOSE_MS = 1800

/**
 * Module-level "warned this page load already" set, keyed by the deprecation
 * token. One-shot warnings prevent log spam when a host re-renders. Reset only
 * across full page loads — that's the right granularity for "you should
 * migrate" nudges.
 */
const _deprecationWarned: Set<string> = new Set()
function warnDeprecatedOnce(key: string, message: string): void {
  if (_deprecationWarned.has(key)) return
  _deprecationWarned.add(key)
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(`[tack] ${message}`)
  }
}

interface RatingOption {
  /** Display label inside the button. */
  label: string
  /** Numeric value sent on submission. Per spec: ±1 for thumbs, 1..5 for stars, 1..4 for emoji. */
  value: number
  /** aria-label for screen readers. */
  aria: string
}

/**
 * Render-time button list for each rating variant. Single source of truth so
 * test expectations and DOM render stay in sync. Order matters — emoji and
 * stars render lowest-on-the-left, thumbs renders thumbs-down-on-the-left.
 */
function ratingOptionsFor(
  variant: 'thumbs' | 'stars' | 'emoji',
): RatingOption[] {
  switch (variant) {
    case 'thumbs':
      return [
        { label: '👎', value: -1, aria: 'Thumbs down' },
        { label: '👍', value: 1, aria: 'Thumbs up' },
      ]
    case 'stars':
      return [1, 2, 3, 4, 5].map((n) => ({
        label: '★',
        value: n,
        aria: `${n} ${n === 1 ? 'star' : 'stars'}`,
      }))
    case 'emoji':
      return [
        { label: '😞', value: 1, aria: 'Bad' },
        { label: '😐', value: 2, aria: 'Meh' },
        { label: '🙂', value: 3, aria: 'Good' },
        { label: '😄', value: 4, aria: 'Great' },
      ]
  }
}

/**
 * Resolve `placement` accepting the legacy `'br'`/`'bl'` aliases. Each alias
 * triggers a one-shot deprecation warning so consumers can migrate without
 * being silently broken. Returns the canonical long form.
 */
function resolvePlacement(
  placement: TackWidgetConfig['placement'] | undefined,
):
  | 'bottom-right'
  | 'bottom-left'
  | 'top-right'
  | 'top-left'
  | 'custom'
  | undefined {
  if (placement === 'br') {
    warnDeprecatedOnce(
      'placement-br',
      "placement: 'br' is deprecated; use 'bottom-right'",
    )
    return 'bottom-right'
  }
  if (placement === 'bl') {
    warnDeprecatedOnce(
      'placement-bl',
      "placement: 'bl' is deprecated; use 'bottom-left'",
    )
    return 'bottom-left'
  }
  return placement
}

/**
 * Map a TackError to the FSM error bucket. Server-side issues that a retry
 * might fix (rate limit, 5xx) go to `error_retryable`. Network failures are
 * a separate bucket so the message can be specific. Everything else (4xx
 * validation, auth, payload too large, not found) goes to `error_docs` with
 * a link to the canonical docs page.
 */
function classifyError(err: TackError): 'error_retryable' | 'error_docs' | 'network_error' {
  if (err.type === 'network_error') return 'network_error'
  if (err.type === 'rate_limited') return 'error_retryable'
  if (err.status !== null && err.status >= 500) return 'error_retryable'
  return 'error_docs'
}

interface InternalState {
  config: TackWidgetConfig & { endpoint: string }
  /** Light-DOM host element holding the closed shadow root. */
  host: HTMLElement | null
  dialog: HTMLDialogElement | null
  textarea: HTMLTextAreaElement | null
  submitBtn: HTMLButtonElement | null
  /** Aria-live region inside the dialog for FSM status announcements. */
  statusEl: HTMLDivElement | null
  /** Retry button shown in error_retryable + network_error states. */
  retryBtn: HTMLButtonElement | null
  /** Doc-link anchor shown in error_docs state. */
  docLink: HTMLAnchorElement | null
  /** Current FSM state. Drives DOM visibility + aria-live announcements. */
  fsm: WidgetState
  /** Set during `success` state, cleared on transition out. */
  successTimer: ReturnType<typeof setTimeout> | null
  abort: AbortController | null
  destroyed: boolean
  /**
   * Element that had focus immediately before open() ran. close() restores
   * focus here so keyboard users return to whatever invoked the dialog
   * (typically the host's launcher button). Per DESIGN.md a11y checklist:
   * "focus returns to trigger on close".
   */
  previousFocus: HTMLElement | null
  /**
   * Pre-lock value of `document.body.style.overflow`, captured when scroll
   * lock kicks in on open(). `null` means we have not locked (so close()
   * won't accidentally overwrite a host-set value). Restored on close()/
   * destroy().
   */
  priorBodyOverflow: string | null
  /**
   * "Add screenshot" / "Remove screenshot" button (S4). Click triggers a
   * capture; clicking again with a screenshot attached removes it. Null when
   * captureScreenshot: false (consumer opted out — no DOM, no button).
   */
  captureBtn: HTMLButtonElement | null
  /** Screenshot thumbnail preview (S4). Hidden until a capture is attached. */
  capturePreview: HTMLImageElement | null
  /**
   * Currently attached screenshot data URL, or null. Set when capture
   * succeeds (via the Add screenshot button); read by handleSubmit and
   * attached to the request body. Cleared by Cancel, by Remove, and after
   * a successful submit's auto-close.
   */
  capturedScreenshot: string | null
  /**
   * Monotonic generation counter for in-flight captures. Each runCaptureFlow
   * captures the current value at start; on resolve it bails if the value
   * has changed (Cancel/ESC/backdrop closed the dialog mid-capture, or
   * destroy ran). Without this, a capture that resolves after Cancel would
   * re-attach a screenshot the user explicitly discarded.
   */
  captureGen: number
  /**
   * Rating row container (S-extension). Null when `rating: false` (the
   * default — no rating UI). Hidden in success state via CSS.
   */
  ratingRow: HTMLDivElement | null
  /**
   * Rating option buttons keyed by their numeric value. Click handler flips
   * aria-pressed + stores `state.rating`. Empty when rating is disabled.
   */
  ratingButtons: HTMLButtonElement[]
  /**
   * Currently selected rating value, or null. Cleared by Cancel/ESC/close
   * and after successful submit. Sent as `rating` on the request body when
   * non-null.
   */
  rating: number | null
  /**
   * Per-widget console-capture handle. Null when `captureConsole: false`.
   * snapshot() reads the buffer; uninstall() is called on destroy.
   */
  captureHandle: CaptureHandle | null
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
      getCapturedConsole: () => [],
    }
  }

  // Normalize placement up front so legacy aliases ('br'/'bl') warn at init
  // time, not lazily on first open. Result is stashed back on the config so a
  // future auto-launcher path reads the canonical value.
  const normalizedConfig: TackWidgetConfig = {
    ...config,
    placement: resolvePlacement(config.placement),
  }

  // Debug logger. No-op when `debug` is off so the prod hot path stays free of
  // the bound-function allocation. Tagged with the SDK version so devs can
  // filter logs across multiple Tack versions on the same page.
  const dlog: (...args: unknown[]) => void = config.debug
    ? (...args) => {
        if (typeof console !== 'undefined' && typeof console.debug === 'function') {
          console.debug(`[tack@${SDK_VERSION}]`, ...args)
        }
      }
    : () => {}

  const state: InternalState = {
    config: { ...normalizedConfig, endpoint: normalizedConfig.endpoint ?? DEFAULT_ENDPOINT },
    host: null,
    dialog: null,
    textarea: null,
    submitBtn: null,
    statusEl: null,
    retryBtn: null,
    docLink: null,
    fsm: 'idle',
    successTimer: null,
    abort: null,
    destroyed: false,
    previousFocus: null,
    priorBodyOverflow: null,
    captureBtn: null,
    capturePreview: null,
    capturedScreenshot: null,
    captureGen: 0,
    ratingRow: null,
    ratingButtons: [],
    rating: null,
    // Console capture installs lazily — the module is dynamic-imported so
    // the main bundle stays under cap. Trade: errors thrown in the few ms
    // between widget mount and import resolution aren't captured. Acceptable
    // because the widget is brand-new at that moment; the feedback flow
    // hasn't started.
    captureHandle: null,
  }
  const consoleConfig = config.captureConsole
  if (consoleConfig) {
    void (async () => {
      try {
        const { installConsoleCapture } = await import('./console-capture')
        if (state.destroyed) return
        state.captureHandle = installConsoleCapture(consoleConfig)
      } catch {
        // Lazy import failed (offline + uncached, network glitch). Don't
        // surface — capture is opt-in and best-effort.
      }
    })()
  }

  function ensureMounted(): HTMLDialogElement {
    if (state.dialog) return state.dialog

    const container = state.config.container ?? document.body
    const { host, shadow } = mountShadowHost(container)
    state.host = host

    if (state.config.injectStyles !== false) ensureStylesInShadow(shadow)
    // Defense against host pages whose body font is a display/script/decorative
    // family that's unreadable as paragraph text. Sniffs + glyph-probes the
    // host body font; if either signal trips, sets an inline font-family on
    // the host element to a safe system stack and warns ONCE per page load.
    // Skipped when injectStyles: false (consumer fully owns styling).
    applyFontSafety(host, { injectStyles: state.config.injectStyles })

    const dialog = document.createElement('dialog')
    dialog.setAttribute('data-tack-widget', '')

    // zIndex override applied as inline custom property — stylesheet defaults
    // to 2147483600 which beats most third-party widgets, but a host with a
    // bigger sibling (some CMS overlays) needs to bump it explicitly.
    if (typeof state.config.zIndex === 'number') {
      dialog.style.setProperty('--tack-z-index', String(state.config.zIndex))
    }

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

    // Rating row (optional). Renders a row of buttons above the textarea.
    // Button count + label per variant; click flips aria-pressed + stores
    // numeric value on state.rating. The state is read at submit time and
    // attached as `rating` + `metadata.ratingScale` on the request.
    const ratingVariant = state.config.rating
    let ratingRow: HTMLDivElement | null = null
    const ratingButtons: HTMLButtonElement[] = []
    if (ratingVariant) {
      const options = ratingOptionsFor(ratingVariant)
      ratingRow = document.createElement('div')
      ratingRow.setAttribute('data-tack-rating-row', '')
      ratingRow.setAttribute('data-tack-rating-variant', ratingVariant)
      ratingRow.setAttribute('role', 'group')
      ratingRow.setAttribute('aria-label', 'Rating')
      for (const opt of options) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.textContent = opt.label
        btn.setAttribute('data-tack-rating-option', '')
        btn.setAttribute('data-tack-rating-value', String(opt.value))
        btn.setAttribute('aria-label', opt.aria)
        btn.setAttribute('aria-pressed', 'false')
        btn.addEventListener('click', () => {
          if (state.destroyed) return
          // Toggle: clicking the active button clears the selection. Lets
          // users undo without forcing them to pick a different value.
          if (state.rating === opt.value) {
            state.rating = null
            for (const b of state.ratingButtons) b.setAttribute('aria-pressed', 'false')
            return
          }
          state.rating = opt.value
          for (const b of state.ratingButtons) {
            b.setAttribute(
              'aria-pressed',
              b === btn ? 'true' : 'false',
            )
          }
        })
        ratingRow.append(btn)
        ratingButtons.push(btn)
      }
    }

    const textarea = document.createElement('textarea')
    textarea.required = true
    textarea.rows = 4
    textarea.placeholder = state.config.placeholder ?? 'What can we improve?'
    textarea.setAttribute('data-tack-input', '')
    // No aria-label here — the dialog's aria-labelledby (above) cascades to
    // form controls inside per WAI-ARIA 1.2. Setting both causes some screen
    // readers to read the title twice.

    // Aria-live status region — empty during composing/submitting, populated
    // by transitionTo() with success/error messages. role="status" + aria-live
    // "polite" so the announcement waits for the user to finish typing rather
    // than interrupting (success/error UX). aria-atomic ensures the FULL new
    // message is read each transition, not just the diff.
    //
    // Status's id wires to textarea.aria-describedby in error states (see
    // transitionTo) so screen readers link the field to its error message.
    const statusEl = document.createElement('div')
    const statusId = `tack-status-${nextDialogId()}`
    statusEl.id = statusId
    statusEl.setAttribute('data-tack-status', '')
    statusEl.setAttribute('role', 'status')
    statusEl.setAttribute('aria-live', 'polite')
    statusEl.setAttribute('aria-atomic', 'true')
    // Hidden until a state populates it. We toggle hidden vs setting display
    // so screen readers still see the live region exists and know to watch it.
    statusEl.hidden = true

    // Doc-link anchor used in `error_docs` state. rel=noopener prevents the
    // host page from being reached via window.opener after the docs site
    // navigates. Hidden by default; transitionTo reveals + hrefs it.
    const docLink = document.createElement('a')
    docLink.setAttribute('data-tack-doc-link', '')
    docLink.setAttribute('target', '_blank')
    docLink.setAttribute('rel', 'noopener noreferrer')
    docLink.textContent = 'Read the docs'
    docLink.hidden = true

    // Screenshot capture row (S4). An explicit "Add screenshot" button —
    // clicking it captures immediately and attaches the result; clicking
    // again removes it. This replaces the earlier checkbox-on-submit flow
    // because the latter (a) needed two clicks to actually send a screenshot
    // and (b) hid capture failures until submit time. Skipped entirely when
    // captureScreenshot: false (no DOM cost).
    const captureEnabled = state.config.captureScreenshot !== false
    let captureRow: HTMLDivElement | null = null
    let captureBtn: HTMLButtonElement | null = null
    let capturePreview: HTMLImageElement | null = null
    if (captureEnabled) {
      captureRow = document.createElement('div')
      captureRow.setAttribute('data-tack-capture-row', '')

      captureBtn = document.createElement('button')
      captureBtn.type = 'button'
      captureBtn.textContent = 'Add screenshot'
      captureBtn.setAttribute('data-tack-capture-button', '')
      captureBtn.setAttribute('aria-pressed', 'false')

      capturePreview = document.createElement('img')
      capturePreview.setAttribute('data-tack-capture-preview', '')
      capturePreview.alt = 'Screenshot preview'
      capturePreview.hidden = true

      captureRow.append(captureBtn, capturePreview)
    }

    const actions = document.createElement('div')
    actions.setAttribute('data-tack-actions', '')

    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.textContent = state.config.cancelLabel ?? 'Cancel'
    cancelBtn.setAttribute('data-tack-cancel', '')

    // Retry button is mounted but hidden in normal states. Visible only in
    // `error_retryable` + `network_error`. Submit triggers a fresh attempt
    // via the same code path as form submit.
    const retryBtn = document.createElement('button')
    retryBtn.type = 'button'
    retryBtn.textContent = 'Try again'
    retryBtn.setAttribute('data-tack-retry', '')
    retryBtn.hidden = true

    const submitBtn = document.createElement('button')
    submitBtn.type = 'submit'
    submitBtn.textContent = state.config.submitLabel ?? 'Send'
    submitBtn.setAttribute('data-tack-submit', '')

    actions.append(cancelBtn, retryBtn, submitBtn)
    // Form composition. Order: title → rating (optional) → textarea →
    // capture (optional) → status → docLink → actions. Rating sits above
    // textarea so the user picks a sentiment, then writes the explanation.
    const formChildren: Node[] = [titleEl]
    if (ratingRow) formChildren.push(ratingRow)
    formChildren.push(textarea)
    if (captureRow) formChildren.push(captureRow)
    formChildren.push(statusEl, docLink, actions)
    form.append(...formChildren)
    dialog.append(form)
    shadow.append(dialog)

    state.dialog = dialog
    state.textarea = textarea
    state.submitBtn = submitBtn
    state.statusEl = statusEl
    state.retryBtn = retryBtn
    state.docLink = docLink
    state.captureBtn = captureBtn
    state.capturePreview = capturePreview
    state.ratingRow = ratingRow
    state.ratingButtons = ratingButtons

    if (captureBtn) {
      captureBtn.addEventListener('click', () => {
        // Toggle behavior: with a screenshot already attached, click removes
        // it. Otherwise capture afresh. Block while a capture is in flight.
        if (state.fsm === 'capturing' || state.fsm === 'submitting') return
        if (state.capturedScreenshot) {
          clearCapturedScreenshot()
          return
        }
        // After a failed capture the user clicks the same button to retry.
        // runCaptureFlow guards on `fsm === composing`; transition first so
        // the retry isn't a silent no-op.
        if (state.fsm === 'capture_failed') transitionTo('composing')
        void runCaptureFlow()
      })
    }
    // Cancel just delegates to close() — the dialog 'close' event handler
    // below clears state for ALL dismissal paths (Cancel button, ESC,
    // backdrop click). Single-source for the discard semantics.
    cancelBtn.addEventListener('click', () => close())
    retryBtn.addEventListener('click', () => {
      // Retry from any error state goes straight back through submit.
      // handleSubmit reads the textarea value, which the user may have edited,
      // so retry isn't required to re-send identical bytes.
      void handleSubmit()
    })
    // While in error_docs, any keystroke in the textarea returns to composing
    // (clears the error so the user can fix and resubmit without an explicit
    // dismiss). Cheaper than a separate dismiss button, matches the plan
    // "any keystroke or button click resets" transition.
    textarea.addEventListener('input', () => {
      if (state.fsm === 'error_docs') transitionTo('composing')
      else if (state.fsm === 'capture_failed') transitionTo('composing')
    })
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      void handleSubmit()
    })
    dialog.addEventListener('close', () => {
      if (state.destroyed) return
      // Clear textarea + attached screenshot + FSM on every dismissal — ESC,
      // backdrop click, Cancel button, and programmatic close all funnel
      // through the native 'close' event. Discard semantics are about the
      // user's intent ("I'm done with this dialog"), not the modality. After
      // a successful submit the state is already clear, so this is a no-op
      // on that path.
      resetDialogState()
      state.config.onClose?.()
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

  /**
   * Validated FSM transition. Updates `state.fsm`, mirrors to the dialog as
   * `data-tack-state` (for CSS selectors), updates DOM visibility (status,
   * retry, doc link, submit), and announces via aria-live. Illegal
   * transitions are no-ops with a console.debug log so devs see them but
   * production keeps running.
   *
   * TODO(phase 3): All status/button strings below are hardcoded English
   * ("Thanks for the feedback.", "Try again", "Read the docs", "Sending…",
   * "Please type something before sending."). For Phase 3 (open-signup OSS),
   * accept a `messages?: Partial<Record<MessageKey, string>>` config field
   * and look these up by key. Phase 1+2 are English-only consumers so the
   * cost is currently unjustified; revisit when an external dev asks.
   */
  function transitionTo(
    next: WidgetState,
    payload?: { error?: TackError; result?: TackFeedbackCreated },
  ): void {
    if (state.destroyed) return
    const legal = LEGAL_TRANSITIONS[state.fsm]
    if (!legal.includes(next)) {
      // Use console.debug so it's silent unless devtools verbose is on.
      // Surfaces real bugs without spamming production logs.
      if (typeof console !== 'undefined' && typeof console.debug === 'function') {
        console.debug('[tack] illegal FSM transition:', state.fsm, '→', next)
      }
      return
    }
    dlog('fsm', state.fsm, '→', next)

    // Clear any pending success-auto-close when leaving the success state.
    if (state.fsm === 'success' && state.successTimer !== null) {
      clearTimeout(state.successTimer)
      state.successTimer = null
    }

    state.fsm = next
    state.dialog?.setAttribute('data-tack-state', next)

    const status = state.statusEl
    const retry = state.retryBtn
    const submit = state.submitBtn
    const docLink = state.docLink
    const textarea = state.textarea
    if (!status || !retry || !submit || !docLink || !textarea) return

    // Reset visibility flags each transition; per-state branches set what they
    // need. Keeps state-leak between transitions impossible.
    status.hidden = true
    status.textContent = ''
    retry.hidden = true
    submit.hidden = false
    submit.disabled = false
    submit.textContent = state.config.submitLabel ?? 'Send'
    docLink.hidden = true
    docLink.removeAttribute('href')
    // Clear error wiring on textarea by default; error_* branches set it.
    // Per DESIGN.md a11y checklist: "Textarea gets aria-invalid +
    // aria-describedby pointing at error on failure".
    textarea.removeAttribute('aria-invalid')
    textarea.removeAttribute('aria-describedby')

    switch (next) {
      case 'idle':
      case 'composing':
        // Default UI: input visible, submit enabled. Nothing extra to do.
        break

      case 'capturing':
        // Capture is brief — disable submit so the user can't fire while
        // we're snapshotting. The Add screenshot button surface its own
        // "Capturing…" label.
        submit.disabled = true
        break

      case 'capture_failed':
        status.hidden = false
        status.textContent = 'Screenshot unavailable. You can still send your message.'
        submit.disabled = false
        break

      case 'submitting':
        submit.disabled = true
        submit.textContent = 'Sending…'
        break

      case 'success': {
        status.hidden = false
        status.textContent = 'Thanks for the feedback.'
        // Hide the submit + retry while the success message displays — the
        // user is done; presenting a button now invites a duplicate submit.
        submit.hidden = true
        retry.hidden = true
        // Auto-close after SUCCESS_AUTOCLOSE_MS. Stash the timer so close()
        // / destroy() / a new transition can cancel it.
        state.successTimer = setTimeout(() => {
          state.successTimer = null
          if (state.destroyed) return
          if (state.fsm === 'success') close()
        }, SUCCESS_AUTOCLOSE_MS)
        break
      }

      case 'error_retryable': {
        status.hidden = false
        const err = payload?.error
        const message =
          err?.type === 'rate_limited'
            ? 'Slow down, try again in a moment.'
            : err?.message
              ? `Server error: ${err.message}. Try again.`
              : 'Server hiccup. Try again.'
        status.textContent = message
        textarea.setAttribute('aria-invalid', 'true')
        textarea.setAttribute('aria-describedby', status.id)
        // Submit hidden, retry visible — explicit retry is clearer than
        // a re-enabled submit (user might think their first attempt was lost).
        submit.hidden = true
        retry.hidden = false
        break
      }

      case 'error_docs': {
        status.hidden = false
        const err = payload?.error
        status.textContent = err?.message ?? 'Something went wrong.'
        textarea.setAttribute('aria-invalid', 'true')
        textarea.setAttribute('aria-describedby', status.id)
        // Accept only http(s) doc URLs. Defensive against a misconfigured
        // backend sending javascript: or data: URLs — target=_blank +
        // rel=noopener don't block javascript: scheme execution on click.
        if (err?.docUrl && /^https?:\/\//i.test(err.docUrl)) {
          docLink.hidden = false
          docLink.setAttribute('href', err.docUrl)
        }
        break
      }

      case 'network_error': {
        status.hidden = false
        textarea.setAttribute('aria-invalid', 'true')
        textarea.setAttribute('aria-describedby', status.id)
        status.textContent = 'Network problem. Check your connection and retry.'
        submit.hidden = true
        retry.hidden = false
        break
      }
    }
  }

  /**
   * Snapshot the host page. Briefly hides the dialog (visibility, NOT
   * display — preserve focus state and layout) so the snapshot doesn't
   * include the modal itself, then restores visibility before resolving.
   * Wrapped in requestAnimationFrame so the browser actually paints the
   * hidden state before the capture runs (otherwise on fast machines we'd
   * race and snapshot the dialog still painted).
   *
   * `captureScreenshot: customFn` swaps the html-to-image path for the
   * caller's function. The customFn never triggers the dynamic html-to-image
   * import, so consumers can opt out of the lazy dep entirely.
   */
  async function snapshotHostPage(): Promise<string> {
    const customFn = state.config.captureScreenshot
    const target = document.body
    const dialog = state.dialog
    const priorVisibility = dialog?.style.visibility ?? ''
    if (dialog) dialog.style.visibility = 'hidden'
    try {
      await new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => resolve())
        } else {
          setTimeout(resolve, 0)
        }
      })
      if (typeof customFn === 'function') {
        return await customFn(target)
      }
      // Lazy-load the default capture path. Keeps html-to-image out of the
      // main bundle's static import closure (verified by bundle.test.ts).
      const { capture } = await import('./capture')
      return await capture(target)
    } finally {
      if (dialog) dialog.style.visibility = priorVisibility
    }
  }

  /**
   * "Add screenshot" button flow. composing → capturing → composing on
   * success (with the data URL stashed on state.capturedScreenshot and the
   * preview img populated). On failure, transitions to capture_failed,
   * surfaces a status message, and resets the button. Submit is not
   * triggered — the user clicks Send when they're ready.
   */
  async function runCaptureFlow(): Promise<void> {
    if (state.destroyed) return
    if (state.fsm !== 'composing') return
    // Claim a generation. resetDialogState (Cancel/ESC/backdrop close) bumps
    // this; if our value drifts, the user discarded the dialog mid-capture
    // and we must NOT re-attach the (now-stale) screenshot or touch the DOM.
    const myGen = ++state.captureGen
    transitionTo('capturing')
    if (state.captureBtn) {
      state.captureBtn.disabled = true
      state.captureBtn.textContent = 'Capturing…'
    }
    try {
      const dataUrl = await snapshotHostPage()
      if (state.destroyed || myGen !== state.captureGen) return
      state.capturedScreenshot = dataUrl
      if (state.capturePreview) {
        state.capturePreview.src = dataUrl
        state.capturePreview.hidden = false
      }
      transitionTo('composing')
      if (state.captureBtn) {
        state.captureBtn.disabled = false
        state.captureBtn.textContent = 'Remove screenshot'
        state.captureBtn.setAttribute('aria-pressed', 'true')
      }
    } catch (err) {
      if (state.destroyed || myGen !== state.captureGen) return
      transitionTo('capture_failed')
      if (state.captureBtn) {
        state.captureBtn.disabled = false
        state.captureBtn.textContent = 'Add screenshot'
        state.captureBtn.setAttribute('aria-pressed', 'false')
      }
      // Soft error — only surface to onError when debug is on. The visible
      // status message is the primary signal for end users.
      if (state.config.debug) {
        dlog('capture failed:', err)
        state.config.onError?.(
          new TackError(
            {
              type: 'internal_error',
              message: 'screenshot_unavailable',
              doc_url: docUrl('internal_error'),
            },
            null,
          ),
        )
      }
    }
  }

  /** Drop the attached screenshot + reset button + clear preview. */
  function clearCapturedScreenshot(): void {
    state.capturedScreenshot = null
    if (state.capturePreview) {
      state.capturePreview.hidden = true
      state.capturePreview.removeAttribute('src')
    }
    if (state.captureBtn) {
      state.captureBtn.textContent = 'Add screenshot'
      state.captureBtn.setAttribute('aria-pressed', 'false')
      state.captureBtn.disabled = false
    }
  }

  /**
   * Wipe everything the user might have entered or attached: textarea body,
   * captured screenshot, capture button label, FSM. Called on Cancel so the
   * next open() is a clean slate. NOT called on close-from-success because
   * the success flow already auto-clears the textarea and the preview.
   */
  function resetDialogState(): void {
    if (state.textarea) state.textarea.value = ''
    clearCapturedScreenshot()
    // Clear rating selection too — Cancel / ESC / backdrop are "discard
    // this draft" gestures; the rating is part of the draft.
    state.rating = null
    for (const btn of state.ratingButtons) {
      btn.setAttribute('aria-pressed', 'false')
    }
    // Bump the generation so any in-flight capture promise bails on resolve
    // instead of re-attaching a screenshot the user just discarded.
    state.captureGen++
    if (state.fsm !== 'idle') transitionTo('idle')
  }

  async function handleSubmit(): Promise<void> {
    if (state.destroyed || !state.textarea || !state.submitBtn) return
    // Block re-entry while a request is in flight. The FSM gates this; the
    // textarea check below is belt+suspenders.
    if (state.fsm === 'submitting') return
    const body = state.textarea.value.trim()
    if (!body) {
      // Empty/whitespace-only body. Don't transition the FSM (composing stays
      // composing) but DO surface a visible + aria-live announcement so
      // keyboard / screen-reader users get feedback. Plain `event.preventDefault`
      // means native textarea.required validation never fires, so we own this.
      const status = state.statusEl
      const textarea = state.textarea
      if (status) {
        status.hidden = false
        status.textContent = 'Please type something before sending.'
      }
      textarea.setAttribute('aria-invalid', 'true')
      if (status) textarea.setAttribute('aria-describedby', status.id)
      textarea.focus()
      return
    }

    // Screenshot is attached out-of-band via the "Add screenshot" button —
    // by submit time it's either already on state.capturedScreenshot or it
    // isn't. No capture-on-submit flow; if the user wanted a screenshot they
    // captured it explicitly, and double-click-to-send is gone.
    const screenshot = state.capturedScreenshot ?? undefined

    transitionTo('submitting')
    state.abort = new AbortController()
    const abortSignal = state.abort.signal

    const defaults = browserDefaults()
    // Build metadata: user-provided keys come first, then SDK-attached keys
    // overwrite (ratingScale, console). Putting ours last means the user
    // can't accidentally clobber the auto-attached values — the variant they
    // configured IS the truth for ratingScale, and the captured buffer IS
    // the source for console.
    const metadata: Record<string, unknown> = {
      ...(state.config.metadata ?? {}),
    }
    if (state.config.rating && state.rating !== null) {
      // Auto-attach the scale label so dashboard can disambiguate
      // `rating: 4` (4 stars vs 4 emoji vs invalid for thumbs).
      metadata.ratingScale = state.config.rating
    }
    if (state.captureHandle) {
      const consoleEntries = state.captureHandle.snapshot()
      if (consoleEntries.length > 0) metadata.console = consoleEntries
    }
    const req: TackSubmitRequest = {
      projectId: state.config.projectId,
      body,
      screenshot,
      rating:
        state.config.rating && state.rating !== null
          ? state.rating
          : undefined,
      appVersion: state.config.appVersion,
      url: defaults.url,
      userAgent: defaults.userAgent,
      viewport: defaults.viewport,
      user: state.config.user,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    }

    try {
      const result = await postFeedback({
        endpoint: state.config.endpoint,
        body: req,
        signal: abortSignal,
        fetch: state.config.fetch,
        headers: state.config.headers,
      })
      // Suppress side effects if the widget was destroyed or the request
      // was cancelled while in flight — the user is no longer there to see
      // success UI, and firing onSubmit after destroy is surprising.
      if (state.destroyed || abortSignal.aborted) return
      state.textarea.value = ''
      // After a successful submit the attached screenshot has served its
      // purpose. Clearing it here means the auto-close → reopen path lands
      // in a clean compose state, no stale preview.
      clearCapturedScreenshot()
      // Transition to success first (shows the aria-live message + schedules
      // auto-close), THEN fire the user callback. Order matters: a slow
      // onSubmit handler shouldn't delay the visible success state.
      transitionTo('success', { result })
      // Pass both the server response AND the request payload — consumers
      // who want to fire their own analytics on submission contents (rating
      // value, screenshot inclusion, etc.) need the request, not the result.
      state.config.onSubmit?.(result, req)
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
      // FSM picks the right error bucket from the envelope; UI updates from
      // transitionTo's per-state branch. onError still fires for callers
      // that want their own UX layer on top.
      transitionTo(classifyError(tackErr), { error: tackErr })
      state.config.onError?.(tackErr)
    } finally {
      state.abort = null
    }
  }

  function open(): void {
    if (state.destroyed) return
    const dialog = ensureMounted()
    if (!dialog.open) {
      // Stash the focused element BEFORE showModal so close() can restore
      // focus to it. Per DESIGN.md a11y checklist: "focus returns to trigger
      // on close". Filter to HTMLElement so .focus() exists; SVG/MathML
      // elements that can't be re-focused are intentionally skipped.
      const active =
        typeof document !== 'undefined' ? document.activeElement : null
      state.previousFocus = active instanceof HTMLElement ? active : null
      // modal: false uses dialog.show() — non-modal, no focus trap, no
      // backdrop, no top-layer escape. Caller has explicitly opted out of
      // the a11y guarantees showModal provides.
      const useModal = state.config.modal !== false
      dlog('open', { modal: useModal })
      if (useModal) dialog.showModal()
      else dialog.show()
      // Body scroll lock — default on, only meaningful when modal (non-modal
      // surfaces are expected to leave the host scrollable). Stash the prior
      // overflow value so close() can restore it cleanly even if some other
      // code touched it in the meantime; documented as best-effort.
      if (useModal && state.config.scrollLock !== false) {
        state.priorBodyOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
      }
      // Reset to composing on every open. Reopening after a previous error
      // or success should land the user back in the input, not show stale
      // status messages from the prior session.
      transitionTo('composing')
      state.config.onOpen?.()
    }
    state.textarea?.focus()
  }

  function close(): void {
    if (state.destroyed) return
    state.abort?.abort()
    if (state.dialog?.open) state.dialog.close()
    // Restore body overflow if we locked it. Skip if our stashed value is
    // null (we never locked) so we don't accidentally clear a host-set value.
    if (state.priorBodyOverflow !== null) {
      document.body.style.overflow = state.priorBodyOverflow
      state.priorBodyOverflow = null
    }
    dlog('close')
    // Reset FSM after closing so a subsequent open() starts clean. Skip if
    // we're already idle (e.g. close() called before open() ever fired).
    if (state.fsm !== 'idle') transitionTo('idle')
    // Restore focus to whatever element invoked the dialog (typically the
    // host's launcher button). Skip if the element was removed from the DOM
    // since open() — focus a removed node throws on some engines.
    const target = state.previousFocus
    state.previousFocus = null
    if (target && target.isConnected) {
      try {
        target.focus()
      } catch {
        // Tab-index/disabled state can throw; fail silent — the dialog has
        // closed regardless and stealing focus on close is best-effort.
      }
    }
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
    // Defensive: if destroy() runs while the dialog is still open (host tore
    // the component down without close()), the scroll lock would otherwise
    // outlive the dialog and freeze the page.
    if (state.priorBodyOverflow !== null) {
      document.body.style.overflow = state.priorBodyOverflow
      state.priorBodyOverflow = null
    }
    dlog('destroy')
    if (state.successTimer !== null) {
      clearTimeout(state.successTimer)
      state.successTimer = null
    }
    unbindHotkey?.()
    unbindHotkey = null
    // Uninstall console capture before removing the host so the wrapper-
    // identity check sees our function still in console[level] (or doesn't,
    // if Sentry stacked on top — in which case we leave their patch alone).
    state.captureHandle?.uninstall()
    state.captureHandle = null
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

  function getCapturedConsole(): ConsoleEntry[] {
    return state.captureHandle?.snapshot() ?? []
  }

  return { open, close, toggle, isOpen, destroy, update, getCapturedConsole }
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
/* Screenshot capture row (S4). "Add screenshot" / "Remove screenshot"
   button + thumbnail preview. The button is styled like a secondary action
   so it sits visually below the textarea but doesn't compete with Send. */
[data-tack-widget] [data-tack-capture-row] {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--tack-space-sm);
}
[data-tack-widget] [data-tack-capture-button] {
  background: transparent;
  color: var(--tack-fg-muted);
  border: 1px dashed var(--tack-border-strong);
  font-size: var(--tack-text-sm);
  padding: 6px 12px;
  min-height: 32px;
}
[data-tack-widget] [data-tack-capture-button]:hover {
  color: var(--tack-fg);
  border-color: var(--tack-accent);
  background: var(--tack-accent-soft);
}
[data-tack-widget] [data-tack-capture-button][aria-pressed="true"] {
  color: var(--tack-accent-strong);
  border-style: solid;
  border-color: var(--tack-accent);
  background: var(--tack-accent-soft);
}
[data-tack-widget] [data-tack-capture-button]:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
[data-tack-widget] [data-tack-capture-preview] {
  max-width: 100%;
  max-height: 120px;
  border: 1px solid var(--tack-border);
  border-radius: var(--tack-radius-sm);
  object-fit: cover;
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

/*
 * FSM-state DOM (status region, retry button, doc link). Mounted in every
 * dialog and toggled hidden/visible by transitionTo(). All three need theme
 * styling — without it they'd render with browser-default chrome and clash
 * with the surrounding refined surface.
 */
[data-tack-widget] [data-tack-status] {
  /* Inherits dialog font-size/family. role="status" announcement region. */
  margin: 0;
  font-size: var(--tack-text-sm);
  line-height: 1.4;
  color: var(--tack-fg-muted);
}
[data-tack-widget][data-tack-state="success"] [data-tack-status] {
  color: var(--tack-success);
  font-weight: 500;
  font-size: var(--tack-text-base);
  /* Center the success message so the dialog reads as a confirmation card
     during the auto-close window, not a half-empty form. */
  text-align: center;
  padding: var(--tack-space-md) 0;
}
/*
 * Success state hides the form chrome — title, textarea, actions — so the
 * dialog reads as a small confirmation card for the SUCCESS_AUTOCLOSE_MS
 * window before auto-close. Without these rules the user saw an empty
 * textarea (we clear the value on success) sitting under a tiny status
 * line, which looked broken. CSS driven by [data-tack-state] is the source
 * of truth — transitionTo() doesn't need to JS-toggle these.
 */
[data-tack-widget][data-tack-state="success"] [data-tack-title],
[data-tack-widget][data-tack-state="success"] [data-tack-input],
[data-tack-widget][data-tack-state="success"] [data-tack-capture-row],
[data-tack-widget][data-tack-state="success"] [data-tack-rating-row],
[data-tack-widget][data-tack-state="success"] [data-tack-actions] {
  display: none;
}
/* Rating row (S-extension). A row of buttons above the textarea — thumbs
   (2), stars (5), or emoji (4). Selected state via aria-pressed=true. */
[data-tack-widget] [data-tack-rating-row] {
  display: flex;
  gap: var(--tack-space-xs);
  flex-wrap: wrap;
}
[data-tack-widget] [data-tack-rating-option] {
  background: transparent;
  color: var(--tack-fg-muted);
  border: 1px solid var(--tack-border);
  font-size: var(--tack-text-base);
  padding: 6px 10px;
  min-width: var(--tack-tap-target);
  min-height: var(--tack-tap-target);
  line-height: 1;
}
[data-tack-widget] [data-tack-rating-option]:hover {
  border-color: var(--tack-accent);
  background: var(--tack-accent-soft);
}
[data-tack-widget] [data-tack-rating-option][aria-pressed="true"] {
  border-color: var(--tack-accent);
  background: var(--tack-accent-soft);
  color: var(--tack-accent-strong);
}
/* Stars variant: grouped together visually. */
[data-tack-widget] [data-tack-rating-row][data-tack-rating-variant="stars"] {
  gap: 2px;
}
[data-tack-widget] [data-tack-rating-row][data-tack-rating-variant="stars"] [data-tack-rating-option] {
  padding: 4px 6px;
  font-size: var(--tack-text-lg);
}
[data-tack-widget][data-tack-state="error_retryable"] [data-tack-status],
[data-tack-widget][data-tack-state="error_docs"] [data-tack-status],
[data-tack-widget][data-tack-state="network_error"] [data-tack-status] {
  color: var(--tack-error);
}
[data-tack-widget] [data-tack-doc-link] {
  align-self: flex-start;
  font-size: var(--tack-text-sm);
  color: var(--tack-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
[data-tack-widget] [data-tack-doc-link]:hover {
  color: var(--tack-accent-strong);
}
[data-tack-widget] [data-tack-doc-link]:focus-visible {
  outline: 2px solid var(--tack-accent-soft);
  outline-offset: 2px;
  border-radius: var(--tack-radius-sm);
}
/* Retry button — same affordance level as submit (primary action in error
   states), but uses accent-soft to read as "secondary attempt" rather than a
   bright primary. Avoids visual conflict if both retry and submit are ever
   visible together (currently mutually exclusive but defense in depth). */
[data-tack-widget] [data-tack-retry] {
  background: var(--tack-accent-soft);
  color: var(--tack-fg);
  border-color: var(--tack-border);
}
[data-tack-widget] [data-tack-retry]:hover {
  background: var(--tack-accent);
  color: var(--tack-fg-on-accent);
  border-color: transparent;
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
 * OKLCH @supports fallback. Defends Safari 15.4-16.3 + older Chrome/Firefox
 * (~2% of 2026 traffic) where oklch() and color-mix(in oklch, ...) parse as
 * invalid declarations and the entire property is dropped. Inside this block
 * we re-set every token that uses oklch() to a hex equivalent so the dialog
 * still renders. Modern browsers ignore the block entirely (their @supports
 * test passes), so there's zero cost on the modern path.
 */
@supports not (color: oklch(0 0 0)) {
  [data-tack-widget] {
    --tack-bg: #f9f9f7;
    --tack-surface: #ffffff;
    --tack-surface-elevated: #ffffff;
    --tack-surface-overlay: rgba(0, 0, 0, 0.4);
    --tack-fg: #2c2b29;
    --tack-fg-muted: #717069;
    --tack-fg-subtle: #9a988f;
    --tack-fg-on-accent: #ffffff;
    --tack-border: #e5e3dc;
    --tack-border-strong: #c8c5bc;
    --tack-border-focus: #2f9b5c;
    --tack-accent: #2f9b5c;
    --tack-accent-strong: #228048;
    --tack-accent-soft: rgba(47, 155, 92, 0.16);
    --tack-success: #2f9b5c;
    --tack-warning: #d49a2a;
    --tack-error: #c93b2f;
    --tack-info: #2f7fb8;
    --tack-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.06);
    --tack-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.06);
    --tack-shadow-lg: 0 24px 64px rgba(0, 0, 0, 0.18), 0 4px 12px rgba(0, 0, 0, 0.08);
  }
  [data-tack-widget][data-tack-scheme="dark"],
  [data-tack-widget][data-tack-theme="dark"] {
    --tack-bg: #1c1b19;
    --tack-surface: #25241f;
    --tack-surface-elevated: #2c2b25;
    --tack-surface-overlay: rgba(0, 0, 0, 0.5);
    --tack-fg: #f3f2ee;
    --tack-fg-muted: #aeada6;
    --tack-fg-subtle: #6e6c66;
    --tack-border: #3a3934;
    --tack-border-strong: #524f48;
    --tack-accent: #50c47e;
    --tack-accent-strong: #6fd996;
    --tack-accent-soft: rgba(80, 196, 126, 0.18);
    --tack-fg-on-accent: #1c1b19;
    --tack-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
    --tack-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4), 0 1px 3px rgba(0, 0, 0, 0.3);
    --tack-shadow-lg: 0 24px 64px rgba(0, 0, 0, 0.4), 0 4px 12px rgba(0, 0, 0, 0.18);
  }
  @media (prefers-color-scheme: dark) {
    [data-tack-widget]:not([data-tack-scheme]):not([data-tack-theme="light"]):not([data-tack-theme="dark"]) {
      --tack-bg: #1c1b19;
      --tack-surface: #25241f;
      --tack-surface-elevated: #2c2b25;
      --tack-surface-overlay: rgba(0, 0, 0, 0.5);
      --tack-fg: #f3f2ee;
      --tack-fg-muted: #aeada6;
      --tack-fg-subtle: #6e6c66;
      --tack-border: #3a3934;
      --tack-border-strong: #524f48;
      --tack-accent: #50c47e;
      --tack-accent-strong: #6fd996;
      --tack-accent-soft: rgba(80, 196, 126, 0.18);
      --tack-fg-on-accent: #1c1b19;
      --tack-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
      --tack-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4), 0 1px 3px rgba(0, 0, 0, 0.3);
      --tack-shadow-lg: 0 24px 64px rgba(0, 0, 0, 0.4), 0 4px 12px rgba(0, 0, 0, 0.18);
    }
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
