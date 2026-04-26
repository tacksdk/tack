---
'@tacksdk/js': minor
---

Add `@tacksdk/js/headless` subpath export for DOM-free `submit()` calls, and bound every request with a 30s timeout in transport.

**New: `@tacksdk/js/headless`**

Pure-function `submit({ projectId, body, ... })` for callers that want to post feedback without mounting the widget. Zero DOM cost — the headless chunk does not import widget or launcher code. ~500 bytes gzipped.

```ts
import { submit } from '@tacksdk/js/headless'

await submit({
  projectId: 'proj_abc',
  body: 'Stale data on dashboard',
  user: { id: 'usr_123' },
})
```

Unlike the legacy module-level `init()` + `submit()` in `@tacksdk/js`, the headless surface takes `projectId` inline on every call. No module state. Two consumers on the same page can submit to different projects without coordination.

**New: 30-second request timeout**

`postFeedback` now bounds every request with a 30s timeout (configurable via `timeoutMs` for tests). A hung fetch maps to `TackError(network_error)` with `"Request timed out after 30000ms"`. User-initiated abort still surfaces as `DOMException` `AbortError` — distinct from timeout — so callers can branch on cancel vs. failure.

**Other:**

- Bundle-size regression test asserts the headless chunk excludes widget code and the main chunk stays under 15KB gzipped. Locks the lazy-load claim against future drift.
