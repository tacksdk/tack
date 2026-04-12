# Tack

Embeddable in-app feedback for web apps. Drop a widget into any React app in minutes — submissions flow to your [Tack dashboard](https://usetack.dev).

## Packages

| Package | Description |
|---|---|
| [`@tacksdk/js`](./packages/js) | Vanilla JS client — framework-agnostic core |
| [`@tacksdk/react`](./packages/react) | React component (`<TackWidget />`) built on `@tacksdk/js` |

## Quick start

```bash
npm install @tacksdk/react
```

```tsx
import { init, TackWidget } from '@tacksdk/react'

// Call once at app startup
init({ apiKey: 'your_project_api_key' })

// Drop anywhere in your component tree
export function App() {
  return (
    <>
      <YourApp />
      <TackWidget />
    </>
  )
}
```

Get your API key from [usetack.dev](https://usetack.dev).

## Vanilla JS

```bash
npm install @tacksdk/js
```

```ts
import { init, submit } from '@tacksdk/js'

init({ apiKey: 'your_project_api_key' })

await submit({
  message: 'The export button is broken',
  userId: 'user_123',          // optional
  meta: { plan: 'pro' },       // optional
})
```

## API

### `@tacksdk/js`

#### `init(config)`

Must be called once before submitting feedback.

| Option | Type | Required | Description |
|---|---|---|---|
| `apiKey` | `string` | ✓ | Project API key from the Tack dashboard |
| `apiUrl` | `string` | | Override the API endpoint (defaults to `https://api.usetack.dev`) |

#### `submit(payload)`

Submits a feedback entry. Automatically attaches `url` and `userAgent`.

| Option | Type | Required | Description |
|---|---|---|---|
| `message` | `string` | ✓ | Feedback text |
| `userId` | `string` | | Identify the submitting user |
| `meta` | `object` | | Any additional key/value metadata |

### `@tacksdk/react`

#### `<TackWidget />`

| Prop | Type | Default | Description |
|---|---|---|---|
| `label` | `string` | `"Feedback"` | Trigger button label |
| `userId` | `string` | | Passed to every submission |
| `meta` | `object` | | Extra metadata on every submission |
| `onSubmit` | `() => void` | | Called after successful submission |
| `onError` | `(err: Error) => void` | | Called on error |

## Contributing

```bash
git clone https://github.com/lucascaro/tack
cd tack
pnpm install
pnpm setup        # install git hooks
pnpm dev          # watch mode for all packages
```

### Repo structure

```
packages/
  js/       @tacksdk/js    — vanilla JS client
  react/    @tacksdk/react — React component
```

### Releasing

This repo uses [Changesets](https://github.com/changesets/changesets).

```bash
pnpm changeset        # describe your change
pnpm version          # bump versions + update changelogs
pnpm release          # build + publish to npm
```

## License

MIT
