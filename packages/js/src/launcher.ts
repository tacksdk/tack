// Drop-in floating launcher button. See DESIGN.md "Invocation Modes" → Mode 2.
//
// Owns its own fixed-position button DOM and delegates the dialog to a
// Tack.init() handle. The launcher hides while the dialog is open (so the
// trigger isn't double-rendered) and restores when the dialog closes.

import { Tack } from './widget'
import type { TackHandle, TackWidgetConfig } from './widget'
import { resolvePreset } from './themes'

export type TackLauncherPosition =
  | 'bottom-right'
  | 'bottom-left'
  | 'top-right'
  | 'top-left'

export type TackLauncherVariant = 'circle' | 'pill'

/**
 * Launcher configuration. Inherits everything from `TackWidgetConfig` except
 * `onOpen` / `onClose` — the launcher owns those internally to keep
 * `aria-expanded` and visibility in sync with the dialog. Listen for submit
 * results via `onSubmit` / `onError` instead.
 */
export interface TackLauncherConfig
  extends Omit<TackWidgetConfig, 'onOpen' | 'onClose'> {
  /** Viewport corner. Default: "bottom-right". */
  position?: TackLauncherPosition
  /** "circle" (icon only) or "pill" (icon + label). Default: "circle". */
  variant?: TackLauncherVariant
  /** Pill label and aria-label. Default: "Send feedback". */
  label?: string
  /** Px from viewport edges. Default: 24. */
  offset?: number
  /** Hide the launcher on screens narrower than 640px. Default: false. */
  hideOnMobile?: boolean
  /** Container for the launcher button. Default: document.body. */
  launcherContainer?: HTMLElement
  /** Class added to the launcher button (alongside data-tack-launcher). */
  launcherClassName?: string
  /**
   * Render the launcher in normal document flow instead of as a fixed-position
   * floating button. When true, `position` and `offset` are ignored, and the
   * button is mounted into `launcherContainer` (default: document.body, but
   * for inline mode the React wrapper passes its own ref'd element).
   *
   * Use case: showing the launcher inside a hero section, a CTA cluster, or
   * an empty-state, where the floating mode would feel out of place.
   */
  inline?: boolean
}

export interface TackLauncherHandle {
  /** Open the dialog. */
  open: () => void
  /** Close the dialog. */
  close: () => void
  /** Open if closed, close if open. */
  toggle: () => void
  /** True when the dialog is currently open. */
  isOpen: () => boolean
  /** Remove the launcher and the underlying widget. Idempotent. */
  destroy: () => void
  /** Patch mutable fields on the underlying widget without re-mount. */
  update: TackHandle['update']
}

const MESSAGE_SQUARE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
  'aria-hidden="true" focusable="false">' +
  '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +
  '</svg>'

let _launcherIdCounter = 0
function nextLauncherId(): string {
  _launcherIdCounter += 1
  return `tack-launcher-${_launcherIdCounter}`
}

function mountLauncher(config: TackLauncherConfig): TackLauncherHandle {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {
      open() {},
      close() {},
      toggle() {},
      isOpen: () => false,
      destroy() {},
      update() {},
    }
  }

  const inline = config.inline ?? false
  const position: TackLauncherPosition = config.position ?? 'bottom-right'
  const variant: TackLauncherVariant = config.variant ?? 'circle'
  const label = config.label ?? 'Send feedback'
  const offset = config.offset ?? 24
  const hideOnMobile = config.hideOnMobile ?? false

  if (config.injectStyles !== false) ensureLauncherStylesInjected()

  const button = document.createElement('button')
  button.type = 'button'
  button.id = nextLauncherId()
  button.setAttribute('data-tack-launcher', '')
  if (inline) {
    button.setAttribute('data-tack-launcher-inline', '')
  } else {
    button.setAttribute('data-tack-launcher-position', position)
  }
  button.setAttribute('data-tack-launcher-variant', variant)
  if (hideOnMobile) button.setAttribute('data-tack-launcher-hide-mobile', '')
  const resolvedTheme = config.theme ?? 'dark'
  if (resolvedTheme !== 'auto') {
    button.setAttribute('data-tack-theme', resolvedTheme)
  }
  if (config.launcherClassName) button.className = config.launcherClassName
  button.style.setProperty('--tack-launcher-offset', `${offset}px`)

  // Mirror the preset's accent onto the launcher so the floating button
  // tracks the dialog's color (DESIGN.md "Theme Presets"). The launcher
  // lives outside [data-tack-widget], so it can't inherit those tokens via
  // CSS — wire them inline instead. Per-launcher overrides via
  // `launcherClassName` still win since inline-style specificity is below
  // a !important class rule but above the bundled defaults.
  const preset = resolvePreset(config.preset ?? 'default')
  if (preset) {
    const accent = preset.tokens['--tack-accent']
    const accentStrong = preset.tokens['--tack-accent-strong']
    const accentSoft = preset.tokens['--tack-accent-soft']
    const fgOnAccent = preset.tokens['--tack-fg-on-accent']
    if (accent) button.style.setProperty('--tack-launcher-accent', accent)
    if (accentStrong)
      button.style.setProperty('--tack-launcher-accent-strong', accentStrong)
    if (accentSoft)
      button.style.setProperty('--tack-launcher-accent-soft', accentSoft)
    if (fgOnAccent) button.style.setProperty('--tack-launcher-fg', fgOnAccent)
  }

  button.setAttribute('aria-label', label)
  button.setAttribute('aria-expanded', 'false')
  button.setAttribute('aria-haspopup', 'dialog')

  const icon = document.createElement('span')
  icon.setAttribute('data-tack-launcher-icon', '')
  icon.innerHTML = MESSAGE_SQUARE_SVG
  button.append(icon)

  if (variant === 'pill') {
    const labelEl = document.createElement('span')
    labelEl.setAttribute('data-tack-launcher-label', '')
    labelEl.textContent = label
    button.append(labelEl)
  }

  const container = config.launcherContainer ?? document.body
  container.append(button)

  let destroyed = false

  const handle: TackHandle = Tack.init({
    ...config,
    onOpen: () => {
      button.setAttribute('aria-expanded', 'true')
      button.setAttribute('data-tack-launcher-hidden', '')
    },
    onClose: () => {
      button.setAttribute('aria-expanded', 'false')
      button.removeAttribute('data-tack-launcher-hidden')
      // Native <dialog> returns focus to the previously-focused element on
      // close; if focus landed somewhere else (e.g. a programmatic close),
      // restore it explicitly so keyboard users don't get dropped.
      if (!destroyed && document.activeElement === document.body) {
        button.focus()
      }
    },
  })

  button.addEventListener('click', () => handle.open())

  function destroy(): void {
    if (destroyed) return
    destroyed = true
    button.remove()
    handle.destroy()
  }

  return {
    open: () => handle.open(),
    close: () => handle.close(),
    toggle: () => handle.toggle(),
    isOpen: () => handle.isOpen(),
    destroy,
    update: (partial) => handle.update(partial),
  }
}

function ensureLauncherStylesInjected(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-tack-launcher-styles]')) return
  const style = document.createElement('style')
  style.setAttribute('data-tack-launcher-styles', '')
  style.textContent = TACK_LAUNCHER_CSS
  document.head.append(style)
}

const TACK_LAUNCHER_CSS = `
[data-tack-launcher] {
  --tack-launcher-offset: 24px;
  /* Accent vars fall back through the widget's accent tokens so consumers
     who set --tack-accent at :root / body level get launcher tracking for
     free. --tack-launcher-fg is hardcoded (not a var() fallback) because
     fg-on-accent is a contrast partner: its correct value depends on what
     the launcher's RENDERED accent actually is, not what an ancestor's
     accent happens to be. Inheriting it from page chrome (e.g. dark page
     with light-green accent → near-black on-accent) breaks the launcher's
     contrast. Preset-driven launchers receive inline overrides from
     mountLauncher (the launcher lives outside [data-tack-widget] and
     can't inherit). */
  --tack-launcher-accent: var(--tack-accent, oklch(0.62 0.19 145));
  --tack-launcher-accent-strong: var(--tack-accent-strong, oklch(0.55 0.21 145));
  --tack-launcher-accent-soft: var(--tack-accent-soft, oklch(0.62 0.19 145 / 0.35));
  --tack-launcher-fg: oklch(0.99 0 0);
  --tack-launcher-shadow-md: 0 4px 16px oklch(0 0 0 / 0.18), 0 1px 2px oklch(0 0 0 / 0.08);
  --tack-launcher-shadow-lg: 0 12px 32px oklch(0 0 0 / 0.22), 0 4px 12px oklch(0 0 0 / 0.10);
  --tack-launcher-z: 2147483000;
  position: fixed;
  z-index: var(--tack-z-launcher, var(--tack-launcher-z));
  appearance: none;
  border: 0;
  margin: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--tack-launcher-accent);
  color: var(--tack-launcher-fg);
  cursor: pointer;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  font-weight: 500;
  line-height: 1;
  border-radius: 9999px;
  box-shadow: var(--tack-launcher-shadow-md);
  transition: transform 150ms ease-out, box-shadow 150ms ease-out, background 150ms ease-out;
  -webkit-tap-highlight-color: transparent;
}
[data-tack-launcher][data-tack-launcher-variant="circle"] {
  width: 48px;
  height: 48px;
  padding: 0;
}
[data-tack-launcher][data-tack-launcher-variant="pill"] {
  height: 44px;
  padding: 0 16px 0 14px;
  min-width: 48px;
}
[data-tack-launcher][data-tack-launcher-position="bottom-right"] {
  bottom: max(var(--tack-launcher-offset), env(safe-area-inset-bottom));
  right: max(var(--tack-launcher-offset), env(safe-area-inset-right));
}
[data-tack-launcher][data-tack-launcher-position="bottom-left"] {
  bottom: max(var(--tack-launcher-offset), env(safe-area-inset-bottom));
  left: max(var(--tack-launcher-offset), env(safe-area-inset-left));
}
[data-tack-launcher][data-tack-launcher-position="top-right"] {
  top: max(var(--tack-launcher-offset), env(safe-area-inset-top));
  right: max(var(--tack-launcher-offset), env(safe-area-inset-right));
}
[data-tack-launcher][data-tack-launcher-position="top-left"] {
  top: max(var(--tack-launcher-offset), env(safe-area-inset-top));
  left: max(var(--tack-launcher-offset), env(safe-area-inset-left));
}
/* Inline mode: in normal document flow, no fixed positioning, no offsets. */
[data-tack-launcher][data-tack-launcher-inline] {
  position: static;
  top: auto;
  right: auto;
  bottom: auto;
  left: auto;
  z-index: auto;
}
[data-tack-launcher] [data-tack-launcher-icon] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
[data-tack-launcher][data-tack-launcher-variant="circle"] [data-tack-launcher-icon] svg {
  width: 20px;
  height: 20px;
}
[data-tack-launcher][data-tack-launcher-variant="pill"] [data-tack-launcher-icon] svg {
  width: 18px;
  height: 18px;
}
[data-tack-launcher] [data-tack-launcher-label] {
  white-space: nowrap;
}
[data-tack-launcher]:hover {
  background: var(--tack-launcher-accent-strong);
  box-shadow: var(--tack-launcher-shadow-lg);
  transform: scale(1.04);
}
[data-tack-launcher]:active {
  transform: scale(0.98);
}
[data-tack-launcher]:focus-visible {
  outline: 3px solid var(--tack-launcher-accent-soft);
  outline-offset: 2px;
}
[data-tack-launcher][data-tack-launcher-hidden] {
  display: none;
}
@media (max-width: 639px) {
  [data-tack-launcher] {
    --tack-launcher-offset: max(16px, env(safe-area-inset-bottom));
  }
  /* Pill collapses to icon-only on mobile — labels eat horizontal space and
     the bottom-sheet dialog already announces "Send feedback" via its title. */
  [data-tack-launcher][data-tack-launcher-variant="circle"],
  [data-tack-launcher][data-tack-launcher-variant="pill"] {
    width: 52px;
    height: 52px;
    padding: 0;
    min-width: 0;
  }
  [data-tack-launcher][data-tack-launcher-variant="pill"] [data-tack-launcher-label] {
    display: none;
  }
  [data-tack-launcher][data-tack-launcher-variant="pill"] [data-tack-launcher-icon] svg {
    width: 20px;
    height: 20px;
  }
  [data-tack-launcher][data-tack-launcher-hide-mobile] {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  [data-tack-launcher] {
    transition: box-shadow 150ms ease-out, background 150ms ease-out;
  }
  [data-tack-launcher]:hover,
  [data-tack-launcher]:active {
    transform: none;
  }
}
`

export const TackLauncher = { mount: mountLauncher }
