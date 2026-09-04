---
name: window-ui
description: Consult and update docs/window-ui/ (MRD/PRD/SRS/DESIGN/TC) whenever reading or changing src/shared-v2/ (window.html, window.ts, modules/*.ts). Use before modifying any of these to learn the spec/deviations-from-legacy this reimplementation follows; use after to keep docs/window-ui/ in sync and verify the build (build:shared-v2[:dev]) still works.
---

# `src/shared-v2/` — spec-driven reimplementation — read before, update after

`src/shared-v2/window.html`/`window.ts`/`modules/*.ts` is a from-scratch, independently-written
reimplementation of `src/shared/`'s `window.html`/`window.ts`, built directly from a full spec —
see [`docs/window-ui/`](../../../docs/window-ui/) (start at `DESIGN.md`'s "`src/shared-v2/`
module structure" section, and `MRD.md`/`PRD.md`/`SRS.md`/`TC.md` for the rest of the set).

**Not the same thing as `src/shared/`.** That tree has its own skill,
[`shared-window`](../shared-window/SKILL.md), scoped to `docs/architecture.md` — this skill's
checklist is scoped to `src/shared-v2/` specifically and does not apply to `src/shared/` changes,
or vice versa. **Caveat, same as `shared-window`'s**: `npm run build:shared-v2`/`build:shared-v2:dev`
overwrite `dist/chrome-extension/`'s and `dist/nodejs/examples/public/`'s `window.html`/`window.js`/
`scripts/socket.js` with this tree's build once a `dist/chrome-extension/`/`dist/nodejs/` assemble
already exists to overwrite (see `CLAUDE.md` and `docs/window-ui/MRD.md`'s History) — plain
`npm run build` already chains both steps in the right order, so that's the version that actually
ships from a single `npm run build`, even though `src/shared/` itself stays untouched.

## Before touching `src/shared-v2/`

Read `docs/window-ui/DESIGN.md` first, in particular:

- "Deviations from legacy behavior" — intentional, documented divergences from `src/shared/`'s
  behavior (some fixed bugs not reproduced, some redesigned flows like FR-7.8's Calendar search
  and the Event Timeline widget) — don't "fix" one of these back toward legacy without checking
  this list first; the equivalence test suite (`tests/window-ui-equivalence/`) asserts on the
  deviation, not the legacy behavior, for each entry here.
- The relevant `FR-*` section of `docs/window-ui/SRS.md` for the area being changed.
- If the change touches the Playback Calendar/Event Timeline specifically, also read
  [`docs/calendar-component/`](../../../docs/calendar-component/) and/or
  [`docs/event-timeline-component/`](../../../docs/event-timeline-component/) — those components'
  own MRD/PRD/SRS/DESIGN/TC sets are the source of truth for their internals, not just
  `docs/window-ui/DESIGN.md`'s summary of them.
- `IS_EXTENSION`-guarding (`device.ts`/`discovery.ts`/`playerEvents.ts`/`toolbar.ts` all branch on
  it) still applies here exactly as `shared-window`'s equivalent note describes for `src/shared/`
  — an unguarded `chrome.*` reference throws outside the extension.

## Building for browser debugging

`src/shared-v2/vite.config.ts` sets `build.sourcemap: true` unconditionally, so both
`npm run build:shared-v2` and `npm run build:shared-v2:dev` emit a `window.js.map` — the browser
DevTools Sources panel shows the original `src/shared-v2/modules/*.ts` files (not the bundled
`window.js`) either way; set a breakpoint or a right-click **Add logpoint** directly on the
`.ts` source line. `build:shared-v2:dev` additionally passes `--mode development` through to Vite,
which the config reads to skip minification (`minify: mode !== 'development'`) for fully readable
non-mapped-back output — same pattern as the `@melchi45/rtsp-over-websocket` package's own
`build:player`/`build:player:dev` (see that package's `MEMORY.md`). Neither script changes
`IS_EXTENSION`/runtime behavior, only build-time minification.

If debugging into `@melchi45/rtsp-over-websocket` itself (e.g. `<rtsp-over-websocket>`'s own
`timestamp` event or `RTSPOverWebSocket.ts` internals, not just this repo's own
`playerEvents.ts`/`playback.ts` listeners) — that package's own sourcemaps only resolve if its
locally-built `dist/` (with `sourcemap: true`) is what's actually installed. A plain
`npm install`-from-registry copy may predate that package's own sourcemap support; see that
repo's `README.md`/`CLAUDE.md` "Build & run" for its own `build:player`/`build:player:dev`, and
this repo's own `package.json` `dependencies` entry for whether it's currently pointed at a local
checkout (`file:...`) or the published registry version.

## After changing `src/shared-v2/`

**Do this for every change that touches these files, not just the first one in a session** — same
"every edit, not just the first" rule `shared-window`'s equivalent note states. Do not report a
`src/shared-v2/` change as finished until this list is done for *that* change:

- Update the matching section of `docs/window-ui/DESIGN.md` (and `SRS.md`/`TC.md` if requirements
  or test cases changed) in the same change, including its History table (see `DESIGN.md`'s own
  header for the Version/Date/Author/Description row format used there).
- If the change touched the Playback Calendar/Event Timeline, also keep
  `docs/calendar-component/`/`docs/event-timeline-component/` in sync, not just
  `docs/window-ui/DESIGN.md`'s summary of them.
- Run `npm run build` (chains the base build + `build:shared-v2` automatically — see `CLAUDE.md`)
  and verify the result. For a quick browser-debug iteration loop that skips redoing the slower
  base build every time, `npm run build:shared-v2`/`build:shared-v2:dev` still work standalone, but
  only have something to overwrite once a `dist/chrome-extension/`/`dist/nodejs/` assemble already
  exists — a standalone `build:shared-v2` with neither present only produces the non-shipping
  `dist/shared-v2-preview/`.
- If `tests/window-ui-equivalence/` exercises the changed area, re-run it (`npx playwright test`,
  needs `npm run build` first) — it's the mechanism that catches an unintended drift from
  `src/shared/`'s behavior beyond the documented deviations.
- If the change is a non-obvious decision worth preserving beyond the spec docs (a redesign, a
  real bug fix with a root cause, a naming/scope call), add an entry to this repo's root
  `MEMORY.md`, matching its existing entries' style.
