---
'@tacksdk/react': minor
---

`<TackWidget>`, `useTack`, and `<TackLauncher>` now forward every vanilla
`TackWidgetConfig` / `TackLauncherConfig` field that previously had no React
prop equivalent: `container`, `onOpen`, `onClose` (widget + hook only — the
launcher reserves them for `aria-expanded` wiring), `placement`, `trigger`,
`zIndex`, `modal`, `scrollLock`, `debug`, `fetch`, `headers`,
`captureScreenshot`. `useTack` is now typed against `TackWidgetConfig`
directly so its parameter type matches its runtime behavior. A type-level
coverage assertion in the React test suite fails CI when a future vanilla
config field is added without surfacing it through the React layer.
