# @tacksdk/react

React wrappers for [Tack](https://tacksdk.com) — embeddable in-app feedback. Wraps the vanilla [`@tacksdk/js`](https://www.npmjs.com/package/@tacksdk/js) core.

## Install

```bash
npm install @tacksdk/react
```

## Quick start

A floating launcher button — drop one anywhere in your tree:

```tsx
import { TackLauncher } from '@tacksdk/react'

export function App() {
  return (
    <>
      <YourApp />
      <TackLauncher projectId="proj_your_project_id" />
    </>
  )
}
```

## Components

### `<TackLauncher>`

Floating launcher button. Mounts into `document.body` (fixed-positioned) or inline into the document flow with `inline`.

| Prop | Type | Default | Description |
|---|---|---|---|
| `projectId` | `string` | — | **Required.** Public project id (`proj_...`). |
| `position` | `'bottom-right' \| 'bottom-left' \| 'top-right' \| 'top-left'` | `'bottom-right'` | Viewport corner. |
| `variant` | `'circle' \| 'pill'` | `'circle'` | Icon-only or icon + label. |
| `label` | `string` | `'Send feedback'` | Pill label and aria-label. |
| `offset` | `number` | `24` | Px from viewport edges. |
| `hideOnMobile` | `boolean` | `false` | Hide below 640px. |
| `inline` | `boolean` | `false` | Render in document flow instead of floating. |
| `theme` | `'auto' \| 'light' \| 'dark'` | `'dark'` | Color scheme. |
| `hotkey` | `string` | | Toggle shortcut (e.g. `'mod+alt+f'`). |
| `appVersion` | `string` | | Host app version. Use bundler-injected (`process.env.NEXT_PUBLIC_APP_VERSION`, `import.meta.env.VITE_APP_VERSION`, or a custom `__APP_VERSION__`). |
| `rating` | `false \| 'thumbs' \| 'stars' \| 'emoji'` | `false` | Rating UI variant. Sends `rating` + `metadata.ratingScale` on submit. |
| `captureConsole` | `boolean \| CaptureConsoleConfig` | `false` | Capture host console output. **Privacy footgun — see [@tacksdk/js README](https://www.npmjs.com/package/@tacksdk/js#console-capture-privacy) before enabling.** |
| `onSubmit` | `(request: TackSubmitRequest) => void` | | Called after successful submit; receives the request payload (rating, screenshot, console, etc.) so you can fire your own analytics without re-tracking state. |
| `onError` | `(err: TackError) => void` | | Called on submit failure. |

Plus all `<TackWidget>` props (`title`, `submitLabel`, `cancelLabel`, `placeholder`, `user`, `metadata`, `injectStyles`, ...).

### `<TackWidget>`

Renders a trigger button (in your light DOM) that opens a feedback dialog. Use this when you want the button styled by your design system; use `<TackLauncher>` for a turn-key floating launcher.

| Prop | Type | Default | Description |
|---|---|---|---|
| `projectId` | `string` | — | **Required.** Public project id. |
| `label` | `string` | `'Feedback'` | Trigger button text. |
| `className` | `string` | | Trigger button class. |
| `theme`, `title`, `submitLabel`, `cancelLabel`, `placeholder`, `user`, `metadata`, `hotkey`, `injectStyles`, `onSubmit`, `onError` | | | Same as the vanilla widget config. |

`user`, `metadata`, and callbacks update via `handle.update()` — no re-mount on identity change. Re-mount only happens for immutable-after-init props.

### `useTack(config)`

Render-nothing hook that returns the live `TackHandle` (or `null` until first effect). Use when you have your own trigger UI:

```tsx
import { useTack } from '@tacksdk/react'

function MyButton() {
  const tack = useTack({ projectId: 'proj_...' })
  return <button onClick={() => tack?.open()}>Send feedback</button>
}
```

## Errors

`onError` receives a typed `TackError`:

```ts
import { TackError } from '@tacksdk/react'
```

See [`@tacksdk/js`](https://www.npmjs.com/package/@tacksdk/js#errors) for the full error-type list and [tacksdk.com/docs/errors](https://tacksdk.com/docs/errors) for per-type guidance.

## Stability

Pre-1.0 — pin your version. See [STABILITY.md](https://github.com/tacksdk/tack/blob/main/STABILITY.md) before upgrading.

## License

MIT
