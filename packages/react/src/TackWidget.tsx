import { useEffect, useRef, useState } from 'react'
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
  /** Optional user attached to submissions */
  user?: TackUser
  /** Extra metadata attached to submissions */
  metadata?: Record<string, unknown>
  /** className applied to the trigger button */
  className?: string
  /** Called after a successful submission */
  onSubmit?: () => void
  /** Called on submission error */
  onError?: (err: TackError) => void
}

/**
 * React wrapper around the vanilla `Tack` widget. Renders a trigger button
 * and lets the vanilla core own the dialog DOM, theming, lifecycle, and
 * submit. The component itself holds nothing more than the `TackHandle`.
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
  }, [
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
    onSubmit,
    onError,
  ])

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
 */
export function useTack(config: Parameters<typeof Tack.init>[0]): TackHandle | null {
  const ref = useRef<TackHandle | null>(null)
  const [, force] = useState(0)
  useEffect(() => {
    ref.current = Tack.init(config)
    force((n) => n + 1)
    return () => {
      ref.current?.destroy()
      ref.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(config)])
  return ref.current
}
