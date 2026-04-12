import { useState } from 'react'
import * as tack from '@tack/js'

export interface TackWidgetProps {
  /** Label on the trigger button */
  label?: string
  /** Called after successful submission */
  onSubmit?: () => void
  /** Called on submission error */
  onError?: (err: Error) => void
  /** Optional user ID to attach to submissions */
  userId?: string
  /** Additional metadata to attach to submissions */
  meta?: Record<string, unknown>
}

type State = 'idle' | 'open' | 'submitting' | 'success' | 'error'

export function TackWidget({
  label = 'Feedback',
  onSubmit,
  onError,
  userId,
  meta,
}: TackWidgetProps) {
  const [state, setState] = useState<State>('idle')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!message.trim()) return
    setState('submitting')
    try {
      await tack.submit({ message, userId, meta })
      setState('success')
      setMessage('')
      onSubmit?.()
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e.message)
      setState('error')
      onError?.(e)
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
