# @tacksdk/js

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

## 0.1.1

### Patch Changes

- [#19](https://github.com/tacksdk/tack/pull/19) [`7a93d44`](https://github.com/tacksdk/tack/commit/7a93d44b4f877c98742e619633ea8c526ea0a728) Thanks [@lucascaro](https://github.com/lucascaro)! - Lock `@tacksdk/js` and `@tacksdk/react` versions in step.

  Adds `"fixed": [["@tacksdk/js", "@tacksdk/react"]]` to `.changeset/config.json` so both packages always ship the same version number, avoiding the drift that left them at `0.1.0` and `0.0.3` after the previous release. From here on, any bump to either package bumps both to the higher resulting version.

  This release realigns them at `0.1.1`. No code changes.

## 0.1.0

### Minor Changes

- [#16](https://github.com/tacksdk/tack/pull/16) [`a4b2305`](https://github.com/tacksdk/tack/commit/a4b230529f52a2ba3dfce3983ece0be39cc2f59d) Thanks [@lucascaro](https://github.com/lucascaro)! - Add `@tacksdk/js/headless` subpath export for DOM-free `submit()` calls, and bound every request with a 30s timeout in transport.

  **New: `@tacksdk/js/headless`**

  Pure-function `submit({ projectId, body, ... })` for callers that want to post feedback without mounting the widget. Zero DOM cost — the headless chunk does not import widget or launcher code. ~500 bytes gzipped.

  ```ts
  import { submit } from "@tacksdk/js/headless";

  await submit({
    projectId: "proj_abc",
    body: "Stale data on dashboard",
    user: { id: "usr_123" },
  });
  ```

  Unlike the legacy module-level `init()` + `submit()` in `@tacksdk/js`, the headless surface takes `projectId` inline on every call. No module state. Two consumers on the same page can submit to different projects without coordination.

  **New: 30-second request timeout**

  `postFeedback` now bounds every request with a 30s timeout (configurable via `timeoutMs` for tests). A hung fetch maps to `TackError(network_error)` with `"Request timed out after 30000ms"`. User-initiated abort still surfaces as `DOMException` `AbortError` — distinct from timeout — so callers can branch on cancel vs. failure.

  **Other:**

  - Bundle-size regression test asserts the headless chunk excludes widget code and the main chunk stays under 15KB gzipped. Locks the lazy-load claim against future drift.

## 0.0.2

### Patch Changes

- [`a90c8d5`](https://github.com/tacksdk/tack/commit/a90c8d5f28ed588e0266dea1bdb3495254174e85) Thanks [@lucascaro](https://github.com/lucascaro)! - Test pipeline
