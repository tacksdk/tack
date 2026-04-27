# @tacksdk/js

Vanilla JS / TS core for [Tack](https://tacksdk.com) — embeddable in-app feedback. Framework-agnostic. No dependencies. ~12 KB gzipped (widget); the headless subpath is ~3 KB.

## Install

```bash
npm install @tacksdk/js
```

## Quick start (widget)

```ts
import { Tack } from '@tacksdk/js'

const handle = Tack.init({ projectId: 'proj_your_project_id' })

document.querySelector('#feedback-button')!
  .addEventListener('click', () => handle.open())
```

The widget mounts inside a closed shadow root, so host-page CSS can't bleed in. The dialog uses the native `<dialog>` element for top-layer rendering and focus trap.

## Floating launcher

`TackLauncher.mount()` ships a floating button that handles open/close for you:

```ts
import { TackLauncher } from '@tacksdk/js'

TackLauncher.mount({
  projectId: 'proj_your_project_id',
  position: 'bottom-right',
  variant: 'circle',
})
```

## Headless

For server-side or non-DOM contexts (or if you have your own UI):

```ts
import { submit } from '@tacksdk/js/headless'

await submit({
  projectId: 'proj_your_project_id',
  body: 'The export button is broken',
})
```

The `/headless` subpath does NOT include the widget — bundlers tree-shake the DOM code out.

## `Tack.init(config)` options

| Option | Type | Default | Description |
|---|---|---|---|
| `projectId` | `string` | — | **Required.** Public project id (`proj_...`). |
| `endpoint` | `string` | `https://tacksdk.com` | Override the API endpoint. |
| `user` | `TackUser` | | Default user attached to every submission. |
| `metadata` | `object` | | Default metadata attached to every submission. |
| `container` | `HTMLElement` | `document.body` | Where the dialog's shadow host mounts. |
| `preset` | `'default' \| 'midnight' \| 'paper' \| TackThemePreset` | `'default'` | Curated theme bundle (~30 design tokens). |
| `theme` | `'auto' \| 'light' \| 'dark'` | `'dark'` | Color scheme (legacy — prefer `preset`). |
| `injectStyles` | `boolean` | `true` | When `false`, host owns all styling. |
| `title` | `string` | `'Send feedback'` | Dialog title. |
| `submitLabel` | `string` | `'Send'` | Submit button label. |
| `cancelLabel` | `string` | `'Cancel'` | Cancel button label. |
| `placeholder` | `string` | `'What can we improve?'` | Textarea placeholder. |
| `hotkey` | `string` | | Toggle shortcut, e.g. `'mod+alt+f'`. |
| `placement` | `'bottom-right' \| 'bottom-left' \| 'top-right' \| 'top-left' \| 'custom'` | `'bottom-right'` | Launcher placement (no effect when `trigger: 'none'`). |
| `trigger` | `'auto' \| 'none'` | `'auto'` | `'none'` skips the launcher; host calls `handle.open()`. |
| `zIndex` | `number` | `2147483600` | Dialog stacking context. |
| `modal` | `boolean` | `true` | `false` calls `dialog.show()` (no focus trap, no backdrop). |
| `scrollLock` | `boolean` | `true` | Lock body scroll while the dialog is open. |
| `debug` | `boolean` | `false` | Verbose `console.debug` lifecycle logs. |
| `fetch` | `typeof fetch` | `globalThis.fetch` | Inject a custom fetch (for proxies, tracing). |
| `headers` | `Record<string, string>` | | Extra request headers (cannot override `X-Tack-SDK-Version`). |
| `captureScreenshot` | `false \| ((el: Element) => Promise<string>)` | enabled | Renders an "Add screenshot" button in the dialog. Clicking captures and attaches the host page; clicking again removes it. `false` removes the button entirely; a function overrides the default html-to-image path. The capture module is lazy-loaded only on first click. |
| `appVersion` | `string` | | Host app version, e.g. `"1.4.2"` or a git SHA. Sent on every submission so feedback can be bucketed by release. See [Bundler patterns](#appversion-bundler-patterns). |
| `rating` | `false \| 'thumbs' \| 'stars' \| 'emoji'` | `false` | Rating UI variant. When set, renders a row of buttons above the textarea; sends the selected value as `rating` and auto-attaches `metadata.ratingScale` so the dashboard can label the value unambiguously (4 of 5 stars vs 4 of 4 emoji). |
| `captureConsole` | `boolean \| CaptureConsoleConfig` | `false` | Capture host console output and ship it in `metadata.console` on submit. **Privacy footgun — read [Console capture](#console-capture-privacy) before enabling.** |
| `onSubmit` | `(result, request) => void` | | Called after a successful submit. Receives both the server response and the full request payload (handy for firing your own analytics on rating/screenshot inclusion). |
| `onError` | `(err: TackError) => void` | | Called on submit failure. |
| `onOpen` | `() => void` | | Called when the dialog opens. |
| `onClose` | `() => void` | | Called when the dialog closes. |

`Tack.init()` returns a handle: `{ open, close, toggle, isOpen, destroy, update, getCapturedConsole }`.

### `appVersion` bundler patterns

Most apps surface their version through the bundler's environment plumbing. Pick the one that matches yours:

```tsx
// Next.js
<TackLauncher appVersion={process.env.NEXT_PUBLIC_APP_VERSION} />

// Vite
<TackLauncher appVersion={import.meta.env.VITE_APP_VERSION} />

// webpack / rollup with DefinePlugin
declare const __APP_VERSION__: string
<TackLauncher appVersion={__APP_VERSION__} />
```

The dashboard treats this as an opaque string. SemVer, git SHAs, datestamps — anything that uniquely identifies a release works.

### Console capture (privacy)

> ⚠️ **Privacy warning.** When `captureConsole` is enabled, the SDK ships your app's console output (errors, warnings, optionally info/log) to your Tack dashboard alongside the submission. This often includes user-visible PII: emails, IDs, request bodies, debug dumps. **Test in dev mode before enabling in production.**

Inspect the buffer at any time:

```ts
const handle = Tack.init({ projectId: '...', captureConsole: true })
// ... user does stuff, errors happen ...
console.log(handle.getCapturedConsole())
// → [{ level: 'error', ts: 1745... , msg: 'Failed to fetch /api/...' }, ...]
```

Configuration:

```ts
captureConsole: true
// Same as: { levels: ['error', 'warn'], maxEntries: 20 }

captureConsole: { levels: ['error', 'warn', 'info'], maxEntries: 50 }
```

The capture module is lazy-loaded only when `captureConsole` is set — there's no bundle cost for consumers who leave it off. Each widget instance has its own buffer (no cross-widget leakage). The serializer is hardened against circular references, errors, DOM nodes, and oversized payloads — it will never throw and break your console.

If your app initializes Sentry or another error monitor AFTER the Tack widget mounts, the wrapper-identity check on uninstall preserves their patch — Tack won't restore over them.

## Errors

Both the widget's `onError` and headless `submit()` surface a `TackError`:

```ts
class TackError extends Error {
  type: 'invalid_request' | 'unauthorized' | 'forbidden' | 'not_found'
       | 'payload_too_large' | 'rate_limited' | 'internal_error'
       | 'network_error'
  docUrl: string
  status: number | null
}
```

Each `type` has a docs page at [tacksdk.com/docs/errors#&lt;type&gt;](https://tacksdk.com/docs/errors).

## Stability

Pre-1.0 — pin your version. See [STABILITY.md](https://github.com/tacksdk/tack/blob/main/STABILITY.md) before upgrading.

## License

MIT
