import { useEffect, useRef, useState } from 'react'
import { Tack, TackError } from '@tacksdk/js'
import type {
  CaptureConsoleConfig,
  TackHandle,
  TackSubmitRequest,
  TackUser,
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
   */
  captureConsole?: boolean | CaptureConsoleConfig
  /**
   * Called after a successful submission. Receives the server response and
   * the full request payload. Latest reference is always used.
   */
  onSubmit?: (request: TackSubmitRequest) => void
  /** Called on submission error. Latest reference is always used. */
  onError?: (err: TackError) => void
}

/**
 * React wrapper around the vanilla `Tack` widget. Renders a trigger button
 * and lets the vanilla core own the dialog DOM, theming, lifecycle, and
 * submit. The component itself holds nothing more than the `TackHandle`.
 *
 * Re-mounts the dialog only when the immutable-after-init props change
 * (`projectId`, `endpoint`, `theme`, `injectStyles`, copy strings).
 *
 * - `user` and `metadata` are patched on the live handle via
 *   `handle.update()` when they change — no re-mount.
 * - `onSubmit` and `onError` are read through a ref at submit time, so
 *   identity-changing callbacks (the common React pattern) never re-init
 *   the widget at all.
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
  onSubmit,
  onError,
}: TackWidgetProps) {
  const handleRef = useRef<TackHandle | null>(null)
  // Mutable props live in a ref so the init effect reads the freshest
  // value at call time without listing them in its dep array. The init
  // body only references stable refs and the listed primitive deps.
  const mutableRef = useRef({ user, metadata, onSubmit, onError })
  mutableRef.current = { user, metadata, onSubmit, onError }
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const handle = Tack.init({
      projectId,
      endpoint,
      theme,
      injectStyles,
      title,
      submitLabel,
      cancelLabel,
      placeholder,
      hotkey,
      appVersion,
      rating,
      captureConsole,
      user: mutableRef.current.user,
      metadata: mutableRef.current.metadata,
      onSubmit: (_result, req) => mutableRef.current.onSubmit?.(req),
      onError: (err) => mutableRef.current.onError?.(err),
    })
    handleRef.current = handle
    setReady(true)
    return () => {
      handle.destroy()
      handleRef.current = null
      setReady(false)
    }
  }, [projectId, endpoint, theme, injectStyles, title, submitLabel, cancelLabel, placeholder, hotkey, appVersion, rating, captureConsole])

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
 * Callbacks are read through a ref so identity changes never reinit.
 */
export function useTack(config: Parameters<typeof Tack.init>[0]): TackHandle | null {
  const {
    projectId,
    endpoint,
    theme,
    injectStyles,
    title,
    submitLabel,
    cancelLabel,
    placeholder,
    hotkey,
    appVersion,
    rating,
    captureConsole,
    user,
    metadata,
    onSubmit,
    onError,
  } = config
  const handleRef = useRef<TackHandle | null>(null)
  const mutableRef = useRef({ user, metadata, onSubmit, onError })
  mutableRef.current = { user, metadata, onSubmit, onError }
  const [, force] = useState(0)

  useEffect(() => {
    const handle = Tack.init({
      projectId,
      endpoint,
      theme,
      injectStyles,
      title,
      submitLabel,
      cancelLabel,
      placeholder,
      hotkey,
      appVersion,
      rating,
      captureConsole,
      user: mutableRef.current.user,
      metadata: mutableRef.current.metadata,
      onSubmit: (result, req) => mutableRef.current.onSubmit?.(result, req),
      onError: (err) => mutableRef.current.onError?.(err),
    })
    handleRef.current = handle
    force((n) => n + 1)
    return () => {
      handle.destroy()
      handleRef.current = null
    }
  }, [projectId, endpoint, theme, injectStyles, title, submitLabel, cancelLabel, placeholder, hotkey, appVersion, rating, captureConsole])

  useEffect(() => {
    handleRef.current?.update({ user, metadata })
  }, [user, metadata])

  return handleRef.current
}
