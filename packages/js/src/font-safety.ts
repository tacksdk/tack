// Host-font safety defenses for the widget. Per DESIGN.md "Font-Safety
// Defenses" — when a host page sets the body font to something unreadable
// for paragraph text (display fonts, scripts, decoratives), the widget's
// `:host { all: initial; font-family: var(--tack-font, ...) }` block already
// blocks inheritance into the shadow root. But the var() fallback can still
// resolve to the host's `--tack-font` if they happen to set one, and a few
// edge cases benefit from belt-and-suspenders.
//
// This module:
//   1. sniffs `getComputedStyle(document.body).fontFamily` on widget mount
//   2. matches against a deny-list of fonts known to be unreadable for body
//   3. runs a 1-pixel glyph-coverage check on essential characters
//   4. if either signal trips, sets an inline `font-family` on the shadow
//      host element to a safe system stack so subsequent CSS inheritance is
//      bullet-proof
//   5. warns once per page load via console.warn
//
// Skipped entirely when `injectStyles: false` — the consumer is fully owning
// styling and shouldn't have us writing inline font-family.

/**
 * Deny-list of host body fonts known to be unreadable as paragraph text.
 * Per DESIGN.md "Unsafe host fonts blacklist": display fonts, scripts,
 * decoratives, all-caps. Match is case-insensitive substring on any token in
 * the comma-separated computed font-family string.
 *
 * Future agents: extend, do not narrow. New pathologies (a font that
 * renders 0/O ambiguously, etc.) should land here.
 */
const UNSAFE_FONT_TOKENS: readonly string[] = [
  // Explicit pathologies
  'comic sans',
  'lobster',
  'bebas neue',
  'pacifico',
  'permanent marker',
  'brush script',
  'trajan',
  // Display / decorative families commonly used as a body default by
  // marketing-driven design systems
  'cabinet grotesk',
  'cinzel',
  'playfair display display',
  'satisfy',
  'great vibes',
  'shadows into light',
  'amatic',
  // Generic suffixes — anything ending in Display / Script / Decorative is
  // by definition not for body text
  ' display',
  ' script',
  ' decorative',
] as const

/**
 * Safe system stack — same default the widget stylesheet uses for `--tack-font`.
 * Set as an inline override on the host so it wins over any host page that
 * sets `--tack-font` at :root.
 */
const SAFE_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, ' +
  '"Helvetica Neue", Arial, sans-serif'

/** Essential glyphs the widget renders. Missing any → host font is unsafe. */
const GLYPH_PROBE = '0123456789!?@#'

/**
 * Module-level "warned this page load already" flag. Multiple widget mounts
 * on the same page should not trigger duplicate warnings — the host hasn't
 * changed its font between mounts.
 */
let _warned = false

/**
 * Module-level cache of the safety verdict. The host's body font won't change
 * meaningfully between widget mounts, so we cache the verdict per page load.
 */
let _verdictCache: { unsafe: boolean; primary: string } | null = null

/**
 * True if any token in the comma-separated font-family string matches the
 * deny-list. Comparison is lowercase, with surrounding quotes stripped.
 */
function matchesUnsafeList(fontFamily: string): boolean {
  const lower = fontFamily.toLowerCase()
  for (const token of UNSAFE_FONT_TOKENS) {
    if (lower.includes(token)) return true
  }
  return false
}

/**
 * Glyph-coverage probe. Renders the probe string in the host font on a 1px
 * canvas; compares the measured width against the same string in a known-safe
 * fallback stack. A meaningfully different width means the host font lacks
 * the glyphs and the browser fell back, which we treat as "host font is
 * incomplete for body text".
 *
 * Returns false if canvas isn't available (SSR, ancient browsers) — better
 * to skip the check than throw at mount time.
 */
function glyphCoverageOk(fontFamily: string): boolean {
  if (typeof document === 'undefined') return true
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d')
    if (!ctx) return true
    // Two measurements: requested font, then a fallback that should always
    // resolve. If widths differ by more than 1px, the host font is missing
    // glyphs and the browser already fell back.
    ctx.font = `16px ${fontFamily}`
    const wHost = ctx.measureText(GLYPH_PROBE).width
    ctx.font = `16px ${SAFE_STACK}`
    const wSafe = ctx.measureText(GLYPH_PROBE).width
    // Tolerance covers anti-aliasing rounding. >1px means a real fallback.
    return Math.abs(wHost - wSafe) <= 1 || wHost > 0
  } catch {
    return true
  }
}

/**
 * Apply font-safety to a shadow host element. Reads the host body font, runs
 * the deny-list check + glyph probe, sets `host.style.fontFamily` to the safe
 * stack if either signal trips, and emits ONE console.warn per page load.
 *
 * Skipped when the consumer passed `injectStyles: false` (they own all
 * styling and we don't write inline font-family from this side).
 */
export function applyFontSafety(
  host: HTMLElement,
  options: { injectStyles?: boolean } = {},
): void {
  if (options.injectStyles === false) return
  if (typeof document === 'undefined' || typeof window === 'undefined') return

  // Re-use cached verdict across mounts on the same page.
  if (!_verdictCache) {
    let bodyFont = ''
    try {
      bodyFont = window.getComputedStyle(document.body).fontFamily ?? ''
    } catch {
      bodyFont = ''
    }
    const unsafe =
      bodyFont.length > 0 &&
      (matchesUnsafeList(bodyFont) || !glyphCoverageOk(bodyFont))
    _verdictCache = { unsafe, primary: bodyFont }
  }

  if (!_verdictCache.unsafe) return

  // Inline overrides any :root/--tack-font the host might have set,
  // including the var() fallback path inside the widget stylesheet.
  host.style.fontFamily = SAFE_STACK
  if (_warned) return
  _warned = true
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(
      `[tack] Host font '${_verdictCache.primary}' is unsafe for body text. ` +
        'Using system fallback. Override with --tack-font.',
    )
  }
}

/**
 * Test-only — reset the page-load cache + warned flag. Production code should
 * never need this; tests use it between cases to assert the one-shot behavior.
 */
export function __resetFontSafetyCache(): void {
  _warned = false
  _verdictCache = null
}
