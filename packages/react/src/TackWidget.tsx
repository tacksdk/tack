import { useEffect, useRef, useState } from 'react'
import { Tack, TackError } from '@tacksdk/js'
import type {
  BuiltinPresetName,
  CaptureConsoleConfig,
  TackHandle,
  TackSubmitRequest,
  TackThemePreset,
  TackUser,
  TackWidgetConfig,
} from '@tacksdk/js'

export interface TackWidgetProps {
  /** Public project id from the Tack dashboard ("proj_...") */
  projectId: string
  /** Override the API endpoint */
  endpoint?: string
  /** Trigger button label */
  label?: string
  /** Color scheme. "auto" follows prefers-color-scheme. */
  theme?: 'auto' | 'light' | 'dark'
  /**
   * Theme preset. Built-in: 'default' | 'midnight' | 'paper'. Or pass a
   * custom `TackThemePreset` object. Resolved by the vanilla core.
   *
   * Note: like `theme`, changing this re-mounts the dialog. If you pass a
   * `TackThemePreset` *object*, hoist it to a module-level constant or
   * `useMemo` it — inline `preset={{ ... }}` will re-mount on every parent
   * render. String preset names are referentially stable and safe to inline.
   */
  preset?: BuiltinPresetName | TackThemePreset
  /** Skip injecting the SDK's default stylesheet — host owns the look. */
  injectStyles?: boolean
  /** Dialog title */
  title?: string
  /** Submit button label inside the dialog */
  submitLabel?: string
  /** Cancel button label inside the dialog */
  cancelLabel?: string
  /** Textarea placeholder */
  placeholder?: string
  /** Optional user attached to submissions. Updates without re-mounting the dialog. */
  user?: TackUser
  /** Extra metadata attached to submissions. Updates without re-mounting the dialog. */
  metadata?: Record<string, unknown>
  /** className applied to the trigger button */
  className?: string
  /** Optional global keyboard shortcut that toggles the dialog. None by
   * default. See `TackWidgetConfig.hotkey` for syntax (e.g. `'mod+alt+f'`). */
  hotkey?: string
  /**
   * Host app version, e.g. "1.4.2" or a git SHA. Sent on every submission.
   * Use bundler-injected values: Next.js `process.env.NEXT_PUBLIC_APP_VERSION`,
   * Vite `import.meta.env.VITE_APP_VERSION`, or a custom `__APP_VERSION__`.
   */
  appVersion?: string
  /**
   * Rating UI variant. When set, renders the control above the textarea and
   * sends `rating` + auto-attached `metadata.ratingScale` on submission.
   *   - `false` (default) — no rating UI
   *   - `'thumbs'` — 👍/👎 (sends ±1)
   *   - `'stars'` — 1-5 stars (sends 1..5)
   *   - `'emoji'` — 😞 😐 🙂 😄 (sends 1..4)
   */
  rating?: false | 'thumbs' | 'stars' | 'emoji'
  /**
   * Capture host console output. Off by default. Privacy footgun — read
   * the README before enabling. `true` captures `error` + `warn`; pass an
   * object for fine-grained control.
   *
   * Object identity matters: changing the reference re-mounts the dialog.
   * Hoist or `useMemo` if you pass an object literal.
   */
  captureConsole?: boolean | CaptureConsoleConfig
  /**
   * Custom container the dialog mounts into. Default: `document.body`.
   * Re-mounts the dialog when the element reference changes — pass a stable
   * ref, not a freshly-queried DOM node every render.
   */
  container?: HTMLElement
  /**
   * Dialog placement relative to the trigger or viewport. See
   * `TackWidgetConfig.placement` for accepted values.
   */
  placement?: TackWidgetConfig['placement']
  /**
   * `'auto'` (default) renders the SDK's built-in trigger button.
   * `'none'` means the host provides its own trigger (call `handle.open()`).
   * In `<TackWidget>` the React wrapper always renders its own button on top
   * of whatever the core does, so this is mostly useful via `useTack`.
   */
  trigger?: 'auto' | 'none'
  /** CSS z-index applied to the dialog host. Default: SDK-managed. */
  zIndex?: number
  /** When false, the dialog renders non-modal (`<dialog>.show()`). Default: true. */
  modal?: boolean
  /** When false, body scroll is not locked while the dialog is open. */
  scrollLock?: boolean
  /** Verbose console diagnostics from the vanilla core. */
  debug?: boolean
  /**
   * Custom `fetch` implementation used for submission. Use to inject auth
   * headers, route through a proxy, or stub in tests. Identity changes
   * re-mount — pass a stable reference.
   */
  fetch?: typeof fetch
  /**
   * Extra headers merged into the submission request. Object identity
   * matters: changing the reference re-mounts. Hoist or `useMemo`.
   */
  headers?: Record<string, string>
  /**
   * Custom screenshot capture function or `false` to disable the capture
   * button entirely. Identity changes re-mount.
   */
  captureScreenshot?: ((el: Element) => Promise<string>) | false
  /**
   * Called after a successful submission. Receives the request payload.
   * Latest reference is always used (read through a ref, no re-mount on
   * identity change).
   */
  onSubmit?: (request: TackSubmitRequest) => void
  /** Called on submission error. Latest reference is always used. */
  onError?: (err: TackError) => void
  /** Called when the dialog opens. Latest reference is always used. */
  onOpen?: () => void
  /** Called when the dialog closes. Latest reference is always used. */
  onClose?: () => void
}

/**
 * React wrapper around the vanilla `Tack` widget. Renders a trigger button
 * and lets the vanilla core own the dialog DOM, theming, lifecycle, and
 * submit. The component itself holds nothing more than the `TackHandle`.
 *
 * Re-mounts the dialog only when the immutable-after-init props change
 * (`projectId`, `endpoint`, `theme`, `injectStyles`, copy strings, layout
 * fields like `placement`/`zIndex`/`modal`/`container`, transport fields
 * like `fetch`/`headers`/`captureScreenshot`).
 *
 * - `user` and `metadata` are patched on the live handle via
 *   `handle.update()` when they change — no re-mount.
 * - `onSubmit`, `onError`, `onOpen`, `onClose` are read through a ref at
 *   call time, so identity-changing callbacks (the common React pattern)
 *   never re-init the widget at all.
 *
 * No `useLayoutEffect` (SSR-unfriendly) and no `eslint-disable
 * react-hooks/exhaustive-deps` — every effect's dep array honestly
 * matches what the body reads. Mutable values flow through refs.
 */
export function TackWidget({
  projectId,
  endpoint,
  label = 'Feedback',
  theme,
  preset,
  injectStyles,
  title,
  submitLabel,
  cancelLabel,
  placeholder,
  user,
  metadata,
  className,
  hotkey,
  appVersion,
  rating,
  captureConsole,
  container,
  placement,
  trigger,
  zIndex,
  modal,
  scrollLock,
  debug,
  fetch: fetchImpl,
  headers,
  captureScreenshot,
  onSubmit,
  onError,
  onOpen,
  onClose,
}: TackWidgetProps) {
  const handleRef = useRef<TackHandle | null>(null)
  // Mutable props live in a ref so the init effect reads the freshest
  // value at call time without listing them in its dep array. The init
  // body only references stable refs and the listed primitive deps.
  const mutableRef = useRef({ user, metadata, onSubmit, onError, onOpen, onClose })
  mutableRef.current = { user, metadata, onSubmit, onError, onOpen, onClose }
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const handle = Tack.init({
      projectId,
      endpoint,
      theme,
      preset,
      injectStyles,
      title,
      submitLabel,
      cancelLabel,
      placeholder,
      hotkey,
      appVersion,
      rating,
      captureConsole,
      container,
      placement,
      trigger,
      zIndex,
      modal,
      scrollLock,
      debug,
      fetch: fetchImpl,
      headers,
      captureScreenshot,
      user: mutableRef.current.user,
      metadata: mutableRef.current.metadata,
      onSubmit: (_result, req) => mutableRef.current.onSubmit?.(req),
      onError: (err) => mutableRef.current.onError?.(err),
      onOpen: () => mutableRef.current.onOpen?.(),
      onClose: () => mutableRef.current.onClose?.(),
    })
    handleRef.current = handle
    setReady(true)
    return () => {
      handle.destroy()
      handleRef.current = null
      setReady(false)
    }
  }, [
    projectId,
    endpoint,
    theme,
    preset,
    injectStyles,
    title,
    submitLabel,
    cancelLabel,
    placeholder,
    hotkey,
    appVersion,
    rating,
    captureConsole,
    container,
    placement,
    trigger,
    zIndex,
    modal,
    scrollLock,
    debug,
    fetchImpl,
    headers,
    captureScreenshot,
  ])

  // Patch user/metadata on the live handle when they change. Plain
  // useEffect (not useLayoutEffect) because update() only writes in-memory
  // state — useLayoutEffect would warn under SSR with no benefit.
  useEffect(() => {
    handleRef.current?.update({ user, metadata })
  }, [user, metadata])

  return (
    <button
      type="button"
      data-tack-trigger
      className={className}
      onClick={() => handleRef.current?.open()}
      disabled={!ready}
    >
      {label}
    </button>
  )
}

/**
 * Render-nothing hook for hosts that already have their own trigger UI.
 * Returns the live handle; null until first effect runs.
 *
 * Re-mount semantics mirror `<TackWidget>`: only the immutable-after-init
 * fields trigger a re-init. `user`/`metadata` patch via `handle.update()`.
 * Callbacks (`onSubmit`/`onError`/`onOpen`/`onClose`) are read through a
 * ref so identity changes never reinit.
 */
export function useTack(config: TackWidgetConfig): TackHandle | null {
  const {
    projectId,
    endpoint,
    theme,
    preset,
    injectStyles,
    title,
    submitLabel,
    cancelLabel,
    placeholder,
    hotkey,
    appVersion,
    rating,
    captureConsole,
    container,
    placement,
    trigger,
    zIndex,
    modal,
    scrollLock,
    debug,
    fetch: fetchImpl,
    headers,
    captureScreenshot,
    user,
    metadata,
    onSubmit,
    onError,
    onOpen,
    onClose,
  } = config
  const handleRef = useRef<TackHandle | null>(null)
  const mutableRef = useRef({ user, metadata, onSubmit, onError, onOpen, onClose })
  mutableRef.current = { user, metadata, onSubmit, onError, onOpen, onClose }
  const [, force] = useState(0)

  useEffect(() => {
    const handle = Tack.init({
      projectId,
      endpoint,
      theme,
      preset,
      injectStyles,
      title,
      submitLabel,
      cancelLabel,
      placeholder,
      hotkey,
      appVersion,
      rating,
      captureConsole,
      container,
      placement,
      trigger,
      zIndex,
      modal,
      scrollLock,
      debug,
      fetch: fetchImpl,
      headers,
      captureScreenshot,
      user: mutableRef.current.user,
      metadata: mutableRef.current.metadata,
      onSubmit: (result, req) => mutableRef.current.onSubmit?.(result, req),
      onError: (err) => mutableRef.current.onError?.(err),
      onOpen: () => mutableRef.current.onOpen?.(),
      onClose: () => mutableRef.current.onClose?.(),
    })
    handleRef.current = handle
    force((n) => n + 1)
    return () => {
      handle.destroy()
      handleRef.current = null
    }
  }, [
    projectId,
    endpoint,
    theme,
    preset,
    injectStyles,
    title,
    submitLabel,
    cancelLabel,
    placeholder,
    hotkey,
    appVersion,
    rating,
    captureConsole,
    container,
    placement,
    trigger,
    zIndex,
    modal,
    scrollLock,
    debug,
    fetchImpl,
    headers,
    captureScreenshot,
  ])

  useEffect(() => {
    handleRef.current?.update({ user, metadata })
  }, [user, metadata])

  return handleRef.current
}
