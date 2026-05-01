---
"@tacksdk/js": patch
"@tacksdk/react": patch
---

Fix exports map: drop unreachable `development` condition that pointed to
`./src/*.ts` (not in the published tarball — `files: ["dist"]`) and broke
Vite + any other bundler that resolves the `development` condition. Also
reorder so `types` comes first per Node spec, ensuring TypeScript picks
the right declaration before `import`/`require`. Adds a CI `pack-smoke`
job that exercises the published tarball under Node CJS, Node ESM, and
Vite build to prevent the bug class from recurring.
