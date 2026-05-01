---
'@tacksdk/js': minor
'@tacksdk/react': minor
---

Pass `preset` through `@tacksdk/react` wrappers.

The vanilla SDK has accepted a `preset` option (built-in `'default' | 'midnight' | 'paper'` or a custom `TackThemePreset` object) since 0.3.0, but the React wrappers never forwarded it. React consumers had to drop down to the vanilla SDK to opt into themes.

`<TackWidget>`, `useTack`, and `<TackLauncher>` now accept a `preset` prop:

```tsx
<TackWidget projectId="proj_..." preset="midnight" />
<TackLauncher projectId="proj_..." preset="midnight" />
```

Custom preset objects work too:

```tsx
const PRESET = { name: 'brand', scheme: 'light', tokens: { '--tack-accent': 'oklch(...)' } }
// hoist or useMemo — inline objects re-mount the widget each render
<TackWidget projectId="proj_..." preset={PRESET} />
```

`BuiltinPresetName` and `TackThemePreset` are now re-exported from `@tacksdk/react` for typed preset references.

Like `theme`, changing `preset` re-mounts the widget. JSDoc on the prop documents the inline-object footgun.
