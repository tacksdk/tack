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
| `onSubmit` | `(result) => void` | | Called after a successful submit. |
| `onError` | `(err: TackError) => void` | | Called on submit failure. |
| `onOpen` | `() => void` | | Called when the dialog opens. |
| `onClose` | `() => void` | | Called when the dialog closes. |

`Tack.init()` returns a handle: `{ open, close, toggle, isOpen, destroy, update }`.

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
