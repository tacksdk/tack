// Public surface for `@tacksdk/react`. Two components — `<TackWidget>` (a
// trigger button + dialog) and `<TackLauncher>` (a floating launcher). Both
// wrap the vanilla `Tack`/`TackLauncher` cores from `@tacksdk/js`.
//
// The legacy `init`/`submit`/`reset`/`getConfig` re-exports were removed in
// S8 (slice C). Headless callers should import directly from
// `@tacksdk/js/headless`. Vanilla widget callers should import `Tack` from
// `@tacksdk/js` and call `Tack.init({ projectId })`.

export { TackWidget, useTack } from './TackWidget'
export type { TackWidgetProps } from './TackWidget'
export { TackLauncher } from './TackLauncher'
export type { TackLauncherProps } from './TackLauncher'
export { TackError } from '@tacksdk/js'
export type {
  BuiltinPresetName,
  TackHandle,
  TackLauncherPosition,
  TackLauncherVariant,
  TackThemePreset,
  TackUser,
  TackSubmitRequest,
  TackFeedbackCreated,
  TackErrorBody,
  TackErrorType,
  ParsedHotkey,
  ParseHotkeyOptions,
  BindHotkeyOptions,
} from '@tacksdk/js'
