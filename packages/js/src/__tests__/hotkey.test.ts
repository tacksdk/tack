import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { bindHotkey, matchHotkey, parseHotkey } from '../hotkey'

// ---------------------------------------------------------------------------
// parseHotkey
// ---------------------------------------------------------------------------

describe('parseHotkey: structure', () => {
  it('parses a single letter', () => {
    expect(parseHotkey('f', { mac: false })).toEqual({
      ctrl: false, meta: false, alt: false, shift: false, key: 'f',
    })
  })

  it('parses ctrl+letter', () => {
    expect(parseHotkey('ctrl+f', { mac: false })).toEqual({
      ctrl: true, meta: false, alt: false, shift: false, key: 'f',
    })
  })

  it('parses cmd+letter', () => {
    expect(parseHotkey('cmd+k', { mac: true })).toEqual({
      ctrl: false, meta: true, alt: false, shift: false, key: 'k',
    })
  })

  it('parses every modifier together', () => {
    expect(parseHotkey('ctrl+meta+alt+shift+x', { mac: false })).toEqual({
      ctrl: true, meta: true, alt: true, shift: true, key: 'x',
    })
  })
})

describe('parseHotkey: mod alias', () => {
  it('mod -> meta on mac', () => {
    expect(parseHotkey('mod+f', { mac: true })).toMatchObject({
      meta: true, ctrl: false,
    })
  })

  it('mod -> ctrl on non-mac', () => {
    expect(parseHotkey('mod+f', { mac: false })).toMatchObject({
      ctrl: true, meta: false,
    })
  })

  it('mod combined with explicit ctrl on mac yields both', () => {
    expect(parseHotkey('mod+ctrl+f', { mac: true })).toMatchObject({
      meta: true, ctrl: true,
    })
  })

  it('mod combined with explicit meta on non-mac yields both', () => {
    expect(parseHotkey('mod+meta+f', { mac: false })).toMatchObject({
      ctrl: true, meta: true,
    })
  })
})

describe('parseHotkey: case + whitespace + ordering', () => {
  it('is case-insensitive', () => {
    expect(parseHotkey('CTRL+ALT+F', { mac: false })).toEqual({
      ctrl: true, meta: false, alt: true, shift: false, key: 'f',
    })
  })

  it('tolerates whitespace around tokens', () => {
    expect(parseHotkey(' ctrl + alt + f ', { mac: false })).toEqual({
      ctrl: true, meta: false, alt: true, shift: false, key: 'f',
    })
  })

  it('does not depend on modifier order', () => {
    const a = parseHotkey('alt+ctrl+shift+f', { mac: false })
    const b = parseHotkey('shift+alt+ctrl+f', { mac: false })
    expect(a).toEqual(b)
  })
})

describe('parseHotkey: modifier aliases', () => {
  it.each([
    ['command+f', { meta: true }],
    ['cmd+f', { meta: true }],
    ['meta+f', { meta: true }],
    ['super+f', { meta: true }],
    ['win+f', { meta: true }],
    ['control+f', { ctrl: true }],
    ['ctrl+f', { ctrl: true }],
    ['option+f', { alt: true }],
    ['opt+f', { alt: true }],
    ['alt+f', { alt: true }],
  ])('%s parses to expected modifier', (combo, expected) => {
    expect(parseHotkey(combo, { mac: false })).toMatchObject(expected)
  })
})

describe('parseHotkey: named keys', () => {
  it.each([
    ['esc', 'escape'],
    ['escape', 'escape'],
    ['return', 'enter'],
    ['enter', 'enter'],
    ['space', ' '],
    ['tab', 'tab'],
    ['backspace', 'backspace'],
    ['del', 'delete'],
    ['delete', 'delete'],
    ['up', 'arrowup'],
    ['down', 'arrowdown'],
    ['left', 'arrowleft'],
    ['right', 'arrowright'],
    ['arrowup', 'arrowup'],
    ['home', 'home'],
    ['end', 'end'],
    ['pageup', 'pageup'],
    ['pagedown', 'pagedown'],
  ])('%s -> %s', (name, expected) => {
    expect(parseHotkey(name, { mac: false }).key).toBe(expected)
  })

  it.each([
    ['f1', 'f1'],
    ['f5', 'f5'],
    ['f9', 'f9'],
    ['f12', 'f12'],
  ])('%s -> %s', (name, expected) => {
    expect(parseHotkey(name, { mac: false }).key).toBe(expected)
  })

  it('rejects f0 and f13', () => {
    expect(() => parseHotkey('f0', { mac: false })).toThrow()
    expect(() => parseHotkey('f13', { mac: false })).toThrow()
  })
})

describe('parseHotkey: punctuation', () => {
  it.each([
    ['/', '/'],
    ['?', '?'],
    [',', ','],
    ['.', '.'],
    [';', ';'],
    ["'", "'"],
    ['[', '['],
    [']', ']'],
    ['-', '-'],
    ['=', '='],
    ['`', '`'],
    ['\\', '\\'],
  ])('single-char %s parses literally', (ch, expected) => {
    expect(parseHotkey(ch, { mac: false }).key).toBe(expected)
  })

  it.each([
    ['comma', ','],
    ['period', '.'],
    ['slash', '/'],
    ['semicolon', ';'],
    ['quote', "'"],
    ['bracketleft', '['],
    ['bracketright', ']'],
    ['minus', '-'],
    ['equal', '='],
    ['backquote', '`'],
    ['backslash', '\\'],
  ])('named %s -> %s', (name, expected) => {
    expect(parseHotkey(name, { mac: false }).key).toBe(expected)
  })

  it('handles modifier+punct combos', () => {
    expect(parseHotkey('ctrl+shift+/', { mac: false })).toEqual({
      ctrl: true, meta: false, alt: false, shift: true, key: '/',
    })
  })
})

describe('parseHotkey: errors', () => {
  it('throws on empty string', () => {
    expect(() => parseHotkey('', { mac: false })).toThrow(/non-empty/)
  })

  it('throws on whitespace-only', () => {
    expect(() => parseHotkey('   ', { mac: false })).toThrow(/invalid/)
  })

  it('throws on modifiers with no key', () => {
    expect(() => parseHotkey('ctrl+alt', { mac: false })).toThrow(/no non-modifier/)
  })

  it('throws on multiple non-modifier keys', () => {
    expect(() => parseHotkey('ctrl+f+g', { mac: false })).toThrow(/multiple/)
  })

  it('throws on unknown named key', () => {
    expect(() => parseHotkey('ctrl+foo', { mac: false })).toThrow(/unknown key/)
  })

  it('throws on non-string input', () => {
    // @ts-expect-error testing runtime behaviour
    expect(() => parseHotkey(undefined)).toThrow()
    // @ts-expect-error testing runtime behaviour
    expect(() => parseHotkey(null)).toThrow()
    // @ts-expect-error testing runtime behaviour
    expect(() => parseHotkey(42)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// matchHotkey
// ---------------------------------------------------------------------------

function ke(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init)
}

describe('matchHotkey: exact modifier match', () => {
  it('matches when all listed modifiers are down and key matches', () => {
    const p = parseHotkey('mod+alt+f', { mac: true })
    expect(matchHotkey(p, ke({ key: 'f', metaKey: true, altKey: true }))).toBe(true)
  })

  it('does NOT match when a listed modifier is up', () => {
    const p = parseHotkey('mod+alt+f', { mac: true })
    expect(matchHotkey(p, ke({ key: 'f', metaKey: true, altKey: false }))).toBe(false)
  })

  it('does NOT match when an unlisted modifier is down', () => {
    const p = parseHotkey('mod+f', { mac: true })
    expect(matchHotkey(p, ke({ key: 'f', metaKey: true, shiftKey: true }))).toBe(false)
  })

  it('does NOT match when key differs', () => {
    const p = parseHotkey('mod+f', { mac: true })
    expect(matchHotkey(p, ke({ key: 'g', metaKey: true }))).toBe(false)
  })
})

describe('matchHotkey: case-insensitive letters', () => {
  it('matches uppercase event.key against lowercase parsed key', () => {
    const p = parseHotkey('shift+f', { mac: false })
    expect(matchHotkey(p, ke({ key: 'F', shiftKey: true }))).toBe(true)
  })
})

describe('matchHotkey: mac Option+letter (transformed event.key)', () => {
  // On macOS, Option+letter produces a special character as event.key
  // (Option+F → 'ƒ', Option+L → '¬', etc.). event.code stays 'KeyF', 'KeyL'.
  // Without code fallback, mod+alt+f would never fire on mac.
  it('matches mod+alt+f when event.key is "ƒ" but code is KeyF', () => {
    const p = parseHotkey('mod+alt+f', { mac: true })
    expect(
      matchHotkey(
        p,
        ke({ key: 'ƒ', code: 'KeyF', metaKey: true, altKey: true }),
      ),
    ).toBe(true)
  })

  it('matches mod+alt+l when event.key is "¬" but code is KeyL', () => {
    const p = parseHotkey('mod+alt+l', { mac: true })
    expect(
      matchHotkey(
        p,
        ke({ key: '¬', code: 'KeyL', metaKey: true, altKey: true }),
      ),
    ).toBe(true)
  })

  it('still matches via event.key when code is missing', () => {
    const p = parseHotkey('mod+f', { mac: true })
    expect(matchHotkey(p, ke({ key: 'f', metaKey: true }))).toBe(true)
  })

  it('matches digits via Digit code', () => {
    const p = parseHotkey('mod+5', { mac: true })
    expect(
      matchHotkey(p, ke({ key: '∞', code: 'Digit5', metaKey: true })),
    ).toBe(true)
  })

  it('does NOT use code fallback for punctuation', () => {
    // shift+/ should match via event.key '?' (US layout), not via Slash code,
    // because Slash means different things on different layouts.
    const p = parseHotkey('shift+/', { mac: false })
    expect(matchHotkey(p, ke({ key: '/', code: 'Slash', shiftKey: true }))).toBe(true)
    // event.key still authoritative — no surprise code-based match
    expect(matchHotkey(p, ke({ key: 'x', code: 'Slash', shiftKey: true }))).toBe(false)
  })
})

describe('matchHotkey: named keys', () => {
  it('matches Escape', () => {
    const p = parseHotkey('esc', { mac: false })
    expect(matchHotkey(p, ke({ key: 'Escape' }))).toBe(true)
  })

  it('matches ArrowUp', () => {
    const p = parseHotkey('up', { mac: false })
    expect(matchHotkey(p, ke({ key: 'ArrowUp' }))).toBe(true)
  })

  it('matches space (single char " ")', () => {
    const p = parseHotkey('space', { mac: false })
    expect(matchHotkey(p, ke({ key: ' ' }))).toBe(true)
  })

  it('matches F5', () => {
    const p = parseHotkey('f5', { mac: false })
    expect(matchHotkey(p, ke({ key: 'F5' }))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// bindHotkey
// ---------------------------------------------------------------------------

describe('bindHotkey', () => {
  let handle: { open: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; toggle: ReturnType<typeof vi.fn> }
  let unbind: () => void

  beforeEach(() => {
    handle = { open: vi.fn(), close: vi.fn(), toggle: vi.fn() }
  })

  afterEach(() => {
    unbind?.()
  })

  function dispatch(init: KeyboardEventInit, target: EventTarget = window): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    return event
  }

  it('calls toggle by default on match', () => {
    unbind = bindHotkey(handle, 'mod+alt+f', { mac: true })
    dispatch({ key: 'f', metaKey: true, altKey: true })
    expect(handle.toggle).toHaveBeenCalledTimes(1)
    expect(handle.open).not.toHaveBeenCalled()
    expect(handle.close).not.toHaveBeenCalled()
  })

  it('preventDefault on match', () => {
    unbind = bindHotkey(handle, 'mod+alt+f', { mac: true })
    const ev = dispatch({ key: 'f', metaKey: true, altKey: true })
    expect(ev.defaultPrevented).toBe(true)
  })

  it('does NOT preventDefault on miss', () => {
    unbind = bindHotkey(handle, 'mod+alt+f', { mac: true })
    const ev = dispatch({ key: 'g', metaKey: true, altKey: true })
    expect(ev.defaultPrevented).toBe(false)
    expect(handle.toggle).not.toHaveBeenCalled()
  })

  it('respects action: open', () => {
    unbind = bindHotkey(handle, 'mod+f', { mac: true, action: 'open' })
    dispatch({ key: 'f', metaKey: true })
    expect(handle.open).toHaveBeenCalledTimes(1)
    expect(handle.toggle).not.toHaveBeenCalled()
  })

  it('respects action: close', () => {
    unbind = bindHotkey(handle, 'mod+f', { mac: true, action: 'close' })
    dispatch({ key: 'f', metaKey: true })
    expect(handle.close).toHaveBeenCalledTimes(1)
    expect(handle.toggle).not.toHaveBeenCalled()
  })

  it('skips when focus is in <input> by default', () => {
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    unbind = bindHotkey(handle, 'mod+f', { mac: true })
    dispatch({ key: 'f', metaKey: true }, input)
    expect(handle.toggle).not.toHaveBeenCalled()
    input.remove()
  })

  it('skips when focus is in <textarea> by default', () => {
    const ta = document.createElement('textarea')
    document.body.append(ta)
    ta.focus()
    unbind = bindHotkey(handle, 'mod+f', { mac: true })
    dispatch({ key: 'f', metaKey: true }, ta)
    expect(handle.toggle).not.toHaveBeenCalled()
    ta.remove()
  })

  it('skips when focus is inside contenteditable by default', () => {
    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'true')
    const inner = document.createElement('span')
    div.append(inner)
    document.body.append(div)
    unbind = bindHotkey(handle, 'mod+f', { mac: true })
    dispatch({ key: 'f', metaKey: true }, inner)
    expect(handle.toggle).not.toHaveBeenCalled()
    div.remove()
  })

  it('does NOT skip contenteditable="false"', () => {
    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'false')
    document.body.append(div)
    unbind = bindHotkey(handle, 'mod+f', { mac: true })
    dispatch({ key: 'f', metaKey: true }, div)
    expect(handle.toggle).toHaveBeenCalledTimes(1)
    div.remove()
  })

  it('fires inside inputs when enableInInputs: true', () => {
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    unbind = bindHotkey(handle, 'mod+f', { mac: true, enableInInputs: true })
    dispatch({ key: 'f', metaKey: true }, input)
    expect(handle.toggle).toHaveBeenCalledTimes(1)
    input.remove()
  })

  it('unbind() removes the listener', () => {
    unbind = bindHotkey(handle, 'mod+f', { mac: true })
    unbind()
    dispatch({ key: 'f', metaKey: true })
    expect(handle.toggle).not.toHaveBeenCalled()
  })

  it('throws synchronously on invalid combo', () => {
    expect(() => bindHotkey(handle, 'ctrl+', { mac: false })).toThrow()
  })
})
