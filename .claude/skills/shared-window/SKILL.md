---
name: shared-window
description: Consult and update docs/architecture.md whenever reading or changing src/shared/ (window.html, window.ts, socket.ts) or src/nodejs/examples/server.ts's discovery/settings pieces. Use before modifying any of these to learn the extension-vs-nodejs transport split (IS_EXTENSION); use after to keep docs/architecture.md in sync and verify BOTH dist/chrome-extension/ and dist/nodejs/examples/public/ still build and work.
---

# `src/shared/` — one UI, two consumers — read before, update after

`src/shared/window.html`/`window.ts`/`scripts/socket.ts` serve **both** the Chrome extension
(`dist/chrome-extension/`) and the nodejs package's example server
(`dist/nodejs/examples/public/`) — one build, copied into both outputs by `scripts/build.js`'s
`copySharedWebAssets()`. See [`docs/architecture.md`](../../../docs/architecture.md) for the
full design: what's shared vs target-specific, the `socket.ts` transport abstraction
(`IS_EXTENSION`: native messaging host vs WebSocket), and how `examples/server.ts` mirrors
`background.ts`'s persistent-discovery role.

## Before touching `src/shared/` or `examples/server.ts`'s discovery/settings code

Read `docs/architecture.md` first. The two consumers differ in ways that are easy to break by
only testing one side:

- Anything that reads `chrome.*` directly must be `IS_EXTENSION`-guarded (see `window.ts`'s 4
  existing call sites for the pattern) — an unguarded `chrome.*` reference throws outside the
  extension, and if it's at module top level (not inside a function), that throw can silently
  abort the rest of the script's setup. See `MEMORY.md`'s `#broadcast`/`#usegmttime` entry for
  exactly this failure class, found the hard way once already.
- Anything relying on a function/variable becoming a `window.*` global just by being declared at
  top level (classic-script leakage) stops working once Vite's IIFE bundling wraps it — see
  `MEMORY.md`'s Vite `this`-binding entry.
- `socket.ts`'s two transports (`chrome.runtime.connectNative` vs `WebSocket`) must keep
  producing the same message shape (`{type: 'device'|'listening'|'sent'|'error'|'parseError'|
  'done', ...}`) into the same `onHostMessage()`/`onDevice()`/`displayResult()` pipeline — don't
  special-case one transport's device shape without checking the other still matches.

## After changing `src/shared/` or `examples/server.ts`

- Update the matching section of `docs/architecture.md` in the same change (data flow, the
  transport table, or the `/settings`/known-devices design, whichever changed).
- Run `npm run build` (builds **both** `dist/chrome-extension/` and `dist/nodejs/`) — not just
  `build:extension` or `build:node` alone — and verify both outputs, since a change here always
  touches both.
- If the change is a non-obvious decision worth preserving beyond just the architecture doc (a
  redesign, a real bug fix with a root cause, a naming/scope call), add an entry to this repo's
  root `MEMORY.md`, matching its existing entries' style.
