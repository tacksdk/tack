// Public surface for `@tacksdk/js`. The vanilla widget core is the only
// stateful entry point — there is no module-level init/submit. For headless
// posting (no DOM), import from `@tacksdk/js/headless`.
//
// History: pre-0.3 shipped a module-level `init()` + `submit()` here. That
// surface was removed in S8 (slice C) — it conflicted with multi-instance
// use, leaked state across tests, and had no React caller. Migrate to either
// `Tack.init({ projectId })` (widget) or `submit({ projectId, body })` from
// `@tacksdk/js/headless` (headless).

export * from './types'
export { TackError, docUrl } from './errors'
export { Tack } from './widget'
export type {
  TackWidgetConfig,
  TackHandle,
  CaptureConsoleConfig,
  ConsoleEntry,
} from './widget'
// Test-only affordance for cross-package tests (e.g. @tacksdk/react). Closed
// shadow roots cannot be reached via host.shadowRoot, so this WeakMap is the
// test-only path back in. The double underscore signals "not public API" the
// way Python __dunder__ does. Production callers MUST NOT use it.
export { __testShadowRoots } from './widget'
export { TackLauncher } from './launcher'
export type {
  TackLauncherConfig,
  TackLauncherHandle,
  TackLauncherPosition,
  TackLauncherVariant,
} from './launcher'
export { SDK_VERSION } from './transport'
export { bindHotkey, parseHotkey, matchHotkey } from './hotkey'
export type {
  ParsedHotkey,
  ParseHotkeyOptions,
  BindHotkeyOptions,
} from './hotkey'
// `submit()` is intentionally NOT re-exported here. Use the dedicated subpath
// `@tacksdk/js/headless` so bundlers can tree-shake the widget out for
// headless-only callers. This keeps the bundle-size contract (see
// __tests__/bundle.test.ts) honest: a `from '@tacksdk/js'` consumer shouldn't
// be able to accidentally pull widget code into a headless app.
