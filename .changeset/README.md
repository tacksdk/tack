# Changesets

To record a change, run:

```
pnpm changeset
```

Pick which packages are affected (`@tacksdk/js`, `@tacksdk/react`, or both),
the bump type (patch / minor / major), and write a user-facing summary.

Changeset markdown files land in this directory and are committed alongside
the code change. On merge to `main`, the release workflow opens a
"Version Packages" PR that bumps versions and updates changelogs. Merging
that PR publishes the affected packages to npm.
