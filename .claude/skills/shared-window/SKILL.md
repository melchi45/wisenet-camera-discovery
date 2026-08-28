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

- If the change touches SUNAPI client selection (`initSunapiManager()`, `getSunapiManager()`,
  or anything under `src/shared/scripts/nativeSunapiClient.ts`), also read
  `docs/native-https-proxy/` (PRD/MRD/SRS/DESIGN/TC) first — that's the source of truth for the
  "Bypass Untrusted Certificate (Native Host)" feature's `SunapiClientLike`/`attach()` contract,
  not just `docs/architecture.md`'s brief pointer to it.
- If the change touches the discovery result Group by/topology behavior
  (`renderDiscoveryTopology()`, `#discovery_view_type`/`#discovery_topology_group_by`, or the
  search-box filtering / `vis.Network` interaction handling that feeds it), also read
  `docs/star-topology/` (PRD/MRD/SRS/DESIGN/TC) first — that's the source of truth for the
  per-type grouping-key/hub-label rules and, in `DESIGN.md`'s "Interaction stability" section, why
  the `vis.Network` instance is destroyed and reconstructed on every render rather than reused —
  not just `docs/architecture.md`'s brief pointer to it.

## After changing `src/shared/` or `examples/server.ts`

**Do this for every change that touches these files, not just the first one in a session** — a
long back-and-forth that makes five separate edits to `window.ts`/`window.html`/`window.css`
needs this checklist five times, once per edit, not once at the start. Re-reading this file
before the *first* edit and then treating the rest of the conversation as "already covered" is
the actual failure mode this note exists to head off — it has happened before. Do not report a
`src/shared/` change as finished until this list is done for *that* change:

- Update the matching section of `docs/architecture.md` in the same change (data flow, the
  transport table, or the `/settings`/known-devices design, whichever changed) — including
  something as small as a new file under `scripts/`/`css/` added to support the change (add it to
  the file-tree listing near the top of that doc, don't just leave it undocumented because the
  change "was really about" something else).
- If the change touched the native-proxy SUNAPI client selection noted above, also keep
  `docs/native-https-proxy/` in sync (its `DESIGN.md`/`SRS.md` in particular) — don't let
  `docs/architecture.md`'s one-paragraph summary drift from that folder's fuller spec.
- If the change touched the Group by/topology behavior noted above, likewise keep
  `docs/star-topology/` in sync (its `SRS.md`/`DESIGN.md` in particular).
- `src/component/*` (reusable UI components `window.ts` imports by relative path — currently
  `switch/` for every switch/toggle-looking control, and `disclosure/` for the collapsible Debug
  Information/Discovery/RTSP panels) lives outside `src/shared/`, but each one is imported directly
  by `window.ts` and has its CSS copied into the same `dist/` output this skill covers — a change
  to any of them still counts as a `src/shared/` integration change for this whole checklist. Keep
  that component's own doc set in sync (`docs/switch-component/`, `docs/disclosure-component/` —
  each a full MRD/PRD/SRS/DESIGN/TC set per `docs/star-topology/`'s convention, not
  `docs/architecture.md`'s own one-paragraph pointer to it) whenever its `.ts`/`.css` changes, or a
  control using it is added/removed/reconfigured. A new component under `src/component/` should
  get its own doc set the same way (including the Title/Abstract/Status/Author/Milestone/Related
  docs header table and `## History` section every `docs/*.md` file carries), plus a one-line
  pointer added here.
- Run `npm run build` (builds **both** `dist/chrome-extension/` and `dist/nodejs/`) — not just
  `build:extension` or `build:node` alone — and verify both outputs, since a change here always
  touches both.
- If the change is a non-obvious decision worth preserving beyond just the architecture doc (a
  redesign, a real bug fix with a root cause, a naming/scope call), add an entry to this repo's
  root `MEMORY.md`, matching its existing entries' style.
