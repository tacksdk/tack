# Tack

Embeddable in-app feedback for web apps. Drop a widget into any React app in minutes — submissions flow to your [Tack dashboard](https://tacksdk.com).

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
import { TackWidget } from '@tacksdk/react'

export function App() {
  return (
    <>
      <YourApp />
      <TackWidget projectId="proj_your_project_id" />
    </>
  )
}
```

Get your project id from [tacksdk.com](https://tacksdk.com).

## Vanilla JS

```bash
npm install @tacksdk/js
```

```ts
import { init, submit } from '@tacksdk/js'

init({ projectId: 'proj_your_project_id' })

await submit({
  body: 'The export button is broken',
  user: { id: 'user_123', email: 'ada@example.com' },
  metadata: { plan: 'pro' },
})
```

## API

### `@tacksdk/js`

#### `init(config)`

Must be called once before submitting feedback.

| Option | Type | Required | Description |
|---|---|---|---|
| `projectId` | `string` | ✓ | Public project id from the Tack dashboard (`proj_...`) |
| `endpoint` | `string` | | Override the API endpoint (defaults to `https://api.tacksdk.com`) |
| `user` | `TackUser` | | Default user attached to every submission |
| `metadata` | `object` | | Default metadata attached to every submission |

#### `submit(input)`

Submits a feedback entry. Automatically attaches `url`, `userAgent`, and `viewport` unless overridden. Returns `{ id, url, created_at }`.

| Option | Type | Required | Description |
|---|---|---|---|
| `body` | `string` | ✓ | Feedback text |
| `rating` | `number` | | Optional rating |
| `screenshot` | `string` | | Base64-encoded screenshot (data URL) |
| `user` | `TackUser` | | Overrides the default user |
| `metadata` | `object` | | Overrides the default metadata |
| `idempotencyKey` | `string` | | Dedup key (auto-generated if omitted) |

Errors throw a `TackError` with `type`, `docUrl`, and `status`.

### `@tacksdk/react`

#### `<TackWidget />`

| Prop | Type | Default | Description |
|---|---|---|---|
| `projectId` | `string` | — | Required. Public project id (`proj_...`) |
| `endpoint` | `string` | | Override the API endpoint |
| `label` | `string` | `"Feedback"` | Trigger button label |
| `user` | `TackUser` | | Passed to every submission |
| `metadata` | `object` | | Extra metadata on every submission |
| `onSubmit` | `() => void` | | Called after successful submission |
| `onError` | `(err: TackError \| Error) => void` | | Called on error |

## Contributing

```bash
git clone https://github.com/tacksdk/tack
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

This repo uses [Changesets](https://github.com/changesets/changesets). CI (`.github/workflows/release.yml`) opens a "Version Packages" PR on merge to `main`; merging that PR publishes to npm with provenance.

```bash
pnpm changeset        # describe your change
```

## License

MIT
