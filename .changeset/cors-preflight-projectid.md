---
"@tacksdk/js": patch
"@tacksdk/react": patch
---

Fix CORS preflight failure for cross-origin callers.

The SDK now appends `?projectId=<id>` to the feedback request URL. The server's
CORS preflight (OPTIONS) reads the project ID from the query string to look up
the per-project `originAllowlist` — preflights have no body to read. Without
this, every cross-origin call was blocked by the browser even when the origin
was correctly allowlisted, because the preflight returned a 204 with no
`Access-Control-Allow-Origin` header.

Same-origin callers were not affected (browsers skip preflight for same-origin
requests).
