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

// The published cap for the main bundle. Bumped from 15 KB → 17 KB on the
// rating + appVersion + console-capture (lazy) addition. Console-capture
// itself is lazy-loaded (verified below) and does NOT contribute to this
// number. The +2 KB pays for the rating UI builder, ratingOptionsFor()
// option table, the lazy-import orchestration, and the expanded option
// surface (TackWidgetConfig grew ~12 fields).
const MAIN_BUNDLE_GZIP_LIMIT = 17 * 1024
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

describe('bundle: console-capture lazy load (ESM)', () => {
  // Console capture is lazy-loaded so consumers who don't enable
  // `captureConsole` don't pay for the safe serializer + wrapper plumbing
  // (~2 KB gzipped). The lazy-load contract is verified for the ESM bundle
  // (modern toolchains pick this up via `import` resolution).
  //
  // CJS is intentionally NOT enforced here: tsup cannot code-split CJS
  // dynamic imports into separate files, so the module gets inlined into
  // index.js. Node's runtime `import()` still works lazily at the JS-engine
  // level there, but the bytes are in the bundle either way. Modern
  // bundlers (webpack/rollup/esbuild/vite) all consume the ESM entry, which
  // IS code-split — see the chunk file enumerated in dist/.
  it('index.mjs does not statically import the console-capture module', () => {
    const file = resolve(DIST, 'index.mjs')
    expect(existsSync(file)).toBe(true)
    const src = readFileSync(file, 'utf8')
    expect(src).not.toMatch(/from\s*["']\.\/console-capture["']/)
    // The safe-serializer internals should NOT appear in the main chunk —
    // they live in the lazy chunk only. Sentinel: the `MAX_DOM_HTML_BYTES`
    // constant is unique to console-capture.ts.
    expect(src).not.toContain('MAX_DOM_HTML_BYTES')
  })
})

describe('bundle: html-to-image lazy load', () => {
  // S4 promise: the screenshot capture path is lazy-loaded so the main bundle
  // doesn't carry the ~25 KB cost of html-to-image. We verify both shapes:
  //   1. Source code of html-to-image (signature strings) does not appear in
  //      the main bundle's static import closure.
  //   2. Reference to "html-to-image" appears only inside a dynamic import()
  //      (or as a comment) — not as `from "html-to-image"` or
  //      `require("html-to-image")` at top level.
  // Drift here means either the dep got bundled in or the dynamic-import was
  // accidentally rewritten to a static one — either way the size budget falls
  // over.
  for (const name of ['index.mjs', 'index.js']) {
    it(`${name} does not statically import html-to-image`, () => {
      const file = resolve(DIST, name)
      expect(existsSync(file)).toBe(true)
      const src = readFileSync(file, 'utf8')
      // Forbidden static-import shapes
      expect(src).not.toMatch(/from\s*["']html-to-image["']/)
      expect(src).not.toMatch(/require\(\s*["']html-to-image["']\s*\)/)
      // It's fine — and expected — that the string appears inside a dynamic
      // `import("html-to-image")` call. Sanity-check that case by allowing
      // it but ensuring the string is wrapped in `import(...)` if present.
      const matches = src.match(/html-to-image/g) ?? []
      for (const m of matches) {
        // Each occurrence must be (a) inside a comment line, or (b) inside
        // an `import("...")` dynamic call. Anything else means it leaked.
        const idx = src.indexOf(m)
        const lineStart = src.lastIndexOf('\n', idx) + 1
        const lineEnd = src.indexOf('\n', idx)
        const line = src.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
        const isComment = line.trim().startsWith('//') || line.trim().startsWith('*')
        const isDynamic = /import\s*\(\s*["']html-to-image["']/.test(line)
        expect(
          isComment || isDynamic,
          `Static reference to html-to-image at ${name}: ${line}`,
        ).toBe(true)
      }
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
