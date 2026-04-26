---
'@tacksdk/js': minor
'@tacksdk/react': minor
---

Add optional global keyboard shortcut (`hotkey` config) that toggles the
feedback dialog. Combo syntax is string-based and case-insensitive (e.g.
`'mod+alt+f'`); `mod` resolves to ⌘ on mac and ctrl elsewhere. Inputs,
textareas, and contenteditable regions are skipped by default.

Also exports `bindHotkey(handle, combo, opts)` for full control over scope,
guards, and action (`'toggle' | 'open' | 'close'`), `parseHotkey()` for the
pure parser, and `matchHotkey()` for the matcher. Adds `handle.toggle()` and
`handle.isOpen()` to `TackHandle` and `TackLauncherHandle`.

None of the existing API shape changes — `hotkey` defaults to undefined.
