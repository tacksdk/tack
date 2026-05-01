// Verifies the `preset` prop is forwarded from the React wrappers into the
// vanilla cores. The vanilla SDK already has thorough preset-resolution tests
// (see @tacksdk/js launcher.test.ts:246+); these tests confirm the React
// passthrough wires preset into Tack.init() / TackLauncherCore.mount() and
// that changing it triggers re-mount (dep-array correctness).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render } from '@testing-library/react'

import { TackWidget } from '../TackWidget'
import { TackLauncher } from '../TackLauncher'
import { __testShadowRoots } from '@tacksdk/js'

function widgetShadow(): ShadowRoot | null {
  const host = document.querySelector('tack-widget-host')
  return host ? __testShadowRoots.get(host) ?? null : null
}
function getDialog(): HTMLDialogElement | null {
  return widgetShadow()?.querySelector<HTMLDialogElement>('dialog[data-tack-widget]') ?? null
}

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
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

describe('<TackLauncher preset=...>', () => {
  // The launcher writes resolved preset tokens as inline CSS custom
  // properties on its button. Midnight's accent hue is 290 (violet); the
  // default is 145 (green). Asserting on the inline value proves preset
  // flowed through the React layer into TackLauncherCore.mount().
  it('preset="midnight" → inline launcher tokens use midnight violet', () => {
    render(<TackLauncher projectId="proj_t" preset="midnight" />)
    const button = document.querySelector<HTMLButtonElement>('[data-tack-launcher]')!
    expect(button).not.toBeNull()
    expect(button.style.getPropertyValue('--tack-launcher-accent')).toContain('290')
  })

  it('custom TackThemePreset object → launcher mirrors the supplied accent', () => {
    render(
      <TackLauncher
        projectId="proj_t"
        preset={{
          name: 'custom',
          scheme: 'light',
          tokens: {
            '--tack-accent': 'oklch(0.5 0.3 30)',
            '--tack-accent-strong': 'oklch(0.6 0.3 30)',
            '--tack-accent-soft': 'oklch(0.5 0.3 30 / 0.2)',
            '--tack-fg-on-accent': 'oklch(1 0 0)',
          },
        }}
      />,
    )
    const button = document.querySelector<HTMLButtonElement>('[data-tack-launcher]')!
    expect(button.style.getPropertyValue('--tack-launcher-accent')).toBe('oklch(0.5 0.3 30)')
  })

  it('no preset prop → no inline launcher token override', () => {
    render(<TackLauncher projectId="proj_t" />)
    const button = document.querySelector<HTMLButtonElement>('[data-tack-launcher]')!
    expect(button.style.getPropertyValue('--tack-launcher-accent')).toBe('')
  })
})

describe('<TackWidget preset=...>', () => {
  it('mounts the dialog when preset="midnight" is provided', () => {
    const { getByText } = render(<TackWidget projectId="proj_t" preset="midnight" />)
    fireEvent.click(getByText('Feedback'))
    expect(getDialog()).not.toBeNull()
  })

  it('DOES re-mount when preset string changes (immutable-after-init prop)', () => {
    const { rerender, getByText } = render(<TackWidget projectId="proj_t" preset="midnight" />)
    fireEvent.click(getByText('Feedback'))
    const dialogBefore = getDialog()
    expect(dialogBefore).not.toBeNull()

    rerender(<TackWidget projectId="proj_t" preset="paper" />)
    // Old dialog destroyed; a new one will mount on next open.
    expect(getDialog()).toBeNull()
  })
})
