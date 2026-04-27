---
'@tacksdk/js': minor
'@tacksdk/react': minor
---

feat(sdk): slice C — options surface, screenshot capture, font safety + S8 cleanup

**Breaking (pre-1.0).** The legacy module-level `init`, `submit`, `reset`, `getConfig` exports from `@tacksdk/js` and `@tacksdk/react` are removed. Migrate:

- Widget callers: `Tack.init({ projectId })` (already the documented surface)
- Headless callers: `import { submit } from '@tacksdk/js/headless'` and pass `{ projectId, body }` per call

The removal eliminates module-level state that broke multi-instance use and leaked across tests.

**New `Tack.init` options.** `placement`, `trigger`, `zIndex`, `modal`, `scrollLock`, `debug`, `fetch`, `headers`, `captureScreenshot`. See package READMEs.

**Screenshot capture.** Lazy-loaded via `html-to-image`; ships behind a checkbox in the dialog. `captureScreenshot: false` disables; `captureScreenshot: customFn` overrides. The lazy import keeps the main bundle under the existing 15 KB gzip cap.

**Font safety.** Widget host now detects unsafe host body fonts (display, script, all-caps) or missing-glyph fonts and falls back to a system stack with a one-shot `console.warn`. Skipped when `injectStyles: false`.

**OKLCH fallback.** Defends Safari 15.4-16.3 + older Chrome/Firefox via `@supports not (color: oklch(0 0 0))` block. No effect on modern browsers.
