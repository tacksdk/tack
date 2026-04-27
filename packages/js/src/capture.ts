// Screenshot capture — lazy-loaded so the main bundle stays under cap.
//
// Uses `html-to-image`'s toPng() to snapshot a DOM subtree as a base64 PNG
// data URL. The lib is heavy (~25 KB gzipped + canvas glue), so we resolve
// it on first call and cache the resolved module. Bundle regression test in
// __tests__/bundle.test.ts asserts the static import closure of
// `dist/index.mjs` does NOT contain `html-to-image` — it appears only inside
// a runtime `import("html-to-image")` call left by tsup as-is (because the
// package is in `dependencies`, marking it external).
//
// The capture path is also indirected through `state.config.captureScreenshot`
// (see widget.ts), so this module is only loaded when the consumer actually
// uses the default html-to-image path. A custom function shortcuts capture
// entirely and never triggers the dynamic import.

let _htmlToImage: typeof import('html-to-image') | null = null

async function loadHtmlToImage(): Promise<typeof import('html-to-image')> {
  if (_htmlToImage) return _htmlToImage
  // Dynamic import keeps the static import closure of index.mjs free of the
  // ~25 KB of html-to-image code. The `import()` call is left as-is by tsup
  // because html-to-image is declared in `dependencies`.
  _htmlToImage = await import('html-to-image')
  return _htmlToImage
}

/**
 * Snapshot the given element subtree as a `data:image/png;base64,...` URL.
 * Cross-origin images that taint the canvas will cause the underlying lib to
 * throw; the caller (widget.ts) maps that to the `capture_failed` FSM state
 * with a "Screenshot unavailable" message and proceeds without the screenshot.
 *
 * Note: at canvas-paint time, the source element must be visible. The widget
 * coordinates the brief visibility hide/restore around the call.
 */
export async function capture(target: Element): Promise<string> {
  const lib = await loadHtmlToImage()
  // toPng pixel-ratio defaults to devicePixelRatio. Cap at 2 so a 4K monitor
  // user doesn't ship a 16 MP base64 blob to our backend.
  const pixelRatio =
    typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
      ? Math.min(window.devicePixelRatio, 2)
      : 1
  return lib.toPng(target as HTMLElement, {
    cacheBust: true,
    pixelRatio,
  })
}
