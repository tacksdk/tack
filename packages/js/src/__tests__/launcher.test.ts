// DOM tests for the floating-launcher core. Covers mount lifecycle,
// aria-expanded sync with the underlying <dialog>, visibility hide/show
// across open/close, two independent instances, idempotent destroy, and
// the SSR no-op handle shape.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TackLauncher } from '../launcher'
import { __testShadowRoots } from '../widget'

// The launcher BUTTON lives in the light DOM (it's the trigger). The DIALOG
// it controls lives inside a closed shadow root attached to a <tack-widget-host>
// span. Helpers below pierce the shadow root via the test affordance map.

function widgetShadow(): ShadowRoot | null {
  const host = document.querySelector('tack-widget-host')
  return host ? __testShadowRoots.get(host) ?? null : null
}

function getDialog(): HTMLDialogElement | null {
  return widgetShadow()?.querySelector<HTMLDialogElement>('dialog[data-tack-widget]') ?? null
}

function getAllDialogs(): HTMLDialogElement[] {
  return Array.from(document.querySelectorAll('tack-widget-host')).flatMap((h) => {
    const root = __testShadowRoots.get(h)
    if (!root) return []
    return Array.from(
      root.querySelectorAll<HTMLDialogElement>('dialog[data-tack-widget]'),
    )
  })
}

function inShadow<E extends Element = Element>(selector: string): E | null {
  return widgetShadow()?.querySelector<E>(selector) ?? null
}

// jsdom's HTMLDialogElement is a stub. Patch showModal/close, and have
// close() dispatch a CloseEvent so the launcher's onClose hook fires.
function patchDialog() {
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal: () => void
    close: () => void
    _patched?: boolean
  }
  if (proto._patched) return
  proto._patched = true
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
    Object.defineProperty(this, 'open', { configurable: true, value: true, writable: true })
  }
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    Object.defineProperty(this, 'open', { configurable: true, value: false, writable: true })
    this.dispatchEvent(new Event('close'))
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  vi.restoreAllMocks()
  patchDialog()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TackLauncher', () => {
  it('mount() injects a styled <button data-tack-launcher>', () => {
    const handle = TackLauncher.mount({ projectId: 'proj_test' })
    const button = document.querySelector<HTMLButtonElement>('button[data-tack-launcher]')
    expect(button).not.toBeNull()
    expect(button!.type).toBe('button')
    expect(button!.getAttribute('aria-haspopup')).toBe('dialog')
    expect(button!.getAttribute('aria-expanded')).toBe('false')
    expect(button!.getAttribute('data-tack-launcher-position')).toBe('bottom-right')
    expect(button!.getAttribute('data-tack-launcher-variant')).toBe('circle')
    handle.destroy()
  })

  it('default theme is "dark" (matches widget default per DESIGN.md)', () => {
    const handle = TackLauncher.mount({ projectId: 'proj_test' })
    const button = document.querySelector('button[data-tack-launcher]')!
    expect(button.getAttribute('data-tack-theme')).toBe('dark')
    handle.destroy()
  })

  it('theme: "auto" leaves data-tack-theme unset (CSS handles via media query)', () => {
    const handle = TackLauncher.mount({ projectId: 'proj_test', theme: 'auto' })
    const button = document.querySelector('button[data-tack-launcher]')!
    expect(button.hasAttribute('data-tack-theme')).toBe(false)
    handle.destroy()
  })

  it('pill variant renders an icon + label; circle variant renders icon only', () => {
    const pill = TackLauncher.mount({
      projectId: 'proj_test',
      variant: 'pill',
      label: 'Send feedback',
    })
    const pillBtn = document.querySelector('button[data-tack-launcher]')!
    expect(pillBtn.querySelector('[data-tack-launcher-icon]')).not.toBeNull()
    expect(pillBtn.querySelector('[data-tack-launcher-label]')?.textContent).toBe('Send feedback')
    pill.destroy()

    const circle = TackLauncher.mount({ projectId: 'proj_test', variant: 'circle' })
    const circleBtn = document.querySelector('button[data-tack-launcher]')!
    expect(circleBtn.querySelector('[data-tack-launcher-icon]')).not.toBeNull()
    expect(circleBtn.querySelector('[data-tack-launcher-label]')).toBeNull()
    circle.destroy()
  })

  it('aria-label uses the label prop (falls back to "Send feedback")', () => {
    const a = TackLauncher.mount({ projectId: 'proj_test', label: 'Tell us' })
    expect(document.querySelector('button[data-tack-launcher]')!.getAttribute('aria-label')).toBe(
      'Tell us',
    )
    a.destroy()
    const b = TackLauncher.mount({ projectId: 'proj_test' })
    expect(document.querySelector('button[data-tack-launcher]')!.getAttribute('aria-label')).toBe(
      'Send feedback',
    )
    b.destroy()
  })

  it('clicking the launcher opens the dialog and flips aria-expanded + hidden attribute', () => {
    const handle = TackLauncher.mount({ projectId: 'proj_test' })
    const button = document.querySelector<HTMLButtonElement>('button[data-tack-launcher]')!
    expect(getDialog()).toBeNull()
    button.click()
    const dialog = getDialog()!
    expect(dialog.open).toBe(true)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.hasAttribute('data-tack-launcher-hidden')).toBe(true)
    handle.destroy()
  })

  it('closing the dialog restores aria-expanded and removes the hidden attribute', () => {
    const handle = TackLauncher.mount({ projectId: 'proj_test' })
    const button = document.querySelector<HTMLButtonElement>('button[data-tack-launcher]')!
    button.click()
    expect(button.getAttribute('aria-expanded')).toBe('true')
    handle.close()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.hasAttribute('data-tack-launcher-hidden')).toBe(false)
    handle.destroy()
  })

  it('destroy() removes the launcher button AND the underlying widget; idempotent', () => {
    const handle = TackLauncher.mount({ projectId: 'proj_test' })
    handle.open()
    expect(document.querySelector('button[data-tack-launcher]')).not.toBeNull()
    expect(getDialog()).not.toBeNull()
    handle.destroy()
    expect(document.querySelector('button[data-tack-launcher]')).toBeNull()
    expect(getDialog()).toBeNull()
    expect(document.querySelector('tack-widget-host')).toBeNull()
    expect(() => handle.destroy()).not.toThrow()
  })

  it('two launchers mount independent buttons + dialogs', () => {
    const a = TackLauncher.mount({ projectId: 'proj_a' })
    const b = TackLauncher.mount({ projectId: 'proj_b' })
    expect(document.querySelectorAll('button[data-tack-launcher]')).toHaveLength(2)
    a.open()
    b.open()
    expect(getAllDialogs()).toHaveLength(2)
    a.destroy()
    expect(document.querySelectorAll('button[data-tack-launcher]')).toHaveLength(1)
    expect(getAllDialogs()).toHaveLength(1)
    b.destroy()
    expect(document.querySelectorAll('button[data-tack-launcher]')).toHaveLength(0)
    expect(getAllDialogs()).toHaveLength(0)
  })

  it('launcher styles are injected exactly once across multiple mounts', () => {
    const a = TackLauncher.mount({ projectId: 'proj_a' })
    const b = TackLauncher.mount({ projectId: 'proj_b' })
    expect(document.querySelectorAll('style[data-tack-launcher-styles]')).toHaveLength(1)
    a.destroy()
    b.destroy()
  })

  it('launcherClassName is applied alongside the data attribute', () => {
    const handle = TackLauncher.mount({
      projectId: 'proj_test',
      launcherClassName: 'my-class other',
    })
    const button = document.querySelector('button[data-tack-launcher]')!
    expect(button.className).toBe('my-class other')
    handle.destroy()
  })

  it('hideOnMobile sets the toggle attribute (CSS handles the rest)', () => {
    const a = TackLauncher.mount({ projectId: 'proj_test', hideOnMobile: true })
    expect(
      document.querySelector('button[data-tack-launcher]')!.hasAttribute('data-tack-launcher-hide-mobile'),
    ).toBe(true)
    a.destroy()
    const b = TackLauncher.mount({ projectId: 'proj_test' })
    expect(
      document.querySelector('button[data-tack-launcher]')!.hasAttribute('data-tack-launcher-hide-mobile'),
    ).toBe(false)
    b.destroy()
  })

  it('offset prop is applied as a CSS custom property on the button', () => {
    const handle = TackLauncher.mount({ projectId: 'proj_test', offset: 40 })
    const button = document.querySelector<HTMLButtonElement>('button[data-tack-launcher]')!
    expect(button.style.getPropertyValue('--tack-launcher-offset')).toBe('40px')
    handle.destroy()
  })

  it('returned handle has open / close / destroy / update', () => {
    const handle = TackLauncher.mount({ projectId: 'proj_test' })
    expect(typeof handle.open).toBe('function')
    expect(typeof handle.close).toBe('function')
    expect(typeof handle.destroy).toBe('function')
    expect(typeof handle.update).toBe('function')
    handle.destroy()
  })

  it('update() patches mutable fields on the underlying widget', async () => {
    const fetchMock = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 'fbk_1', url: 'x', created_at: 't' }),
      }) as unknown as Response,
    )
    vi.stubGlobal('fetch', fetchMock)

    const handle = TackLauncher.mount({ projectId: 'proj_test' })
    handle.update({ user: { id: 'u_42' } })
    handle.open()
    inShadow<HTMLTextAreaElement>('[data-tack-input]')!.value = 'hi'
    inShadow<HTMLFormElement>('dialog[data-tack-widget] form')!.requestSubmit()
    await new Promise((r) => setTimeout(r, 0))
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(sent.user).toEqual({ id: 'u_42' })
    handle.destroy()
  })
})
