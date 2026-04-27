---
'@tacksdk/js': minor
'@tacksdk/react': minor
---

feat(sdk): rating UI + appVersion + lazy console capture

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
