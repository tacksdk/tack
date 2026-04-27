// Paper preset — reading-room, document-like. Warm rust accent on cream.
// Light-mode only. For editorial sites, blogs, publications.

import type { TackThemePreset } from '../types'

export const paperPreset: TackThemePreset = {
  name: 'paper',
  scheme: 'light',
  tokens: {
    // Surfaces — cream / warm white
    '--tack-bg': 'oklch(0.97 0.02 80)',
    '--tack-surface': 'oklch(0.99 0.01 80)',
    '--tack-surface-elevated': 'oklch(1 0 0)',
    '--tack-surface-overlay': 'oklch(0.22 0.01 60 / 0.4)',

    // Text — warm charcoal
    '--tack-fg': 'oklch(0.22 0.01 60)',
    '--tack-fg-muted': 'oklch(0.5 0.01 60)',
    '--tack-fg-subtle': 'oklch(0.65 0.01 60)',
    '--tack-fg-on-accent': 'oklch(0.99 0 0)',

    // Borders — warm beige
    '--tack-border': 'oklch(0.88 0.02 80)',
    '--tack-border-strong': 'oklch(0.78 0.02 80)',
    '--tack-border-focus': 'oklch(0.55 0.16 40)',

    // Accent — warm rust
    '--tack-accent': 'oklch(0.55 0.16 40)',
    '--tack-accent-strong': 'oklch(0.48 0.18 40)',
    '--tack-accent-soft': 'oklch(0.55 0.16 40 / 0.14)',

    // Semantic
    '--tack-success': 'oklch(0.55 0.16 145)',
    '--tack-warning': 'oklch(0.7 0.16 75)',
    '--tack-error': 'oklch(0.55 0.22 25)',
    '--tack-info': 'oklch(0.6 0.13 230)',

    // Spacing (shared)
    '--tack-space-2xs': '2px',
    '--tack-space-xs': '4px',
    '--tack-space-sm': '8px',
    '--tack-space-md': '12px',
    '--tack-space-lg': '16px',
    '--tack-space-xl': '24px',
    '--tack-space-2xl': '32px',
    '--tack-space-3xl': '48px',
    '--tack-space-4xl': '64px',

    // Radii — softer for the document feel
    '--tack-radius-sm': '3px',
    '--tack-radius-md': '5px',
    '--tack-radius-lg': '8px',
    '--tack-radius-xl': '12px',
    '--tack-radius-full': '9999px',

    // Shadows — softer
    '--tack-shadow-sm': '0 1px 2px oklch(0 0 0 / 0.05)',
    '--tack-shadow-md':
      '0 4px 12px oklch(0 0 0 / 0.06), 0 1px 3px oklch(0 0 0 / 0.04)',
    '--tack-shadow-lg':
      '0 24px 64px oklch(0 0 0 / 0.12), 0 4px 12px oklch(0 0 0 / 0.06)',

    // Typography — Cabinet display + Geist body called out in DESIGN.md;
    // self-hosting fonts is a separate concern, so reference by name and let
    // host pages provide the actual files. System fallback covers everything.
    '--tack-font':
      'Geist, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    '--tack-font-display':
      '"Cabinet Grotesk", Geist, ui-sans-serif, system-ui, -apple-system, sans-serif',
    '--tack-font-mono':
      '"Geist Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
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
