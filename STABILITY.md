# Stability guarantees

Tack is pre-1.0 and will make breaking changes. This document tells you exactly what we promise, what we don't, and how to read a changelog so a breaking change never surprises you in production.

## TL;DR

- **Versions < 1.0** follow [the 0.x convention](https://semver.org/#spec-item-4): minor bumps (`0.1.0` → `0.2.0`) may break. Patch bumps (`0.1.0` → `0.1.1`) are always safe.
- **The HTTP API is versioned separately** at `/v1/feedback`. SDK minor bumps never change the API version.
- **Every breaking change has a named section in the changelog.** If it's not documented, it's a bug — file an issue.
- **Pin to an exact version** if you want zero surprise: `"@tacksdk/js": "0.1.0"`. Pin to a caret (`^0.1.0`) only after you've read this doc.

## What counts as "breaking"

### Breaking (requires a minor bump pre-1.0, major bump post-1.0)

- Removing or renaming an exported function, type, or field.
- Changing the runtime behavior of an exported function in a way callers will notice (return shape, thrown error type, defaults, argument handling).
- Changing the HTTP request shape `submit()` sends (server-breaking).
- Changing which error `type` strings can appear in `TackError.type`.
- Raising the supported-browser floor, raising the minimum Node or React version.
- Changing `peerDependencies` in a way that locks out previously-supported versions.
- Removing a legacy default that users are relying on (e.g., the default `endpoint`).

### Not breaking (can land in any release, including patches)

- Adding new optional fields to `TackSubmitRequest` / `SubmitInput`.
- Adding new error `type` strings, **as long as** the typed union is already declared with `| (string & {})` so TypeScript callers aren't forced to update.
- Adding new exports.
- Relaxing validation (accepting more inputs than before).
- Internal refactors that don't change observable behavior.
- Docs, tests, build tooling, CI.
- Bug fixes that restore documented behavior — even if someone was relying on the buggy behavior, the fix is not a breaking change.

### Grey zone (called out explicitly in the changelog when it happens)

- Tightening validation (rejecting inputs that previously worked but were never documented as supported).
- Changing a default that was undocumented.
- Dropping support for a browser version that has <0.5% usage in the telemetry.

## How to read the changelog

Every release note **MUST** have these sections when applicable:

```
### Breaking
- <one bullet per break, with migration steps>

### Renamed
- <old name> → <new name>, old name works until <version>

### Removed
- <what was removed, how to replace it>

### Added
- <new exports, options, fields>

### Fixed
- <bugs fixed>
```

No `### Breaking` section = no breaking changes. If you see that section missing from a minor bump, that's a bug.

## How upgrades work

### Safe upgrade

```bash
# You're on 0.1.0 and want the latest bugfixes.
npm install @tacksdk/js@^0.1
```

This pulls the latest `0.1.x`. Patches only. Always safe.

### Intentional upgrade

```bash
# You want the new 0.2 features.
npm install @tacksdk/js@^0.2
```

Before you run this, **read the 0.2.0 changelog section `### Breaking`**. It tells you exactly what to change.

### Stay pinned

```json
{
  "dependencies": {
    "@tacksdk/js": "0.1.0"
  }
}
```

Exact version. You will not get bugfixes automatically, but you also will not be surprised. Suitable for critical-path integrations where you review SDK upgrades like you would any other dependency upgrade.

## The HTTP API is separate

The SDK and the HTTP API have independent version lines.

- The SDK version is the `version` in `packages/js/package.json`.
- The HTTP API version is in the URL path: `/v1/feedback`, `/v2/feedback`, etc.

An SDK minor bump (`0.1.0` → `0.2.0`) may change how the SDK calls the API, but it will not change `/v1` to `/v2`. When a `/v2` exists, older SDK releases will continue to use `/v1` until their next major.

This means: **your server doesn't have to upgrade when you upgrade the SDK**, and vice versa.

## First-time console warning

On the first `init()` call, the SDK logs one warning to the browser console:

```
[tack] Running SDK vX.Y.Z (pre-1.0). Pin the version and read STABILITY.md
       before upgrading: https://github.com/tacksdk/tack/blob/main/STABILITY.md
```

This is intentional and will stay until `1.0.0`. If the noise bothers you, pass `silent: true` to `init()` — but only do that once you've read this document.

## Reporting a contract violation

If a non-patch release changed something breaking without a `### Breaking` section, **that's a bug**. Open an issue with the before/after code and we'll fix it and cut a patch.
