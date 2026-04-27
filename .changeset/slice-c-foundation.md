---
'@tacksdk/js': minor
'@tacksdk/react': minor
---

feat(sdk): closed shadow DOM, three theme presets, full Layer 2 tokens, mobile bottom-sheet

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
