import { useEffect, useRef, useState } from 'react'
import { init, reset, submit, TackError } from '@tacksdk/js'
import type { TackUser } from '@tacksdk/js'

export interface TackWidgetProps {
  /** Public project id from the Tack dashboard ("proj_...") */
  projectId: string
  /** Override the API endpoint */
  endpoint?: string
  /** Button label on the trigger */
  label?: string
  /** Optional user attached to submissions */
  user?: TackUser
  /** Extra metadata attached to submissions */
  metadata?: Record<string, unknown>
  /** Called after a successful submission */
  onSubmit?: () => void
  /** Called on submission error */
  onError?: (err: TackError | Error) => void
}

type State = 'idle' | 'open' | 'submitting' | 'success' | 'error'

export function TackWidget({
  projectId,
  endpoint,
  label = 'Feedback',
  user,
  metadata,
  onSubmit,
  onError,
}: TackWidgetProps) {
  const [state, setState] = useState<State>('idle')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const initialized = useRef(false)

  useEffect(() => {
    init({ projectId, endpoint, user, metadata })
    initialized.current = true
    return () => {
      reset()
      initialized.current = false
    }
  }, [projectId, endpoint, user, metadata])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!message.trim()) return
    setState('submitting')
    setError(null)
    try {
      await submit({ body: message })
      setState('success')
      setMessage('')
      onSubmit?.()
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e.message)
      setState('error')
      onError?.(e as TackError | Error)
    }
  }

  if (state === 'idle') {
    return (
      <button onClick={() => setState('open')} data-tack-trigger>
        {label}
      </button>
    )
  }

  if (state === 'success') {
    return (
      <div data-tack-success>
        <p>Thanks for your feedback!</p>
        <button onClick={() => setState('idle')}>Close</button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} data-tack-form>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="What's on your mind?"
        rows={4}
        disabled={state === 'submitting'}
        required
      />
      {state === 'error' && <p data-tack-error>{error}</p>}
      <div>
        <button type="button" onClick={() => setState('idle')} disabled={state === 'submitting'}>
          Cancel
        </button>
        <button type="submit" disabled={state === 'submitting' || !message.trim()}>
          {state === 'submitting' ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  )
}
