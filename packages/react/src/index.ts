export { TackWidget, useTack } from './TackWidget'
export type { TackWidgetProps } from './TackWidget'
export { TackLauncher } from './TackLauncher'
export type { TackLauncherProps } from './TackLauncher'
export {
  Tack,
  TackLauncher as TackLauncherCore,
  init,
  submit,
  reset,
  getConfig,
  TackError,
  bindHotkey,
  parseHotkey,
  matchHotkey,
} from '@tacksdk/js'
export type {
  TackConfig,
  TackHandle,
  TackLauncherConfig,
  TackLauncherHandle,
  TackLauncherPosition,
  TackLauncherVariant,
  TackUser,
  TackSubmitRequest,
  TackFeedbackCreated,
  TackErrorBody,
  TackErrorType,
  SubmitInput,
  ParsedHotkey,
  ParseHotkeyOptions,
  BindHotkeyOptions,
} from '@tacksdk/js'
