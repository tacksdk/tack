// Theme preset registry.
//
// Three presets ship in v1: `default`, `midnight`, `paper`. `terminal` and
// `mono` are deferred per DESIGN.md anti-bloat rule until a real customer asks.
//
// Architecture note: presets live as static objects, NOT lazy imports. At
// ~750 bytes gzipped for the three combined this is well under the 15KB
// bundle budget. If a future `@tacksdk/themes` package adds presets, it can
// register them via the same `TackThemePreset` shape without modifying core —
// the registry below is the seam.

import type { TackThemePreset } from '../types'
import { defaultPreset } from './default'
import { midnightPreset } from './midnight'
import { paperPreset } from './paper'

/** All built-in preset names. Kept in sync with `BUILTIN_PRESETS` below. */
export type BuiltinPresetName = 'default' | 'midnight' | 'paper'

/** Built-in preset registry, keyed by preset name. */
export const BUILTIN_PRESETS: Record<BuiltinPresetName, TackThemePreset> = {
  default: defaultPreset,
  midnight: midnightPreset,
  paper: paperPreset,
}

export { defaultPreset, midnightPreset, paperPreset }

/**
 * Resolve a preset name or object to a TackThemePreset.
 *
 * - String matching `BuiltinPresetName` returns the registered preset.
 * - A `TackThemePreset` object passes through unchanged (consumer-supplied).
 * - Anything else returns `null` (caller falls through to widget defaults).
 */
export function resolvePreset(
  preset: BuiltinPresetName | TackThemePreset | undefined,
): TackThemePreset | null {
  if (!preset) return null
  if (typeof preset === 'string') {
    return BUILTIN_PRESETS[preset] ?? null
  }
  // Consumer-supplied object — accept if it has a tokens record. Looser
  // validation than a runtime schema check; TS catches the shape at the call
  // site for typed consumers.
  if (
    typeof preset === 'object' &&
    preset !== null &&
    typeof preset.tokens === 'object' &&
    !Array.isArray(preset.tokens)
  ) {
    return preset
  }
  return null
}
