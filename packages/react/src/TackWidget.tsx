import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Tack, TackError } from '@tacksdk/js'
import type { TackHandle, TackUser } from '@tacksdk/js'

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
  /** Called after a successful submission. Latest reference is always used. */
  onSubmit?: () => void
  /** Called on submission error. Latest reference is always used. */
  onError?: (err: TackError) => void
}

/**
 * React wrapper around the vanilla `Tack` widget. Renders a trigger button
 * and lets the vanilla core own the dialog DOM, theming, lifecycle, and
 * submit. The component itself holds nothing more than the `TackHandle`.
 *
 * Re-mounts the dialog only when the immutable-after-init props change
 * (`projectId`, `endpoint`, `theme`, `injectStyles`, copy strings). For
 * mutable props (`user`, `metadata`, callbacks) it patches the live handle,
 * so unmemoised callbacks or inline metadata objects no longer destroy the
 * widget on every render.
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
  onSubmit,
  onError,
}: TackWidgetProps) {
  const handleRef = useRef<TackHandle | null>(null)
  const [ready, setReady] = useState(false)

  // Mount the dialog once per stable-config change. Copy props are bundled
  // here because they're written into the DOM at mount time and the vanilla
  // core has no DOM-update path for them yet.
  useEffect(() => {
    handleRef.current = Tack.init({
      projectId,
      endpoint,
      theme,
      injectStyles,
      title,
      submitLabel,
      cancelLabel,
      placeholder,
      user,
      metadata,
      onSubmit: () => onSubmit?.(),
      onError: (err) => onError?.(err),
    })
    setReady(true)
    return () => {
      handleRef.current?.destroy()
      handleRef.current = null
      setReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, endpoint, theme, injectStyles, title, submitLabel, cancelLabel, placeholder])

  // Patch mutable fields on every render. useLayoutEffect so the patch
  // lands before any user interaction in the same tick.
  useLayoutEffect(() => {
    handleRef.current?.update({
      user,
      metadata,
      onSubmit: onSubmit ? () => onSubmit() : undefined,
      onError: onError ? (err) => onError(err) : undefined,
    })
  }, [user, metadata, onSubmit, onError])

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
 * Re-mount semantics mirror `<TackWidget>`: only `projectId` and `endpoint`
 * trigger a re-init. Other config fields are patched via `handle.update()`
 * on each render. Callers don't need to memoise inline objects/callbacks.
 */
export function useTack(config: Parameters<typeof Tack.init>[0]): TackHandle | null {
  const handleRef = useRef<TackHandle | null>(null)
  const configRef = useRef(config)
  const [, force] = useState(0)

  // Track latest config without re-running the mount effect.
  configRef.current = config

  useEffect(() => {
    handleRef.current = Tack.init(configRef.current)
    force((n) => n + 1)
    return () => {
      handleRef.current?.destroy()
      handleRef.current = null
    }
  }, [config.projectId, config.endpoint])

  useLayoutEffect(() => {
    handleRef.current?.update({
      user: config.user,
      metadata: config.metadata,
      onSubmit: config.onSubmit,
      onError: config.onError,
    })
  }, [config.user, config.metadata, config.onSubmit, config.onError])

  return handleRef.current
}
