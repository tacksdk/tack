import { execSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { describe, expect, it, beforeAll } from 'vitest'
import { dirname, resolve } from 'node:path'

// Asserts the public bundle promises hold:
//   1. `@tacksdk/js/headless` does NOT statically include any widget code,
//      transitively. tsup hoists shared deps into chunk-XXX files; scanning
//      only headless.mjs would miss leaks in those chunks.
//   2. Main bundle is under the published budget when gzipped.
//   3. Both ESM (.mjs) and CJS (.js) variants are checked — `require(...)`
//      consumers must get the same guarantees as `import`.
//
// This is the contract that prevents lazy-load claims from rotting silently
// as new code lands. If a future PR imports widget.ts from headless.ts, this
// test fails the build instead of bloating every consumer.

const PKG_DIR = resolve(__dirname, '..', '..')
const DIST = resolve(PKG_DIR, 'dist')

// Strings that uniquely identify widget/launcher code paths. If any of these
// land in the headless chunk closure, tree-shaking failed.
const WIDGET_FORBIDDEN = [
  "createElement('dialog')",
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
const HEADLESS_TRANSITIVE_GZIP_LIMIT = 5 * 1024

function ensureBuilt() {
  if (existsSync(resolve(DIST, 'headless.mjs')) && existsSync(resolve(DIST, 'index.mjs'))) return
  // Build only this package, not the workspace.
  execSync('pnpm build', { cwd: PKG_DIR, stdio: 'inherit' })
}

beforeAll(() => {
  ensureBuilt()
}, 60_000)

/**
 * Walk the transitive static-import closure starting from `entry`, returning
 * the absolute paths of all reachable bundle files. Handles tsup's chunk
 * hoisting — `headless.mjs` typically imports `./chunk-XXX.mjs`, which we
 * follow recursively so widget code hidden in a shared chunk is detected.
 */
function transitiveImports(entry: string, importPattern: RegExp): string[] {
  const seen = new Set<string>()
  const queue: string[] = [entry]
  while (queue.length) {
    const file = queue.shift()!
    if (seen.has(file)) continue
    if (!existsSync(file)) continue
    seen.add(file)
    const src = readFileSync(file, 'utf8')
    const dir = dirname(file)
    for (const match of src.matchAll(importPattern)) {
      const spec = match[1]
      if (!spec.startsWith('.')) continue
      queue.push(resolve(dir, spec))
    }
  }
  return [...seen]
}

const ESM_IMPORT = /(?:from|import)\s*\(?["']([^"']+)["']\)?/g
const CJS_REQUIRE = /require\s*\(\s*["']([^"']+)["']\s*\)/g

interface Variant {
  name: string
  entry: string
  pattern: RegExp
}

const VARIANTS: Variant[] = [
  { name: 'ESM (headless.mjs)', entry: resolve(DIST, 'headless.mjs'), pattern: ESM_IMPORT },
  { name: 'CJS (headless.js)', entry: resolve(DIST, 'headless.js'), pattern: CJS_REQUIRE },
]

describe('bundle: headless tree-shake contract', () => {
  for (const variant of VARIANTS) {
    describe(variant.name, () => {
      it('entry exists after build', () => {
        expect(existsSync(variant.entry)).toBe(true)
      })

      it('transitive closure contains no widget/launcher code', () => {
        const files = transitiveImports(variant.entry, variant.pattern)
        for (const file of files) {
          const src = readFileSync(file, 'utf8')
          for (const forbidden of WIDGET_FORBIDDEN) {
            expect(
              src,
              `Widget code "${forbidden}" leaked into ${variant.name} via ${file}. ` +
                'Check that headless.ts does not transitively import widget.ts or launcher.ts.',
            ).not.toContain(forbidden)
          }
        }
      })

      it('transitive closure gzip size under cap', () => {
        const files = transitiveImports(variant.entry, variant.pattern)
        // Concatenate then gzip — single-stream compression matches the worst
        // case a consumer sees (one network request loading everything).
        const combined = Buffer.concat(files.map((f) => readFileSync(f)))
        const gzipped = gzipSync(combined).length
        expect(
          gzipped,
          `${variant.name} transitive closure is ${gzipped} bytes gzipped ` +
            `across ${files.length} files (cap: ${HEADLESS_TRANSITIVE_GZIP_LIMIT}).`,
        ).toBeLessThan(HEADLESS_TRANSITIVE_GZIP_LIMIT)
      })
    })
  }
})

describe('bundle: main chunk size', () => {
  it('index.mjs gzip size under cap', () => {
    const indexMjs = resolve(DIST, 'index.mjs')
    const buf = readFileSync(indexMjs)
    const gzipped = gzipSync(buf).length
    const raw = statSync(indexMjs).size
    expect(
      gzipped,
      `Main bundle is ${gzipped} bytes gzipped / ${raw} bytes raw (cap: ${MAIN_BUNDLE_GZIP_LIMIT}). ` +
        'Add lazy imports for new heavy deps before raising the cap.',
    ).toBeLessThan(MAIN_BUNDLE_GZIP_LIMIT)
  })
})
