import { execSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { describe, expect, it, beforeAll } from 'vitest'
import { resolve } from 'node:path'

// Asserts the public bundle promises hold:
//   1. `@tacksdk/js/headless` does NOT statically include any widget code
//      (no <dialog>, no shadow DOM mount, no theme CSS).
//   2. Main bundle is under the published budget when gzipped.
//
// This is the contract that prevents lazy-load claims from rotting silently
// as new code lands. If a future PR imports widget.ts from headless.ts, this
// test fails the build instead of bloating every consumer.

const PKG_DIR = resolve(__dirname, '..', '..')
const DIST = resolve(PKG_DIR, 'dist')
const HEADLESS_MJS = resolve(DIST, 'headless.mjs')
const INDEX_MJS = resolve(DIST, 'index.mjs')

// Strings that uniquely identify widget/launcher code paths. If any of these
// land in the headless chunk, tree-shaking failed.
const WIDGET_FORBIDDEN = [
  'createElement(\'dialog\')',
  'createElement("dialog")',
  'showModal',
  'ensureStylesInjected',
  'TACK_DEFAULT_CSS',
  'data-tack-widget',
  'TackLauncher',
]

// The published cap for the main bundle, excluding lazy-loaded screenshot
// capture. Plan target is <15KB gzipped pre-S2/S4. We allow headroom so
// slice C work doesn't trip this; tighten to the real cap once the FSM and
// options surface land.
const MAIN_BUNDLE_GZIP_LIMIT = 15 * 1024
const HEADLESS_GZIP_LIMIT = 5 * 1024

function ensureBuilt() {
  if (existsSync(HEADLESS_MJS) && existsSync(INDEX_MJS)) return
  // Build only this package, not the workspace. Avoids dragging the whole
  // monorepo into the test setup.
  execSync('pnpm build', { cwd: PKG_DIR, stdio: 'inherit' })
}

beforeAll(() => {
  ensureBuilt()
}, 60_000)

describe('bundle: headless tree-shake contract', () => {
  it('headless.mjs exists after build', () => {
    expect(existsSync(HEADLESS_MJS)).toBe(true)
  })

  it('headless.mjs contains no widget/launcher code', () => {
    const src = readFileSync(HEADLESS_MJS, 'utf8')
    for (const forbidden of WIDGET_FORBIDDEN) {
      expect(
        src,
        `Headless bundle leaked widget code: "${forbidden}". ` +
          'Check that headless.ts does not transitively import widget.ts or launcher.ts.',
      ).not.toContain(forbidden)
    }
  })

  it('headless.mjs gzip size under cap', () => {
    const buf = readFileSync(HEADLESS_MJS)
    const gzipped = gzipSync(buf).length
    expect(
      gzipped,
      `Headless bundle is ${gzipped} bytes gzipped (cap: ${HEADLESS_GZIP_LIMIT}).`,
    ).toBeLessThan(HEADLESS_GZIP_LIMIT)
  })
})

describe('bundle: main chunk size', () => {
  it('index.mjs gzip size under cap', () => {
    const buf = readFileSync(INDEX_MJS)
    const gzipped = gzipSync(buf).length
    const raw = statSync(INDEX_MJS).size
    expect(
      gzipped,
      `Main bundle is ${gzipped} bytes gzipped / ${raw} bytes raw (cap: ${MAIN_BUNDLE_GZIP_LIMIT}). ` +
        'Add lazy imports for new heavy deps before raising the cap.',
    ).toBeLessThan(MAIN_BUNDLE_GZIP_LIMIT)
  })
})
