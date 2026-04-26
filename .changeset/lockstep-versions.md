---
'@tacksdk/js': patch
'@tacksdk/react': patch
---

Lock `@tacksdk/js` and `@tacksdk/react` versions in step.

Adds `"fixed": [["@tacksdk/js", "@tacksdk/react"]]` to `.changeset/config.json` so both packages always ship the same version number, avoiding the drift that left them at `0.1.0` and `0.0.3` after the previous release. From here on, any bump to either package bumps both to the higher resulting version.

This release realigns them at `0.1.1`. No code changes.
