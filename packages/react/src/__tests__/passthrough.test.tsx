// Verifies that every TackWidgetConfig / TackLauncherConfig field is
// forwarded by the React wrappers into the vanilla cores. Catches the
// "props typed but silently dropped" bug class (see Copilot's review on
// tacksdk/tack#37).
//
// Pattern: mount with the option, assert observable side effect (DOM,
// behavior, or fetch payload). Re-mount tests for callback-ref patterns
// (onOpen/onClose) live alongside the existing TackWidget.test.tsx ones.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'

import { TackWidget, useTack } from '../TackWidget'
import { TackLauncher } from '../TackLauncher'
import type { TackLauncherConfig, TackWidgetConfig } from '@tacksdk/js'
import { __testShadowRoots } from '@tacksdk/js'
import type { TackLauncherProps, TackWidgetProps } from '../index'

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

function patchDialog() {
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal: () => void
    show: () => void
    close: () => void
  }
  // showModal/show are guarded against re-patching to avoid composing wrappers
  // if a sibling test file installed an earlier version. close() is always
  // (re)installed unconditionally so the 'close' event dispatch this file
  // depends on can't be silently shadowed by another file's patch under a
  // shared-jsdom vitest config.
  if (!('showModal' in proto) || (proto.showModal as { _patched?: boolean })?._patched !== true) {
    const showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
      Object.defineProperty(this, 'open', { configurable: true, value: true, writable: true })
    }
    ;(showModal as unknown as { _patched: boolean })._patched = true
    proto.showModal = showModal
    proto.show = showModal
  }
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    Object.defineProperty(this, 'open', { configurable: true, value: false, writable: true })
    // Real <dialog> fires a 'close' event on close(); jsdom doesn't, but the
    // widget's onClose hook listens on it. Dispatch synchronously so tests
    // see the wrapper-side ref pattern fire.
    this.dispatchEvent(new Event('close'))
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
  vi.unstubAllGlobals()
})

describe('<TackWidget> field passthrough', () => {
  it('container — dialog mounts inside the supplied element', () => {
    const root = document.createElement('div')
    root.id = 'custom-root'
    document.body.appendChild(root)
    const { getByText } = render(<TackWidget projectId="proj_t" container={root} />)
    fireEvent.click(getByText('Feedback'))
    expect(root.querySelector('tack-widget-host')).not.toBeNull()
  })

  it('placement — accepted at init without throwing', () => {
    // `placement` is currently a stored-but-dormant config field in the
    // vanilla widget (see widget.ts comment on TackWidgetConfig.placement).
    // The passthrough check here is type-level: this compiles + mounts.
    expect(() =>
      render(<TackWidget projectId="proj_t" placement="bottom-right" />),
    ).not.toThrow()
  })

  it('zIndex — applied as --tack-z-index custom property', () => {
    const { getByText } = render(<TackWidget projectId="proj_t" zIndex={9999} />)
    fireEvent.click(getByText('Feedback'))
    const dialog = getDialog()!
    expect(dialog.style.getPropertyValue('--tack-z-index')).toBe('9999')
  })

  it('modal=false — dialog opens non-modal (open attr without showModal locking)', () => {
    const { getByText } = render(<TackWidget projectId="proj_t" modal={false} />)
    fireEvent.click(getByText('Feedback'))
    const dialog = getDialog()!
    expect(dialog.open).toBe(true)
  })

  it('scrollLock=false — body overflow stays untouched while open', () => {
    document.body.style.overflow = 'auto'
    const { getByText } = render(<TackWidget projectId="proj_t" scrollLock={false} />)
    fireEvent.click(getByText('Feedback'))
    expect(document.body.style.overflow).toBe('auto')
  })

  it('debug — does not throw at init', () => {
    expect(() => render(<TackWidget projectId="proj_t" debug />)).not.toThrow()
  })

  it('captureScreenshot=false — capture button is not rendered', () => {
    const { getByText } = render(<TackWidget projectId="proj_t" captureScreenshot={false} />)
    fireEvent.click(getByText('Feedback'))
    expect(inShadow('[data-tack-capture-button]')).toBeNull()
  })

  it('captureScreenshot=fn — capture button IS rendered (default keeps capture on)', () => {
    const { getByText } = render(
      <TackWidget projectId="proj_t" captureScreenshot={async () => 'data:image/png;base64,X'} />,
    )
    fireEvent.click(getByText('Feedback'))
    expect(inShadow('[data-tack-capture-button]')).not.toBeNull()
  })

  it('headers + custom fetch — both flow into the submission request', async () => {
    const fetchSpy = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 'fbk_1', url: 'x', created_at: 'x' }),
      }) as unknown as Response,
    )
    const { getByText } = render(
      <TackWidget
        projectId="proj_t"
        fetch={fetchSpy as unknown as typeof fetch}
        headers={{ 'X-Trace-Id': 'abc123' }}
      />,
    )
    fireEvent.click(getByText('Feedback'))
    const textarea = inShadow<HTMLTextAreaElement>('[data-tack-input]')!
    fireEvent.change(textarea, { target: { value: 'hi' } })
    const form = inShadow<HTMLFormElement>('dialog[data-tack-widget] form')!
    await act(async () => {
      form.requestSubmit()
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(fetchSpy).toHaveBeenCalledOnce()
    const call = fetchSpy.mock.calls[0] as unknown as [unknown, RequestInit]
    const headers = call[1].headers as Record<string, string>
    expect(headers['X-Trace-Id']).toBe('abc123')
  })

  it('trigger — accepted by useTack without throwing (dormant in core)', () => {
    // Vanilla `trigger` is currently a no-op at Tack.init (see widget.ts
    // JSDoc on TackWidgetConfig.trigger). Smoke test only — same shape as
    // the placement passthrough above.
    function Host() {
      useTack({ projectId: 'proj_t', trigger: 'none' })
      return null
    }
    expect(() => render(<Host />)).not.toThrow()
  })

  it('onOpen / onClose — invoked, and latest identity is used (ref pattern)', () => {
    const open1 = vi.fn()
    const open2 = vi.fn()
    const close1 = vi.fn()
    const close2 = vi.fn()
    const { rerender, getByText } = render(
      <TackWidget projectId="proj_t" onOpen={open1} onClose={close1} />,
    )
    // Identity swap before any open — must not re-mount (handle is reused).
    rerender(<TackWidget projectId="proj_t" onOpen={open2} onClose={close2} />)
    fireEvent.click(getByText('Feedback'))
    expect(open1).not.toHaveBeenCalled()
    expect(open2).toHaveBeenCalledOnce()

    const closeBtn = inShadow<HTMLButtonElement>('[data-tack-cancel]')!
    fireEvent.click(closeBtn)
    expect(close1).not.toHaveBeenCalled()
    expect(close2).toHaveBeenCalledOnce()
  })
})

describe('<TackLauncher> field passthrough', () => {
  it('placement — accepted by the launcher without throwing (dormant in core)', () => {
    expect(() =>
      render(<TackLauncher projectId="proj_t" placement="bottom-right" />),
    ).not.toThrow()
  })

  it('zIndex — forwarded to underlying widget dialog', () => {
    render(<TackLauncher projectId="proj_t" zIndex={1234} />)
    const button = document.querySelector<HTMLButtonElement>('[data-tack-launcher]')!
    fireEvent.click(button)
    const dialog = getDialog()!
    expect(dialog.style.getPropertyValue('--tack-z-index')).toBe('1234')
  })

  it('captureScreenshot=false — no capture button in the launcher-mounted dialog', () => {
    render(<TackLauncher projectId="proj_t" captureScreenshot={false} />)
    const button = document.querySelector<HTMLButtonElement>('[data-tack-launcher]')!
    fireEvent.click(button)
    expect(inShadow('[data-tack-capture-button]')).toBeNull()
  })

  it('headers + custom fetch — flow into the submission request', async () => {
    const fetchSpy = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 'fbk_1', url: 'x', created_at: 'x' }),
      }) as unknown as Response,
    )
    render(
      <TackLauncher
        projectId="proj_t"
        fetch={fetchSpy as unknown as typeof fetch}
        headers={{ 'X-Trace-Id': 'launcher-1' }}
      />,
    )
    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-tack-launcher]')!)
    const textarea = inShadow<HTMLTextAreaElement>('[data-tack-input]')!
    fireEvent.change(textarea, { target: { value: 'hi' } })
    const form = inShadow<HTMLFormElement>('dialog[data-tack-widget] form')!
    await act(async () => {
      form.requestSubmit()
      await new Promise((r) => setTimeout(r, 0))
    })
    const call = fetchSpy.mock.calls[0] as unknown as [unknown, RequestInit]
    const headers = call[1].headers as Record<string, string>
    expect(headers['X-Trace-Id']).toBe('launcher-1')
  })
})

// ---------------------------------------------------------------------------
// Type-level invariant: every vanilla config field must be reachable through
// the React props (modulo a small, named exclusion list for fields that the
// wrapper renames or owns internally). Adding a field to TackWidgetConfig
// without touching the React wrappers should fail `pnpm --filter react lint`
// (tsc --noEmit). This is the cheap "Option C" drift guard.
// ---------------------------------------------------------------------------

// Keys present on vanilla `TackWidgetConfig` that aren't surfaced as a
// same-named React prop. Keep this empty — anything new should land in the
// wrapper, not the exclusion list.
type _MissingFromWidgetProps = Exclude<keyof TackWidgetConfig, keyof TackWidgetProps>
const _widgetCoverageOk: [_MissingFromWidgetProps] extends [never] ? true : false = true
void _widgetCoverageOk

// `TackLauncher` reserves `onOpen` / `onClose` for its own a11y wiring, and
// renames `launcherContainer` / `launcherClassName` to React-idiomatic
// `inline` (with internal ref) + `className`. Everything else must be a
// same-named prop.
type _LauncherExcluded = 'onOpen' | 'onClose' | 'launcherContainer' | 'launcherClassName'
type _MissingFromLauncherProps = Exclude<
  keyof TackLauncherConfig,
  keyof TackLauncherProps | _LauncherExcluded
>
const _launcherCoverageOk: [_MissingFromLauncherProps] extends [never] ? true : false = true
void _launcherCoverageOk

describe('config coverage type invariant', () => {
  it('compiles (failure here means a vanilla config field is missing from React props)', () => {
    expect(_widgetCoverageOk).toBe(true)
    expect(_launcherCoverageOk).toBe(true)
  })
})
