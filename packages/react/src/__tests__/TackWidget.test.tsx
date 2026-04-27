// Regression tests for the React wrapper. The whole point of refactoring
// to refs + handle.update() is so that identity-changing callbacks and
// inline metadata don't tear down the dialog on every render. These tests
// exist to prevent that bug from quietly coming back.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'

import { TackWidget } from '../TackWidget'
import { __testShadowRoots } from '@tacksdk/js'

// The dialog lives inside a closed shadow root attached to a <tack-widget-host>
// span. Pierce via the test-only WeakMap exported from @tacksdk/js. The trigger
// button rendered by <TackWidget> stays in the React light DOM.
function widgetShadow(): ShadowRoot | null {
  const host = document.querySelector('tack-widget-host')
  return host ? __testShadowRoots.get(host) ?? null : null
}
function getDialog(): HTMLDialogElement | null {
  return widgetShadow()?.querySelector<HTMLDialogElement>('dialog[data-tack-widget]') ?? null
}
function inShadow<E extends Element = Element>(selector: string): E | null {
  return widgetShadow()?.querySelector<E>(selector) ?? null
}

// jsdom doesn't implement HTMLDialogElement methods. Same minimal patch
// used in @tacksdk/js's widget tests.
function patchDialog() {
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal: () => void
    close: () => void
  }
  if (!('showModal' in proto) || (proto.showModal as { _patched?: boolean })?._patched !== true) {
    const showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
      Object.defineProperty(this, 'open', { configurable: true, value: true, writable: true })
    }
    ;(showModal as unknown as { _patched: boolean })._patched = true
    proto.showModal = showModal
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open')
      Object.defineProperty(this, 'open', { configurable: true, value: false, writable: true })
    }
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  patchDialog()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('<TackWidget>', () => {
  it('renders a trigger button with the given label', () => {
    const { getByText } = render(<TackWidget projectId="proj_t" label="Send feedback" />)
    expect(getByText('Send feedback')).toBeDefined()
  })

  it('opens the vanilla dialog on trigger click', () => {
    const { getByText } = render(<TackWidget projectId="proj_t" />)
    fireEvent.click(getByText('Feedback'))
    const dialog = getDialog() as HTMLDialogElement
    expect(dialog).not.toBeNull()
    expect(dialog.open).toBe(true)
  })

  it('does NOT re-mount the dialog when only callbacks change (re-init footgun guard)', () => {
    const { rerender, getByText } = render(
      <TackWidget projectId="proj_t" onSubmit={() => {}} onError={() => {}} />,
    )
    fireEvent.click(getByText('Feedback'))
    const dialogBefore = getDialog()
    expect(dialogBefore).not.toBeNull()

    // Re-render with brand-new callback identities — exactly what happens
    // when a parent without useCallback re-renders.
    rerender(
      <TackWidget projectId="proj_t" onSubmit={() => {}} onError={() => {}} />,
    )
    const dialogAfter = getDialog()
    expect(dialogAfter).toBe(dialogBefore) // SAME node — no destroy + reinit
  })

  it('does NOT re-mount the dialog when inline metadata changes', () => {
    const { rerender, getByText } = render(
      <TackWidget projectId="proj_t" metadata={{ page: '/a' }} />,
    )
    fireEvent.click(getByText('Feedback'))
    const dialogBefore = getDialog()

    rerender(<TackWidget projectId="proj_t" metadata={{ page: '/b' }} />)
    const dialogAfter = getDialog()
    expect(dialogAfter).toBe(dialogBefore)
  })

  it('uses the latest onSubmit identity at submit time', async () => {
    const first = vi.fn()
    const second = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: 'fbk_1', url: 'x', created_at: 'x' }),
        }) as unknown as Response,
      ),
    )

    const { rerender, getByText } = render(
      <TackWidget projectId="proj_t" onSubmit={first} />,
    )
    fireEvent.click(getByText('Feedback'))

    // Swap the callback after mount. This must be picked up by the next
    // submit — even though no re-init happened.
    rerender(<TackWidget projectId="proj_t" onSubmit={second} />)

    const textarea = inShadow<HTMLTextAreaElement>('[data-tack-input]')!
    fireEvent.change(textarea, { target: { value: 'hi' } })
    const form = inShadow<HTMLFormElement>('dialog[data-tack-widget] form')!
    await act(async () => {
      form.requestSubmit()
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })

  it('DOES re-mount when projectId changes (immutable-after-init prop)', () => {
    const { rerender, getByText } = render(<TackWidget projectId="proj_a" />)
    fireEvent.click(getByText('Feedback'))
    const dialogBefore = getDialog()
    expect(dialogBefore).not.toBeNull()

    rerender(<TackWidget projectId="proj_b" />)
    // Old dialog is gone (destroyed); a new one will mount on next open.
    expect(getDialog()).toBeNull()
  })
})
