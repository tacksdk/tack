# @tacksdk/react

## 0.4.0

### Minor Changes

- [#38](https://github.com/tacksdk/tack/pull/38) [`7698bbd`](https://github.com/tacksdk/tack/commit/7698bbd8b7991b0a4808603d655c997b5cb408e0) Thanks [@lucascaro](https://github.com/lucascaro)! - Pass `preset` through `@tacksdk/react` wrappers.

  The vanilla SDK has accepted a `preset` option (built-in `'default' | 'midnight' | 'paper'` or a custom `TackThemePreset` object) since 0.3.0, but the React wrappers never forwarded it. React consumers had to drop down to the vanilla SDK to opt into themes.

  `<TackWidget>`, `useTack`, and `<TackLauncher>` now accept a `preset` prop:

  ```tsx
  <TackWidget projectId="proj_..." preset="midnight" />
  <TackLauncher projectId="proj_..." preset="midnight" />
  ```

  Custom preset objects work too:

  ```tsx
  const PRESET = { name: 'brand', scheme: 'light', tokens: { '--tack-accent': 'oklch(...)' } }
  // hoist or useMemo — inline objects re-mount the widget each render
  <TackWidget projectId="proj_..." preset={PRESET} />
  ```

  `BuiltinPresetName` and `TackThemePreset` are now re-exported from `@tacksdk/react` for typed preset references.

  Like `theme`, changing `preset` re-mounts the widget. JSDoc on the prop documents the inline-object footgun.

### Patch Changes

- Updated dependencies [[`7698bbd`](https://github.com/tacksdk/tack/commit/7698bbd8b7991b0a4808603d655c997b5cb408e0)]:
  - @tacksdk/js@0.4.0

## 0.3.2

### Patch Changes

- [#35](https://github.com/tacksdk/tack/pull/35) [`55fa1b0`](https://github.com/tacksdk/tack/commit/55fa1b0eb2ccdddd3d79178658a2e59cc2ff9763) Thanks [@lucascaro](https://github.com/lucascaro)! - Fix CORS preflight failure for cross-origin callers.

  The SDK now appends `?projectId=<id>` to the feedback request URL. The server's
  CORS preflight (OPTIONS) reads the project ID from the query string to look up
  the per-project `originAllowlist` — preflights have no body to read. Without
  this, every cross-origin call was blocked by the browser even when the origin
  was correctly allowlisted, because the preflight returned a 204 with no
  `Access-Control-Allow-Origin` header.

  Same-origin callers were not affected (browsers skip preflight for same-origin
  requests).

- Updated dependencies [[`55fa1b0`](https://github.com/tacksdk/tack/commit/55fa1b0eb2ccdddd3d79178658a2e59cc2ff9763)]:
  - @tacksdk/js@0.3.2

## 0.3.1

### Patch Changes

- [#33](https://github.com/tacksdk/tack/pull/33) [`ea33c61`](https://github.com/tacksdk/tack/commit/ea33c61733fa7bb57c295740c9ab1802b6aa1e6b) Thanks [@lucascaro](https://github.com/lucascaro)! - Fix exports map: drop unreachable `development` condition that pointed to
  `./src/*.ts` (not in the published tarball — `files: ["dist"]`) and broke
  Vite + any other bundler that resolves the `development` condition. Also
  reorder so `types` comes first per Node spec, ensuring TypeScript picks
  the right declaration before `import`/`require`. Adds a CI `pack-smoke`
  job that exercises the published tarball under Node CJS, Node ESM, and
  Vite build to prevent the bug class from recurring.
- Updated dependencies [[`ea33c61`](https://github.com/tacksdk/tack/commit/ea33c61733fa7bb57c295740c9ab1802b6aa1e6b)]:
  - @tacksdk/js@0.3.1

## 0.3.0

### Minor Changes

- [#27](https://github.com/tacksdk/tack/pull/27) [`d8263e7`](https://github.com/tacksdk/tack/commit/d8263e7f94ed7894a1d5bc0433683350e7199e1f) Thanks [@lucascaro](https://github.com/lucascaro)! - feat(sdk): rating UI + appVersion + lazy console capture

  Three new submission dimensions, all opt-in:

  **`appVersion`.** Host apps can tag every submission with their release version
  (`v1.4.2`, a git SHA, anything). Closes the half-shipped gap where the API
  field existed but the widget couldn't populate it.

  **`rating`.** Optional rating UI variant — `'thumbs'` (👍/👎, ±1), `'stars'`
  (1-5), or `'emoji'` (😞 😐 🙂 😄, 1-4). Renders above the textarea when set;
  sends `rating` + auto-attaches `metadata.ratingScale` so the dashboard can
  disambiguate (4 of 5 stars vs 4 of 4 emoji). Defaults to `false` — no UI,
  no behavior change for existing consumers.

  **`captureConsole` (lazy).** Patches host console at widget mount, buffers
  last N entries (default 20 of `error` + `warn`), ships in `metadata.console`
  on submit. Per-widget buffer (no cross-widget leakage). Wrapper-identity
  check on uninstall preserves late-initializing observability tools (Sentry,
  Datadog) — won't restore over their patches. Safe serializer handles
  cycles, errors, DOM nodes, depth limits, size caps; will never throw and
  break the host page. Inspect via `handle.getCapturedConsole()` before
  shipping in production. Lazy-loaded module — zero bundle cost when off.

  **`onSubmit(result, request)`.** Callback now receives both the server
  response and the full request payload so consumers can fire their own
  analytics on submission contents. Backwards compatible — existing
  `(result) => void` callers still work.

  **Bundle:** main bundle cap raised from 15 KB → 17 KB to accommodate the
  rating UI + lazy-load orchestration. Console-capture itself is in a
  separate chunk and contributes 0 bytes when unused.

  **Types:** `CaptureConsoleConfig` and `ConsoleEntry` are now exported.

- [#23](https://github.com/tacksdk/tack/pull/23) [`21dacb7`](https://github.com/tacksdk/tack/commit/21dacb7bdb7309e566c815f6bdd8f7bb0ba27e9a) Thanks [@lucascaro](https://github.com/lucascaro)! - feat(sdk): slice C — options surface, screenshot capture, font safety + S8 cleanup

  **Breaking (pre-1.0).** The legacy module-level `init`, `submit`, `reset`, `getConfig` exports from `@tacksdk/js` and `@tacksdk/react` are removed. Migrate:

  - Widget callers: `Tack.init({ projectId })` (already the documented surface)
  - Headless callers: `import { submit } from '@tacksdk/js/headless'` and pass `{ projectId, body }` per call

  The removal eliminates module-level state that broke multi-instance use and leaked across tests.

  **New `Tack.init` options.** `placement`, `trigger`, `zIndex`, `modal`, `scrollLock`, `debug`, `fetch`, `headers`, `captureScreenshot`. See package READMEs.

  **Screenshot capture.** Lazy-loaded via `html-to-image`; ships behind a checkbox in the dialog. `captureScreenshot: false` disables; `captureScreenshot: customFn` overrides. The lazy import keeps the main bundle under the existing 15 KB gzip cap.

  **Font safety.** Widget host now detects unsafe host body fonts (display, script, all-caps) or missing-glyph fonts and falls back to a system stack with a one-shot `console.warn`. Skipped when `injectStyles: false`.

  **OKLCH fallback.** Defends Safari 15.4-16.3 + older Chrome/Firefox via `@supports not (color: oklch(0 0 0))` block. No effect on modern browsers.

### Patch Changes

- Updated dependencies [[`d8263e7`](https://github.com/tacksdk/tack/commit/d8263e7f94ed7894a1d5bc0433683350e7199e1f), [`21dacb7`](https://github.com/tacksdk/tack/commit/21dacb7bdb7309e566c815f6bdd8f7bb0ba27e9a)]:
  - @tacksdk/js@0.3.0

## 0.2.0

### Minor Changes

- [#18](https://github.com/tacksdk/tack/pull/18) [`443c8de`](https://github.com/tacksdk/tack/commit/443c8dea1a80d25580b35926988ccccf87b82fbf) Thanks [@lucascaro](https://github.com/lucascaro)! - Add optional global keyboard shortcut (`hotkey` config) that toggles the
  feedback dialog. Combo syntax is string-based and case-insensitive (e.g.
  `'mod+alt+f'`); `mod` resolves to ⌘ on mac and ctrl elsewhere. Inputs,
  textareas, and contenteditable regions are skipped by default.

  Also exports `bindHotkey(handle, combo, opts)` for full control over scope,
  guards, and action (`'toggle' | 'open' | 'close'`), `parseHotkey()` for the
  pure parser, and `matchHotkey()` for the matcher. Adds `handle.toggle()` and
  `handle.isOpen()` to `TackHandle` and `TackLauncherHandle`.

  None of the existing API shape changes — `hotkey` defaults to undefined.

- [#22](https://github.com/tacksdk/tack/pull/22) [`97ad5da`](https://github.com/tacksdk/tack/commit/97ad5dacc9eeca6820083478be45f1bde0cd16c8) Thanks [@lucascaro](https://github.com/lucascaro)! - feat(sdk): closed shadow DOM, three theme presets, full Layer 2 tokens, mobile bottom-sheet

  Slice C foundation. The widget now mounts inside a closed shadow root
  (`<tack-widget-host>` + `mode: 'closed'`) with `:host { all: initial }` per
  DESIGN.md so host page CSS cannot leak into the dialog. Tests pierce via the
  exported `__testShadowRoots` WeakMap; production callers have no path in.

  Three named theme presets ship in `themes/`: `default` (Tack green, auto
  scheme), `midnight` (electric violet, forced dark), `paper` (warm rust on
  cream, forced light). Apply via `Tack.init({ preset: 'midnight' })` or pass
  a `TackThemePreset` object directly. Each preset bundles all ~30 Layer 2
  tokens explicitly so consumers get a fully-formed look without
  fall-through to defaults.

  Token system expanded from ~9 to ~30 names per DESIGN.md "Token Layers":
  surfaces (`--tack-bg`, `--tack-surface`, `--tack-surface-elevated`,
  `--tack-surface-overlay`), text (`--tack-fg-muted`, `--tack-fg-subtle`,
  `--tack-fg-on-accent`), borders (`--tack-border-strong`,
  `--tack-border-focus`), accent variants (`--tack-accent-strong`,
  `--tack-accent-soft`), semantic (`--tack-success`, `--tack-warning`,
  `--tack-error`, `--tack-info`), spacing scale (2xs–4xl), radii (sm/md/lg/
  xl/full), shadows (sm/md/lg), typography (`--tack-font-display`,
  `--tack-font-mono`, text size scale), motion (durations + easings),
  `--tack-tap-target`.

  Mobile bottom-sheet at `<640px`: full-bleed, slide-up from bottom edge with
  drag-handle affordance, safe-area-inset bottom padding for iOS home
  indicators, full-width buttons, reverse-stacked actions. Respects
  `prefers-reduced-motion` (disables the slide animation). Tap target is
  44px on coarse pointers, 36px on `pointer: fine` (mouse).

  Public-API breaking change in 0.0.x: legacy short-name tokens
  (`--tack-muted`, `--tack-accent-fg`, `--tack-shadow`, `--tack-radius`,
  `--tack-font-family`) renamed to Layer 2 names (`--tack-fg-muted`,
  `--tack-fg-on-accent`, `--tack-shadow-lg`, `--tack-radius-xl`,
  `--tack-font`). Hover state on submit button uses `--tack-accent-strong`
  instead of `filter: brightness(1.05)`. No backward-compat aliases — Tack
  is pre-1.0 per STABILITY.md.

### Patch Changes

- Updated dependencies [[`443c8de`](https://github.com/tacksdk/tack/commit/443c8dea1a80d25580b35926988ccccf87b82fbf), [`97ad5da`](https://github.com/tacksdk/tack/commit/97ad5dacc9eeca6820083478be45f1bde0cd16c8)]:
  - @tacksdk/js@0.2.0

## 0.1.1

### Patch Changes

- [#19](https://github.com/tacksdk/tack/pull/19) [`7a93d44`](https://github.com/tacksdk/tack/commit/7a93d44b4f877c98742e619633ea8c526ea0a728) Thanks [@lucascaro](https://github.com/lucascaro)! - Lock `@tacksdk/js` and `@tacksdk/react` versions in step.

  Adds `"fixed": [["@tacksdk/js", "@tacksdk/react"]]` to `.changeset/config.json` so both packages always ship the same version number, avoiding the drift that left them at `0.1.0` and `0.0.3` after the previous release. From here on, any bump to either package bumps both to the higher resulting version.

  This release realigns them at `0.1.1`. No code changes.

- Updated dependencies [[`7a93d44`](https://github.com/tacksdk/tack/commit/7a93d44b4f877c98742e619633ea8c526ea0a728)]:
  - @tacksdk/js@0.1.1

## 0.0.3

### Patch Changes

- Updated dependencies [[`a4b2305`](https://github.com/tacksdk/tack/commit/a4b230529f52a2ba3dfce3983ece0be39cc2f59d)]:
  - @tacksdk/js@0.1.0

## 0.0.2

### Patch Changes

- [`a90c8d5`](https://github.com/tacksdk/tack/commit/a90c8d5f28ed588e0266dea1bdb3495254174e85) Thanks [@lucascaro](https://github.com/lucascaro)! - Test pipeline

- Updated dependencies [[`a90c8d5`](https://github.com/tacksdk/tack/commit/a90c8d5f28ed588e0266dea1bdb3495254174e85)]:
  - @tacksdk/js@0.0.2
