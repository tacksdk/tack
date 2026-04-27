// Default preset — refined, technical. Tack green accent. The baseline.
//
// Why the tokens object is empty: scheme is "auto" (follow OS pref). For
// "auto" presets, applying tokens inline would beat the bundled
// stylesheet's @media (prefers-color-scheme: dark) rule and pin the dialog
// to one mode, defeating the auto behavior. The bundled stylesheet already
// has full light/dark coverage with @media — that IS the default look.
//
// Forced-scheme presets (midnight, paper) DO ship full token sets inline
// because they explicitly override the auto behavior. See DESIGN.md
// "Adding a new preset" — rule #5 ("set all 30 tokens") applies to
// forced-scheme presets only. Auto-scheme presets defer color to the CSS.

import type { TackThemePreset } from '../types'

export const defaultPreset: TackThemePreset = {
  name: 'default',
  scheme: 'auto',
  tokens: {},
}
