# CLAUDE.md

Guidance for Claude Code (or any agent) working in this repository.

## What this is

WiseNet/Hanwha Chrome IP Installer — a Chrome extension (`dist/chrome-extension/`, "Load
unpacked") for discovering and viewing Wisenet cameras/NVRs, plus a standalone Node.js UDP
discovery package (`dist/nodejs/`, `wisenet-udp-discovery` on npm). Both consumers share the
same SUNAPI wire-format implementation (`src/sunapi/`) and, since the dual-target UI change, the
same `window.html`/`window.ts` front end (`src/shared/`) — see
[docs/architecture.md](docs/architecture.md) for the full write-up before touching either.

TypeScript sources live under `src/`; `dist/` and `build/` are generated/gitignored — always
rebuild after pulling.

## Build & run

```bash
npm install
npm run build              # both dist/chrome-extension/ and dist/nodejs/
npm run build:extension    # just the extension side (background.ts + shared window.ts/socket.ts + Vite bundle)
npm run build:node         # just tsc -p tsconfig.node.json
npm run build:shared-v2    # builds src/shared-v2/ to dist/shared-v2-preview/, and (if dist/chrome-extension/ or
                            # dist/nodejs/examples/public/ already exist) also overwrites their window.html/
                            # window.js/scripts/socket.js/css/calendar.css/css/event-timeline.css with it --
                            # run AFTER npm run build
npm run build:shared-v2:dev # same as build:shared-v2, unminified (vite build --mode development) --
                            # for browser debugging; sourcemaps are on for both, see below
npm run start               # builds dist/nodejs/, then dist/shared-v2-preview/ (overwriting dist/nodejs/'s shared
                             # web assets per the above), then runs the example server (http://localhost:8080/)
npm run clean               # removes dist/ and build/
```

Load `dist/chrome-extension/` unpacked in `chrome://extensions` (Developer mode) to run the
extension. The native messaging host (`native-host/`) needs a one-time install per-machine —
see [`src/chrome-extension/native-host/README.md`](src/chrome-extension/native-host/README.md).

## Environment gotchas

- **WSL/DrvFs file locking**: if this repo lives on a `/mnt/<drive>/...` mount, real-time
  antivirus (e.g. Windows Defender) transiently locks files as they're written/deleted,
  surfacing as `ENOENT`/`EACCES`/`ENOTEMPTY` on operations that are actually fine a moment
  later. `scripts/build.js`'s `retryOnTransientFsError` rides this out with backoff — if you
  see one of these errors from a *different* script, the same retry pattern is the fix, not a
  real bug.
  If `retryOnTransientFsError` exhausts all its retries (`rm -rf dist/chrome-extension` failing
  with `EBUSY`/`ENOTEMPTY`/"Permission denied" on `native-host/` specifically, repeatedly, not
  just once), that's *not* the transient antivirus case above — it means something on the Windows
  side is actively holding that folder open, almost always Edge/Chrome still running with the
  extension loaded (a spawned native-host `node.exe` can also hold it, though in practice the
  browser itself was the culprit every time this came up). Fully closing the browser (not just its
  windows — check `Get-Process msedge`/`Get-Process chrome` in PowerShell come back empty) clears
  it; killing an individual lingering `node.exe` from `Get-CimInstance Win32_Process -Filter
  "Name = 'node.exe'"` is the lower-friction alternative when you don't want to lose other browser
  state. `npm run build:extension` alone (skips the `dist/` clean+assemble step) still works for
  verifying the TypeScript/Vite side compiles while the lock is in place.
- **WSL2 can't reach real UDP-broadcast devices**: run discovery-testing tools (native host,
  `npm run start`) from a real Windows process, not inside WSL bash — WSL2's virtual/NAT
  network isn't on the same broadcast domain as your physical LAN, so `dgram`/native UDP either
  finds nothing or fails to bind at all, with no useful error either way. See `README.md`'s
  networking note for the full explanation.
- **`src/shared/` changes affect both `dist/` outputs** — `npm run build` builds both; don't
  assume a fix verified only against the extension (or only against the example server) is done.
  See `docs/architecture.md`'s own closing note.
- **`npm install` fails with `EALLOWREMOTE` on a fresh clone**: `@melchi45/rtsp-over-websocket`
  is a private GitHub Packages dependency — resolving it needs a `.npmrc` with
  `@melchi45:registry=https://npm.pkg.github.com` plus an authenticated token
  (`read:packages` scope), which isn't checked into the repo (see `.gitignore`). Run
  `node scripts/setup-github-packages-auth.js <PAT>` once per machine before `npm install`.
  Without that `.npmrc`, npm 11+'s `allow-remote: none` default blocks the tarball fetch because
  the resolved download host (`npm.pkg.github.com`) doesn't match the *unconfigured* default
  registry (`registry.npmjs.org`) — the fix is the `.npmrc`, not disabling `allow-remote`.
- **Self-signed camera certificate → `net::ERR_CERT_AUTHORITY_INVALID`**: Chrome blocks the SUNAPI
  HTTPS request at the browser level before any extension code sees it — this is a browser TLS
  trust decision, not something `host_permissions`/`manifest.json` can override. The safe fix is
  opening the camera's URL in a tab once and accepting the certificate exception; the extension
  also has an opt-in "Bypass Untrusted Certificate (Native Host)" checkbox that avoids that manual
  step via the native messaging host — see
  [docs/native-https-proxy/](docs/native-https-proxy/) (PRD/MRD/SRS/DESIGN/TC) for the full spec
  before touching `src/shared/scripts/nativeSunapiClient.ts` or
  `native-host/wisenet-udp-host.ts`'s `httpRequest` command.

## Conventions

- This codebase has Korean comments throughout `window.ts` and elsewhere — that's expected and
  fine to keep/add to; there's no English-only rule here.
- `dist/` and `build/` are pure build output — don't hand-edit anything there.
- Prefer small, targeted edits — `window.ts` in particular is large (~3,000 lines) and has
  latent quirks from its jQuery-era history (see `MEMORY.md`); check whether a comment nearby
  explains *why* something looks odd before "fixing" it.
- See [`MEMORY.md`](MEMORY.md) for non-obvious past decisions and bugs found/fixed in this repo.
- **Every `src/shared/` change updates `docs/architecture.md` in the same change, not just the
  first change of a session.** This applies per-edit, not per-conversation — a session that
  touches `window.ts`/`window.html`/`window.css` five separate times needs `docs/architecture.md`
  (and a `MEMORY.md` entry, for anything non-obvious) updated five times, not once at the start
  and then treated as covered for the rest. Do not report a `src/shared/` change as finished
  without having done this for that specific change — see the `shared-window` skill for the full
  checklist.
- The discovery result panel has a Table/Star Topology toggle with a Group by selector
  (`#discovery_view_type`/`#discovery_topology_group_by` in `window.html`,
  `renderDiscoveryTopology()` in `window.ts`) — read
  [`docs/star-topology/`](docs/star-topology/) (MRD/PRD/SRS/DESIGN/TC) before changing
  grouping, search-filter, or `vis.Network` interaction behavior there; `docs/architecture.md`'s
  "Discovery result views" section is only a brief pointer to it, same as for
  `docs/native-https-proxy/`.
- Every switch/toggle-looking control in `window.html` (dark mode, HTTP/HTTPS, Live/Playback, the
  Playback 1 Day/3 Month range, SUNAPI On/Off) is mounted through `src/component/switch/`'s
  `mountSwitch()`, not hand-rolled markup — read [`docs/switch-component/`](docs/switch-component/)
  (MRD/PRD/SRS/DESIGN/TC) before adding a new switch or changing an existing one's variant/options/
  CSS.
- The three collapsible log panels (Debug Information, Discovery, RTSP) are built on native
  `<details>`/`<summary>` via `src/component/disclosure/`'s `mountDisclosure()`, not a hand-rolled
  `aria-expanded` widget — read [`docs/disclosure-component/`](docs/disclosure-component/)
  (MRD/PRD/SRS/DESIGN/TC) before adding a new collapsible panel or a new header control to an
  existing one.
- The Playback recording timeline (`#timeline` in `window.html`, `updateTimeline()` in
  `src/shared-v2/modules/playback.ts`) is a hand-rolled widget mounted via
  `src/component/event-timeline/`'s `mountEventTimeline()` — a collapsible "ALL EVENTS" overview/
  zoom-scrubber row plus one detail row per distinct Rule#, no charting library, replacing the
  vendored `vis` package's `vis.Timeline` used here previously. Read
  [`docs/event-timeline-component/`](docs/event-timeline-component/) (MRD/PRD/SRS/DESIGN/TC) before
  changing its zoom/pan/row/coloring behavior. `vis` itself is still a real dependency — Star
  Topology's `vis.Network` (`docs/star-topology/`) is unaffected and unchanged.
- `src/shared-v2/` is a from-scratch, independently-written reimplementation of `src/shared/`'s
  `window.html`/`window.ts`, built directly from a full SDD spec — read
  [`docs/window-ui/`](docs/window-ui/) (MRD/PRD/SRS/DESIGN/TC) before touching it; the
  [`window-ui`](.claude/skills/window-ui/SKILL.md) skill (mirroring `src/shared/`'s
  `shared-window` skill) has the full before/after checklist. `src/shared-v2/vite.config.ts` sets
  `sourcemap: true` unconditionally, so `npm run build:shared-v2`/`build:shared-v2:dev` both emit
  a `window.js.map` — the browser debugger steps through the original `src/shared-v2/modules/*.ts`
  either way; `build:shared-v2:dev` additionally skips minification (`--mode development`) for
  fully readable output, same pattern as `@melchi45/rtsp-over-websocket`'s own
  `build:player`/`build:player:dev`. `src/shared/`
  itself is untouched (still a separate source tree, `npm run build:shared-v2` is still its own
  build target, not part of plain `npm run build`), but its **build output is no longer isolated**:
  `npm run build:shared-v2`, run after `npm run build` (or `npm run start`, which chains both),
  overwrites `dist/chrome-extension/`'s and `dist/nodejs/examples/public/`'s `window.html`/
  `window.js`/`window.js.map`/`scripts/socket.js` (and adds `css/calendar.css`/
  `css/event-timeline.css`) with the `src/shared-v2/` build —
  see `scripts/build.js`'s `buildSharedV2()` and `docs/window-ui/MRD.md`'s History (this reverses
  that doc's original "parallel, not in-place" call, per explicit user instruction). A standalone
  `npm run build:shared-v2` (no prior `npm run build`) still just produces the side,
  non-shipping `dist/shared-v2-preview/` alone, unharmed. Verified against the original for
  functional equivalence by `tests/window-ui-equivalence/` (Playwright; run `npx playwright test`,
  needs `npm run build && npm run build:shared-v2` first), backed by `tools/mock-sunapi-server/`
  (canned SUNAPI responses) and `tools/equivalence-test-server/` (serves either page + a fixture WS
  `/discover` feed). A handful of intentional, documented deviations from the original's behavior
  exist (e.g. two real legacy crash bugs are *not* reproduced) — see `docs/window-ui/DESIGN.md`'s
  "Deviations from legacy behavior" and the corresponding test cases in
  `docs/window-ui/TC.md`/`tests/window-ui-equivalence/` before assuming a mismatch is a new bug
  rather than a known, asserted-on-purpose asymmetry. Playwright only ever drove the nodejs runtime
  target (`IS_EXTENSION=false`) — the extension-only `IS_EXTENSION`-gated code paths (native-host
  bypass checkbox, `chrome.*` APIs) are untested by that suite and are now load-bearing in the real
  shipped extension; see `docs/window-ui/PRD.md`'s Non-Goals.
- Playback + SUNAPI On shows a Calendar-driven search flow (Language/Rule pickers feeding
  `eventrules.cgi`, a month calendar highlighting days with recordings, day-click → automatic
  Overlapped Id/Timeline search) instead of the manual date-range flow. This is `src/shared-v2/`-
  only in *source* (no equivalent code in `src/shared/`), but since `npm run build:shared-v2`
  overwrites the shipped `dist/` outputs (see above), it's what actually ships in
  `dist/chrome-extension/`/`dist/nodejs/` once that step has run. Read
  [`docs/window-ui/SRS.md`](docs/window-ui/SRS.md)'s FR-7.8 and
  [`docs/calendar-component/`](docs/calendar-component/) (MRD/PRD/SRS/DESIGN/TC, the new
  `src/component/calendar/` this uses) before touching `src/shared-v2/modules/playbackCalendar.ts`
  or the old manual-flow `#playback_control` panel it sits alongside.
