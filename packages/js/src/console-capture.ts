// Per-widget console capture (S-extension). Patches the host's console at
// widget mount, buffers the last N entries, restores on destroy.
//
// Per-widget (NOT shared across widgets): each install owns its own buffer,
// its own wrapper, its own restore. Two widgets on the same page each see
// their own console history. Trade: ~5KB per widget instead of one shared
// ~5KB. Worth it for the simpler mental model and zero cross-widget leakage.
//
// Late-wrap defense: at install we capture whatever's at console[level]
// (could be native console.error, could already be Sentry's wrapper). At
// uninstall we ONLY restore if console[level] is still our wrapper — if
// something else patched on top after us, we leave their patch in place.
// Without this, late-initializing observability tools (Sentry, Datadog) get
// silently bypassed when our widget destroys.
//
// Safe serializer: cycles via WeakSet; Errors → name/message/stack; DOM
// nodes → truncated outerHTML; functions → '[Function: name]'; depth-capped
// at 3; per-entry size capped at 10KB; symbols stringified. Catches its own
// throws so a bad arg never breaks the host page.

import type { CaptureConsoleConfig, ConsoleEntry } from './widget'

type Level = 'error' | 'warn' | 'info' | 'log'

const DEFAULT_LEVELS: Level[] = ['error', 'warn']
const DEFAULT_MAX_ENTRIES = 20
const MAX_ENTRY_BYTES = 10_000
const MAX_DEPTH = 3
const MAX_DOM_HTML_BYTES = 500

export interface CaptureHandle {
  /** Snapshot the buffer (copy, not live reference). */
  snapshot: () => ConsoleEntry[]
  /** Restore the original console functions IF they're still our wrappers. */
  uninstall: () => void
}

/**
 * Patch the host console for this widget instance. Returns a handle for
 * snapshot + uninstall. The buffer is owned by THIS install — disposing the
 * handle does not affect any other widget's capture state.
 *
 * On the server (no `console`), returns a no-op handle so call sites don't
 * need to gate on `typeof console`.
 */
export function installConsoleCapture(
  rawConfig: boolean | CaptureConsoleConfig,
): CaptureHandle {
  if (rawConfig === false || typeof console === 'undefined') {
    return { snapshot: () => [], uninstall: () => {} }
  }
  const config: CaptureConsoleConfig =
    rawConfig === true ? {} : rawConfig
  const levels: Level[] = (config.levels ?? DEFAULT_LEVELS).slice()
  const maxEntries = Math.max(1, config.maxEntries ?? DEFAULT_MAX_ENTRIES)

  const buffer: ConsoleEntry[] = []
  // Track each (level, original, wrapper) so uninstall can verify identity.
  // Map by level — multiple installs on the same level stack independently.
  const installs: { level: Level; original: unknown; wrapper: unknown }[] = []
  // Shared "this handle is destroyed" flag closure. When uninstall runs
  // but a later wrapper (e.g. Sentry) sits on top of ours, we can't
  // unhook from the chain — but we can set this flag so our wrapper
  // becomes a thin passthrough on subsequent calls. Without it, an
  // orphaned wrapper keeps serializing args + pushing to an unreachable
  // buffer forever.
  const flags = { destroyed: false }

  for (const level of levels) {
    const original = (console as unknown as Record<Level, (...args: unknown[]) => void>)[
      level
    ]
    if (typeof original !== 'function') continue
    const wrapper = (...args: unknown[]) => {
      // Post-destroy passthrough: skip serialize + buffer push, just
      // forward. The wrapper might still be in someone's call chain
      // (Sentry-style late wrap on top of us); we don't want it to
      // keep doing work for a handle that's been disposed.
      if (flags.destroyed) {
        try {
          ;(original as (...a: unknown[]) => void)(...args)
        } catch {}
        return
      }
      try {
        const msg = serializeArgs(args)
        buffer.push({ level, ts: Date.now(), msg })
        if (buffer.length > maxEntries) buffer.shift()
      } catch {
        // Never let our wrapper throw — we'd break the host page's console.
      }
      // Pass through to whatever was there at install time (native or
      // previously-installed wrapper, e.g. Sentry).
      try {
        ;(original as (...a: unknown[]) => void)(...args)
      } catch {
        // Same defense for the underlying call — should never throw under
        // us, but protect the host either way.
      }
    }
    ;(console as unknown as Record<Level, (...args: unknown[]) => void>)[level] =
      wrapper
    installs.push({ level, original, wrapper })
  }

  return {
    snapshot: () => buffer.slice(),
    uninstall: () => {
      // Set the flag FIRST so any wrapper still in a call chain becomes a
      // passthrough immediately, before we try to unhook ourselves.
      flags.destroyed = true
      for (const inst of installs) {
        const current = (console as unknown as Record<Level, unknown>)[inst.level]
        if (current === inst.wrapper) {
          // Still our wrapper — safe to restore.
          ;(console as unknown as Record<Level, unknown>)[inst.level] =
            inst.original
        }
        // If current !== our wrapper, something else patched on top after us
        // (Sentry initialized late, etc.). Leave their patch intact —
        // restoring would point at our wrapper which would point at their
        // wrapper, but we'd lose our entry in the chain. Let it ride.
      }
      installs.length = 0
      buffer.length = 0
    },
  }
}

/**
 * Serialize an arg list for storage. Joins individual arg renders with a
 * space, matching how console.log displays multi-arg calls. Truncated to
 * `MAX_ENTRY_BYTES` so a 100MB Redux store dump doesn't bloat memory.
 */
function serializeArgs(args: unknown[]): string {
  const parts: string[] = []
  let total = 0
  const seen = new WeakSet<object>()
  for (const arg of args) {
    let rendered: string
    try {
      rendered = render(arg, 0, seen)
    } catch {
      rendered = '[unserializable]'
    }
    parts.push(rendered)
    total += rendered.length
    if (total > MAX_ENTRY_BYTES) {
      parts.push(`...[truncated, ${total - MAX_ENTRY_BYTES} bytes elided]`)
      break
    }
  }
  return parts.join(' ').slice(0, MAX_ENTRY_BYTES)
}

function render(value: unknown, depth: number, seen: WeakSet<object>): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  const t = typeof value
  if (t === 'string') return value as string
  if (t === 'number' || t === 'boolean' || t === 'bigint') return String(value)
  if (t === 'symbol') return String(value)
  if (t === 'function') {
    const name = (value as { name?: string }).name || 'anonymous'
    return `[Function: ${name}]`
  }
  if (depth >= MAX_DEPTH) return '[…]'

  // Errors: render name + message + first-line stack
  if (value instanceof Error) {
    const stackLine = value.stack?.split('\n')[1]?.trim() ?? ''
    return `${value.name}: ${value.message}${stackLine ? ` (${stackLine})` : ''}`
  }

  // DOM nodes: outerHTML, truncated
  if (typeof Element !== 'undefined' && value instanceof Element) {
    const html = value.outerHTML ?? `<${value.tagName.toLowerCase()} />`
    return html.length > MAX_DOM_HTML_BYTES
      ? `${html.slice(0, MAX_DOM_HTML_BYTES)}…`
      : html
  }

  // Cycles
  if (typeof value === 'object' && value !== null) {
    if (seen.has(value as object)) return '[Circular]'
    seen.add(value as object)
  }

  // Arrays
  if (Array.isArray(value)) {
    const items = value
      .slice(0, 20)
      .map((v) => render(v, depth + 1, seen))
      .join(', ')
    const more = value.length > 20 ? `, …${value.length - 20} more` : ''
    return `[${items}${more}]`
  }

  // Plain objects
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).slice(0, 20)
  const entries = keys
    .map((k) => `${k}: ${render(obj[k], depth + 1, seen)}`)
    .join(', ')
  const more = Object.keys(obj).length > 20 ? `, …${Object.keys(obj).length - 20} more` : ''
  return `{${entries}${more}}`
}
