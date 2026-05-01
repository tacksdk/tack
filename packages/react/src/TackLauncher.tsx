import { useEffect, useRef } from 'react'
import { TackLauncher as TackLauncherCore, TackError } from '@tacksdk/js'
import type {
  BuiltinPresetName,
  CaptureConsoleConfig,
  TackLauncherHandle,
  TackLauncherPosition,
  TackLauncherVariant,
  TackSubmitRequest,
  TackThemePreset,
  TackUser,
} from '@tacksdk/js'

export interface TackLauncherProps {
  /** Public project id from the Tack dashboard ("proj_...") */
  projectId: string
  /** Override the API endpoint */
  endpoint?: string
  /** Viewport corner. Default: "bottom-right". */
  position?: TackLauncherPosition
  /** "circle" (icon only) or "pill" (icon + label). Default: "circle". */
  variant?: TackLauncherVariant
  /** Pill label and aria-label. Default: "Send feedback". */
  label?: string
  /** Px from viewport edges. Default: 24. */
  offset?: number
  /** Hide the launcher on screens narrower than 640px. */
  hideOnMobile?: boolean
  /** className applied to the launcher button. */
  className?: string
  /**
   * Render the launcher in document flow instead of as a fixed-position
   * floating button. The React component returns a `<span>` host element;
   * the launcher button mounts inside it. `position` and `offset` are
   * ignored when `inline` is true.
   */
  inline?: boolean
  /** Color scheme. "auto" follows prefers-color-scheme. */
  theme?: 'auto' | 'light' | 'dark'
  /**
   * Theme preset. Built-in: 'default' | 'midnight' | 'paper'. Or pass a
   * custom `TackThemePreset` object. Resolved by the vanilla core.
   *
   * Note: like `theme`, changing this re-mounts the launcher. If you pass a
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
  /** Optional user attached to submissions. */
  user?: TackUser
  /** Extra metadata attached to submissions. */
  metadata?: Record<string, unknown>
  /** Optional global keyboard shortcut that toggles the dialog. None by
   * default. See `TackWidgetConfig.hotkey` for syntax (e.g. `'mod+alt+f'`). */
  hotkey?: string
  /**
   * Host app version, e.g. "1.4.2" or a git SHA. Sent on every submission.
   * Use bundler-injected values: `process.env.NEXT_PUBLIC_APP_VERSION`,
   * `import.meta.env.VITE_APP_VERSION`, or a custom `__APP_VERSION__`.
   */
  appVersion?: string
  /**
   * Rating UI variant. When set, renders the control above the textarea and
   * sends `rating` + auto-attached `metadata.ratingScale` on submission.
   * `false` (default) hides the rating UI.
   */
  rating?: false | 'thumbs' | 'stars' | 'emoji'
  /**
   * Capture host console output. Off by default. Privacy footgun — read
   * the README before enabling.
   */
  captureConsole?: boolean | CaptureConsoleConfig
  /**
   * Called after a successful submission. Receives the request payload sent
   * to the API (lets you fire your own analytics on rating, screenshot,
   * etc., without re-tracking the state).
   */
  onSubmit?: (request: TackSubmitRequest) => void
  /** Called on submission error. */
  onError?: (err: TackError) => void
}

/**
 * React wrapper around the vanilla `TackLauncher.mount` core. Renders nothing
 * — the launcher button is mounted to `document.body` by the core. Only
 * immutable-after-init props re-mount the launcher; `user`/`metadata` and
 * callbacks are patched via the live handle's `update()`.
 */
export function TackLauncher({
  projectId,
  endpoint,
  position,
  variant,
  label,
  offset,
  hideOnMobile,
  className,
  inline,
  theme,
  preset,
  injectStyles,
  title,
  submitLabel,
  cancelLabel,
  placeholder,
  user,
  metadata,
  hotkey,
  appVersion,
  rating,
  captureConsole,
  onSubmit,
  onError,
}: TackLauncherProps) {
  const handleRef = useRef<TackLauncherHandle | null>(null)
  const inlineHostRef = useRef<HTMLSpanElement | null>(null)
  const mutableRef = useRef({ user, metadata, onSubmit, onError })
  mutableRef.current = { user, metadata, onSubmit, onError }

  useEffect(() => {
    const handle = TackLauncherCore.mount({
      projectId,
      endpoint,
      position,
      variant,
      label,
      offset,
      hideOnMobile,
      inline,
      // Inline mode mounts into our ref'd span; fixed mode mounts to body.
      launcherContainer: inline && inlineHostRef.current ? inlineHostRef.current : undefined,
      launcherClassName: className,
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
      user: mutableRef.current.user,
      metadata: mutableRef.current.metadata,
      onSubmit: (_result, req) => mutableRef.current.onSubmit?.(req),
      onError: (err) => mutableRef.current.onError?.(err),
    })
    handleRef.current = handle
    return () => {
      handle.destroy()
      handleRef.current = null
    }
  }, [
    projectId,
    endpoint,
    position,
    variant,
    label,
    offset,
    hideOnMobile,
    className,
    inline,
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
  ])

  useEffect(() => {
    handleRef.current?.update({ user, metadata })
  }, [user, metadata])

  // Inline mode needs a host element so the launcher mounts in document flow.
  // Floating mode renders nothing — the core mounts the button to document.body.
  return inline ? <span ref={inlineHostRef} data-tack-launcher-host="" /> : null
}
