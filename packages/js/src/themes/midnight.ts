// Midnight preset — editorial dark, after-hours. Electric violet accent on a
// deep blue-black surface. Forced dark mode. For products with strong nighttime
// brand: terminals, music apps, code editors.

import type { TackThemePreset } from '../types'

export const midnightPreset: TackThemePreset = {
  name: 'midnight',
  scheme: 'dark',
  tokens: {
    // Surfaces — deep blue-black
    '--tack-bg': 'oklch(0.14 0.02 270)',
    '--tack-surface': 'oklch(0.18 0.02 270)',
    '--tack-surface-elevated': 'oklch(0.22 0.02 270)',
    '--tack-surface-overlay': 'oklch(0 0 0 / 0.5)',

    // Text
    '--tack-fg': 'oklch(0.96 0.005 270)',
    '--tack-fg-muted': 'oklch(0.7 0.01 270)',
    '--tack-fg-subtle': 'oklch(0.5 0.01 270)',
    '--tack-fg-on-accent': 'oklch(0.99 0 0)',

    // Borders
    '--tack-border': 'oklch(0.28 0.02 270)',
    '--tack-border-strong': 'oklch(0.38 0.02 270)',
    '--tack-border-focus': 'oklch(0.65 0.24 290)',

    // Accent — electric violet
    '--tack-accent': 'oklch(0.65 0.24 290)',
    '--tack-accent-strong': 'oklch(0.72 0.22 290)',
    '--tack-accent-soft': 'oklch(0.65 0.24 290 / 0.16)',

    // Semantic
    '--tack-success': 'oklch(0.7 0.18 145)',
    '--tack-warning': 'oklch(0.78 0.16 75)',
    '--tack-error': 'oklch(0.68 0.22 25)',
    '--tack-info': 'oklch(0.7 0.14 230)',

    // Spacing (shared across presets)
    '--tack-space-2xs': '2px',
    '--tack-space-xs': '4px',
    '--tack-space-sm': '8px',
    '--tack-space-md': '12px',
    '--tack-space-lg': '16px',
    '--tack-space-xl': '24px',
    '--tack-space-2xl': '32px',
    '--tack-space-3xl': '48px',
    '--tack-space-4xl': '64px',

    // Radii — slightly tighter for editorial feel
    '--tack-radius-sm': '3px',
    '--tack-radius-md': '5px',
    '--tack-radius-lg': '8px',
    '--tack-radius-xl': '12px',
    '--tack-radius-full': '9999px',

    // Shadows — deeper for the dark surface
    '--tack-shadow-sm': '0 1px 2px oklch(0 0 0 / 0.4)',
    '--tack-shadow-md':
      '0 4px 12px oklch(0 0 0 / 0.5), 0 1px 3px oklch(0 0 0 / 0.4)',
    '--tack-shadow-lg':
      '0 24px 64px oklch(0 0 0 / 0.6), 0 4px 12px oklch(0 0 0 / 0.4)',

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
