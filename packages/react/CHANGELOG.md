# @tacksdk/react

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
