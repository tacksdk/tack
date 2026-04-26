# @tacksdk/js

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
