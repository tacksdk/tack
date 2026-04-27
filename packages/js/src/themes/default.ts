// Default preset — refined, technical. Tack green accent. The baseline shipped
// in `docs/design-preview.html` and the reference for every other preset.
//
// Scheme is `auto` so the widget follows the host's `prefers-color-scheme`.
// All Layer 2 tokens are set explicitly per DESIGN.md "Adding a new preset"
// rule #5 (no fallthrough — defeats the purpose of a curated preset).

import type { TackThemePreset } from '../types'

export const defaultPreset: TackThemePreset = {
  name: 'default',
  scheme: 'auto',
  tokens: {
    // Surfaces (light)
    '--tack-bg': 'oklch(0.98 0.005 100)',
    '--tack-surface': 'oklch(1 0 0)',
    '--tack-surface-elevated': 'oklch(1 0 0)',
    '--tack-surface-overlay': 'oklch(0 0 0 / 0.4)',

    // Text (light)
    '--tack-fg': 'oklch(0.22 0.01 100)',
    '--tack-fg-muted': 'oklch(0.5 0.01 100)',
    '--tack-fg-subtle': 'oklch(0.65 0.01 100)',
    '--tack-fg-on-accent': 'oklch(0.99 0 0)',

    // Borders
    '--tack-border': 'oklch(0.9 0.005 100)',
    '--tack-border-strong': 'oklch(0.82 0.005 100)',
    '--tack-border-focus': 'oklch(0.62 0.19 145)',

    // Accent — Tack green (light variant)
    '--tack-accent': 'oklch(0.62 0.19 145)',
    '--tack-accent-strong': 'oklch(0.55 0.20 145)',
    '--tack-accent-soft': 'oklch(0.62 0.19 145 / 0.16)',

    // Semantic
    '--tack-success': 'oklch(0.62 0.19 145)',
    '--tack-warning': 'oklch(0.75 0.16 75)',
    '--tack-error': 'oklch(0.6 0.22 25)',
    '--tack-info': 'oklch(0.65 0.13 230)',

    // Spacing (4px base)
    '--tack-space-2xs': '2px',
    '--tack-space-xs': '4px',
    '--tack-space-sm': '8px',
    '--tack-space-md': '12px',
    '--tack-space-lg': '16px',
    '--tack-space-xl': '24px',
    '--tack-space-2xl': '32px',
    '--tack-space-3xl': '48px',
    '--tack-space-4xl': '64px',

    // Radii (hierarchical)
    '--tack-radius-sm': '4px',
    '--tack-radius-md': '6px',
    '--tack-radius-lg': '10px',
    '--tack-radius-xl': '14px',
    '--tack-radius-full': '9999px',

    // Shadows
    '--tack-shadow-sm': '0 1px 2px oklch(0 0 0 / 0.06)',
    '--tack-shadow-md':
      '0 4px 12px oklch(0 0 0 / 0.08), 0 1px 3px oklch(0 0 0 / 0.06)',
    '--tack-shadow-lg':
      '0 24px 64px oklch(0 0 0 / 0.18), 0 4px 12px oklch(0 0 0 / 0.08)',

    // Typography
    '--tack-font':
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    '--tack-font-display':
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    '--tack-font-mono':
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    '--tack-text-xs': '12px',
    '--tack-text-sm': '13px',
    '--tack-text-base': '16px',
    '--tack-text-lg': '18px',

    // Motion
    '--tack-duration-fast': '100ms',
    '--tack-duration-base': '150ms',
    '--tack-duration-slow': '250ms',
    '--tack-easing-out': 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    '--tack-easing-in': 'cubic-bezier(0.4, 0, 1, 1)',
    '--tack-easing-inout': 'cubic-bezier(0.4, 0, 0.2, 1)',

    // Tap target
    '--tack-tap-target': '44px',
  },
}
