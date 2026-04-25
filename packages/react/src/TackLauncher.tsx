import { useEffect, useRef } from 'react'
import { TackLauncher as TackLauncherCore, TackError } from '@tacksdk/js'
import type {
  TackLauncherHandle,
  TackLauncherPosition,
  TackLauncherVariant,
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
  /** Optional user attached to submissions. */
  user?: TackUser
  /** Extra metadata attached to submissions. */
  metadata?: Record<string, unknown>
  /** Called after a successful submission. */
  onSubmit?: () => void
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
}: TackLauncherProps) {
  const handleRef = useRef<TackLauncherHandle | null>(null)
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
      launcherClassName: className,
      theme,
      injectStyles,
      title,
      submitLabel,
      cancelLabel,
      placeholder,
      user: mutableRef.current.user,
      metadata: mutableRef.current.metadata,
      onSubmit: () => mutableRef.current.onSubmit?.(),
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
    theme,
    injectStyles,
    title,
    submitLabel,
    cancelLabel,
    placeholder,
  ])

  useEffect(() => {
    handleRef.current?.update({ user, metadata })
  }, [user, metadata])

  return null
}
