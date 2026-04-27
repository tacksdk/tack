# Tack

Embeddable in-app feedback for web apps. Drop a widget into any React or vanilla JS app in minutes — submissions flow to your [Tack dashboard](https://tacksdk.com).

## Packages

| Package | Description |
|---|---|
| [`@tacksdk/js`](./packages/js) | Vanilla JS / TS core — `Tack.init()` widget, `TackLauncher.mount()` floating button, `submit()` headless |
| [`@tacksdk/react`](./packages/react) | React wrappers — `<TackWidget>`, `<TackLauncher>`, `useTack()` |

## Quick start (React)

```bash
npm install @tacksdk/react
```

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

## Quick start (vanilla)

```bash
npm install @tacksdk/js
```

```ts
import { Tack } from '@tacksdk/js'

const handle = Tack.init({ projectId: 'proj_your_project_id' })

document.querySelector('#feedback-button')!
  .addEventListener('click', () => handle.open())
```

Get your project id from [tacksdk.com](https://tacksdk.com).

## Headless

If you don't want any UI — for example, posting a form's textarea straight to the API — use the headless subpath:

```ts
import { submit } from '@tacksdk/js/headless'

await submit({
  projectId: 'proj_your_project_id',
  body: 'The export button is broken',
  user: { id: 'user_123', email: 'ada@example.com' },
})
```

The headless subpath does NOT pull the widget DOM into your bundle.

## Errors

`submit()` and the widget's `onError` callback both surface a typed `TackError` with `type`, `docUrl`, and `status`. See per-package READMEs for the full list.

## Stability

Pre-1.0 releases follow [STABILITY.md](./STABILITY.md). Pin your version; minor bumps may include breaking changes.

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
  js/       @tacksdk/js    — vanilla core
  react/    @tacksdk/react — React wrappers
examples/
  playground/              — manual smoke-test surface
```

### Releasing

This repo uses [Changesets](https://github.com/changesets/changesets). CI opens a "Version Packages" PR on merge to `main`; merging that PR publishes to npm with provenance.

```bash
pnpm changeset
```

## License

MIT
