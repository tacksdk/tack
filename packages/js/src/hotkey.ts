// Keyboard shortcut binding for the feedback dialog.
//
// Two layers:
//   - parseHotkey(combo): pure string -> normalized {ctrl, meta, alt, shift, key}.
//     Resolves the `mod` alias to `meta` on mac, `ctrl` elsewhere.
//   - bindHotkey(handle, combo, opts): installs a window keydown listener,
//     guards inputs by default, calls handle.toggle() on match. Returns unbind.
//
// Match semantics are EXACT: every modifier the user listed must be down,
// every modifier they did NOT list must be up. So `mod+f` does not fire on
// `mod+shift+f`. This avoids surprise activations when the user happens to
// hold an extra modifier.

interface HandleLike {
  open: () => void
  close: () => void
  toggle: () => void
}

export interface ParsedHotkey {
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  /** Normalized key. Single-char keys are lowercase. Named keys: 'escape',
   * 'enter', 'space', 'tab', 'backspace', 'delete', 'arrowup', 'arrowdown',
   * 'arrowleft', 'arrowright', 'f1'-'f12', and standard punctuation. */
  key: string
}

export interface ParseHotkeyOptions {
  /** Override platform detection. Default: detected from navigator. */
  mac?: boolean
}

export interface BindHotkeyOptions {
  /** Fire even when focus is in <input>, <textarea>, or [contenteditable].
   * Default: false. */
  enableInInputs?: boolean
  /** Action to take when the combo matches. Default: 'toggle'. */
  action?: 'open' | 'close' | 'toggle'
  /** Event target. Default: window. */
  target?: EventTarget
  /** Override platform detection. Default: detected from navigator. */
  mac?: boolean
}

const NAMED_KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  escape: 'escape',
  return: 'enter',
  enter: 'enter',
  space: ' ',
  spacebar: ' ',
  tab: 'tab',
  backspace: 'backspace',
  del: 'delete',
  delete: 'delete',
  up: 'arrowup',
  arrowup: 'arrowup',
  down: 'arrowdown',
  arrowdown: 'arrowdown',
  left: 'arrowleft',
  arrowleft: 'arrowleft',
  right: 'arrowright',
  arrowright: 'arrowright',
  home: 'home',
  end: 'end',
  pageup: 'pageup',
  pagedown: 'pagedown',
  comma: ',',
  period: '.',
  slash: '/',
  backslash: '\\',
  semicolon: ';',
  quote: "'",
  bracketleft: '[',
  bracketright: ']',
  minus: '-',
  equal: '=',
  '=': '=',
  '-': '-',
  ',': ',',
  '.': '.',
  '/': '/',
  '\\': '\\',
  ';': ';',
  "'": "'",
  '[': '[',
  ']': ']',
  '`': '`',
  backquote: '`',
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  // navigator.platform is deprecated but still the most reliable way to
  // detect mac in browsers; userAgentData is not yet universal.
  const platform =
    (navigator as unknown as { userAgentData?: { platform?: string } })
      .userAgentData?.platform ?? navigator.platform ?? ''
  return /mac/i.test(platform)
}

/**
 * Parse a hotkey combo string into a normalized shape. Throws on invalid
 * input — invalid combos should fail loud at init, not silently never fire.
 *
 * Syntax: `+`-separated tokens, case-insensitive, whitespace-tolerant.
 *   modifiers: mod | cmd | command | meta | ctrl | control | alt | option | shift
 *   key: single character, or one of the named keys above
 *   examples: 'mod+alt+f', 'ctrl+shift+/', 'cmd+k', 'shift+?', 'esc'
 *
 * `mod` resolves to `meta` on mac and `ctrl` elsewhere — the conventional
 * cross-platform "primary" modifier.
 */
export function parseHotkey(
  combo: string,
  opts: ParseHotkeyOptions = {},
): ParsedHotkey {
  if (typeof combo !== 'string' || combo.length === 0) {
    throw new Error('[tack] parseHotkey: combo must be a non-empty string')
  }
  const mac = opts.mac ?? isMacPlatform()
  const tokens = combo
    .split('+')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0)
  if (tokens.length === 0) {
    throw new Error(`[tack] parseHotkey: invalid combo ${JSON.stringify(combo)}`)
  }

  const result: ParsedHotkey = {
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    key: '',
  }
  let keyToken: string | null = null

  for (const tok of tokens) {
    switch (tok) {
      case 'mod':
        if (mac) result.meta = true
        else result.ctrl = true
        break
      case 'cmd':
      case 'command':
      case 'meta':
      case 'super':
      case 'win':
        result.meta = true
        break
      case 'ctrl':
      case 'control':
        result.ctrl = true
        break
      case 'alt':
      case 'option':
      case 'opt':
        result.alt = true
        break
      case 'shift':
        result.shift = true
        break
      default:
        if (keyToken !== null) {
          throw new Error(
            `[tack] parseHotkey: combo ${JSON.stringify(combo)} has multiple non-modifier keys (${keyToken!}, ${tok})`,
          )
        }
        keyToken = tok
    }
  }

  if (keyToken === null) {
    throw new Error(
      `[tack] parseHotkey: combo ${JSON.stringify(combo)} has no non-modifier key`,
    )
  }

  // Normalize the key. Single chars stay as-is (lowercase from above);
  // function keys f1..f12 stay as 'f1'; everything else goes through aliases.
  if (keyToken.length === 1) {
    result.key = keyToken
  } else if (/^f([1-9]|1[0-2])$/.test(keyToken)) {
    result.key = keyToken
  } else if (keyToken in NAMED_KEY_ALIASES) {
    result.key = NAMED_KEY_ALIASES[keyToken]!
  } else {
    throw new Error(
      `[tack] parseHotkey: unknown key ${JSON.stringify(keyToken)} in combo ${JSON.stringify(combo)}`,
    )
  }

  return result
}

/**
 * Test whether a KeyboardEvent matches a parsed hotkey. Modifier match is
 * EXACT — listed modifiers must be down, unlisted must be up. Key match is
 * case-insensitive on letters.
 *
 * For single-letter and single-digit combos we also accept `event.code`
 * (e.g. `KeyF`, `Digit5`) — on macOS, Option+letter produces a transformed
 * `event.key` (Option+F → `ƒ`) but `event.code` stays `KeyF`. Without this
 * fallback `mod+alt+f` would never fire on mac. Punctuation/named keys
 * stick to `event.key` so layout-aware combos like `shift+/` keep working.
 */
export function matchHotkey(parsed: ParsedHotkey, event: KeyboardEvent): boolean {
  if (event.ctrlKey !== parsed.ctrl) return false
  if (event.metaKey !== parsed.meta) return false
  if (event.altKey !== parsed.alt) return false
  if (event.shiftKey !== parsed.shift) return false
  const eventKey = event.key.toLowerCase()
  if (eventKey === parsed.key) return true
  // Fallback to event.code for ASCII letters (a-z) and digits (0-9). Other
  // single-char keys (punctuation) and named keys do not get the code path
  // because their `code` values are layout-specific (e.g. `Slash` for `/`
  // on US, `Minus` on Dvorak) and would surprise users who type the literal.
  if (parsed.key.length === 1) {
    if (parsed.key >= 'a' && parsed.key <= 'z') {
      return event.code === 'Key' + parsed.key.toUpperCase()
    }
    if (parsed.key >= '0' && parsed.key <= '9') {
      return event.code === 'Digit' + parsed.key
    }
  }
  return false
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  // Walk up looking for contenteditable. closest() honors inheritance via
  // the [contenteditable] attribute being present on any ancestor.
  if (target.closest('[contenteditable]')) {
    const ce = target.closest('[contenteditable]') as HTMLElement
    const v = ce.getAttribute('contenteditable')
    // 'false' explicitly disables editing on a subtree.
    if (v !== 'false') return true
  }
  return false
}

/**
 * Bind a global hotkey to a Tack handle. Returns an unbind function.
 *
 * Defaults: skips when focus is in an input/textarea/contenteditable,
 * preventDefault on match, calls handle.toggle().
 *
 * Safe to call on the server — returns a no-op unbind.
 */
export function bindHotkey(
  handle: HandleLike,
  combo: string,
  opts: BindHotkeyOptions = {},
): () => void {
  const parsed = parseHotkey(combo, { mac: opts.mac })
  if (typeof window === 'undefined') return () => {}
  const target = opts.target ?? window
  const enableInInputs = opts.enableInInputs ?? false
  const action = opts.action ?? 'toggle'

  const listener = (event: Event): void => {
    const ke = event as KeyboardEvent
    if (!matchHotkey(parsed, ke)) return
    if (!enableInInputs && isEditableTarget(ke.target)) return
    ke.preventDefault()
    ke.stopPropagation()
    if (action === 'open') handle.open()
    else if (action === 'close') handle.close()
    else handle.toggle()
  }

  target.addEventListener('keydown', listener as EventListener)
  return () => {
    target.removeEventListener('keydown', listener as EventListener)
  }
}
