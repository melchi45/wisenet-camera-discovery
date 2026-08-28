# DESIGN — Window UI Full Specification & Reimplementation

| | |
|---|---|
| Title | Window UI Full Specification & Reimplementation — Design Document |
| Abstract | `src/shared-v2/` module structure, the mock-SUNAPI server, and deviations from legacy behavior. |
| Status | Draft |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [PRD](PRD.md) · [MRD](MRD.md) · [SRS](SRS.md) · [TC](TC.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-28 | Youngho Kim | Initial DESIGN. |
| 1.1 | 2026-08-28 | Youngho Kim | "Deviations from legacy behavior": confirmed live via Playwright (TC-26) that the `element.device` stray-global bug is a real, always-reproducible crash (NVR + SUNAPI-on fails on the original every time), not a dormant/theoretical one as first written. |
| 1.2 | 2026-08-28 | Youngho Kim | Added a third deviation: `updateTimeline()` now `fit()`s the visible window to the actual item range instead of the original's hardcoded "today" window, which left real (non-today) recordings invisible — reported directly by the user against a real device, not found via equivalence testing. |
| 1.3 | 2026-08-28 | Youngho Kim | `getTimeline` endpoint table row corrected to the real `{TimeLineSearchResults: [...]}` envelope — the mock server's fixture (and `src/shared-v2/playback.ts`'s own unwrapping) had matched each other on a wrong, unwrapped shape, which real-device testing (not equivalence testing) caught. This is a genuine `src/shared-v2/` bug fix, not a new deviation entry — see SRS.md FR-7.3. |
| 1.4 | 2026-08-28 | Youngho Kim | Retracted v1.2's "hardcoded to today" deviation entirely — a misdiagnosis. `vis.Timeline` already auto-fits to real item data on `setItems()`; the `fit()`/`setWindow()` call added to "fix" it broke rendering entirely at real (~150-item) data volume once tested live, rather than fixing anything. Removed the call; the true root cause of the user's original report was v1.3's envelope-unwrapping bug. |
| 1.5 | 2026-08-28 | Youngho Kim | Added a fourth deviation: `sunapiInitInFlight` + a same-value check on username/password `change` handlers, eliminating redundant `initSunapiManager()` chains. Found via CPU profiling + live network-request counting after the user's follow-up performance report — vis.Timeline's own rendering was already confirmed fast; the real cost was redundant SUNAPI round trips. |

## `src/shared-v2/` module structure

One module per SRS section, all imported from a single `window.ts` entry point (still one Vite
bundle, same pattern `src/shared/vite.config.ts` already uses) — this is the one deliberate
structural improvement over the original (a single 3,700-line file): splitting by SRS section makes
each module's own scope match one FR group exactly, so a future spec change maps to one file, not a
grep through the whole thing.

```
src/shared-v2/
  window.html                 (fresh markup, same ids/classes where a reused library requires them)
  window.ts                   (entry point: DOMContentLoaded wiring, imports every module below)
  modules/
    state.ts                   (FR-15: selected_player_id, _useDebug, deviceInformation, device,
                                visTimeline, timelineRangeSwitch, sunapiManager singleton,
                                nativeSunapiClient, dataSet, discovery sort/search/topology state)
    helpers.ts                  (FR-15: errorDetails, fastJsonStringfy, getSelectedPlayer, createEl,
                                getCapabilityValue, applySearchByUTCTimeCapability,
                                gettimezonestring, checkUserAccount, checkEventSubGroup/
                                checkAIEventSubGroup, scrollbottom/scrollbottomrtsp)
    toolbar.ts                  (FR-1)
    discovery.ts                 (FR-2 — table + topology; satisfies docs/star-topology/'s SRS too,
                                reimplemented fresh, not copied)
    session.ts                   (FR-3)
    device.ts                     (FR-4 — satisfies docs/control-panel-data-binding.md §1/§3 too)
    videoProfile.ts                (FR-5 — satisfies docs/control-panel-data-binding.md §4 too)
    videoControl.ts                 (FR-6)
    playback.ts                      (FR-7 — satisfies docs/architecture.md's "Playback controls" too)
    audio.ts                          (FR-8)
    backup.ts                          (FR-9)
    instantPlayback.ts                  (FR-10)
    screen.ts                            (FR-11)
    debugPanels.ts                        (FR-12 — mounts docs/disclosure-component/ same as original)
    modals.ts                              (FR-13)
    playerEvents.ts                         (FR-14 — wires every <rtsp-over-websocket> listener,
                                            delegating into the modules above)
  css/                          (re-exported from src/shared/css/ — see PRD.md's Non-Goals)
  tsconfig.window.json, vite.config.ts   (mirrors src/shared/'s own, new outDir)
```

Reused unmodified (imported by relative path, never copied): `src/shared/scripts/socket.ts`,
`nativeSunapiClient.ts`, `nativeWebSocketTransport.ts`, `legacy-globals-bridge.js`; `src/component/
switch/`, `src/component/disclosure/`; `src/sunapi/` (only indirectly, via the vendored player).

## Build wiring

`scripts/build.js` gains a `buildSharedV2()` step, modeled on the existing shared-asset build but
targeting `dist/shared-v2-preview/` — **not** `dist/chrome-extension/`/`dist/nodejs/`. Run via a new
`npm run build:shared-v2` script, and from the top-level `npm run build` too (additive, so the real
outputs are never at risk — see [PRD.md](PRD.md)'s Non-Goals and [MRD.md](MRD.md)'s "parallel, not
in-place" reasoning). Served for Playwright via a small static file server (same minimal pattern
`src/nodejs/examples/server.ts` already uses for `dist/nodejs/examples/public/`).

## Mock-SUNAPI server (`tools/mock-sunapi-server/`)

A minimal Node `http` server standing in for a real camera's SUNAPI REST interface, so Playwright
can exercise the full `initSunapiManager()` chain (SRS FR-4.5) without real hardware. Endpoints are
named at the `SunapiManager` *operation* level here; exact CGI paths/query parameters are confirmed
by inspecting the vendored `@melchi45/rtsp-over-websocket` bundle
(`node_modules/@melchi45/rtsp-over-websocket/dist/player/rtsp-over-websocket.esm.js`, which calls
`stw-cgi/attributes.cgi` and related `stw-cgi/*.cgi` endpoints) at implementation time, not guessed:

| Operation | Canned response shape |
|---|---|
| `init` (attributes) | `{Initialized: true, IsAndroid: false, SearchByUTCTime: true, MaxChannel: 1}` |
| `getVideoSource` | one entry per configured mock channel: `{Channel, VideoSourceToken, SensorCaptureFrameRate}` |
| `getVideoProfilePolicyAll` | `{Channel, DefaultProfile, EventProfile, RecordProfile}` per channel |
| `getVideoProfile` | `{Channel, Profiles: [{Profile, Name, EncodingType, Resolution, FrameRate, Bitrate}, ...]}` per channel |
| `getTimezoneInfo` | `{TimeZones: [{TimeZone: "... (GMT+09:00) ..."}, ...]}` |
| `getDateInfo` | `{TimeZoneIndex: <n>}` |
| `getCalendarSearch` | a `CalenderSearchResults` bitmask map covering a small fixed date range, enough to exercise FR-7.2 |
| `getOverlappedIdList` | a short fixed list of ids, enough to exercise FR-7.1 |
| `getTimeline` | `{TimeLineSearchResults: [{Channel, Results: [{Result, Type, StartTime, EndTime}, ...]}]}` — ~150 short Normal/Event segments, enough to exercise FR-7.6 at a realistic volume |

401 Digest-auth challenge/response is **not** mocked — the native-proxy path is Chrome-extension-only
(PRD.md Non-Goals) and the plain-XHR path (the one Playwright's nodejs-target tests exercise) doesn't
go through the native host's Digest logic at all; the mock server just returns `200` directly.

## Deviations from legacy behavior (intentional, listed so equivalence tests don't chase them)

- **Dead controls stay dead, not `ReferenceError`-throwing.** SRS's "Known dead controls" table is
  reproduced as *no listener at all* rather than literal `onclick="undefinedFn()"` attributes — from
  a user's perspective both are indistinguishable ("nothing happens"), and intentionally shipping
  code that throws has no upside. See [MRD.md](MRD.md)/[PRD.md](PRD.md).
- **`element.device === 'nvr'` stray-global bug (original `window.ts` line ~2087, inside
  `initSunapiManager()`'s `getDateInfo()` branch) is not reproduced.** The original reads a leftover
  `element` variable instead of `getSelectedPlayer()` — almost certainly an unintentional copy-paste
  artifact (the surrounding branch is otherwise 100% `getSelectedPlayer()`-based), narrow (NVR-only
  `dateInfo` branch), and reproducing a variable-scoping accident on purpose would be actively
  confusing to anyone reading `src/shared-v2/` later. **Confirmed live (Phase 4 Playwright testing,
  not just read from source): `element` resolves to `undefined` at call time, not a stale-but-valid
  element — `element.device` throws a real `TypeError`, which `initSunapiManager()`'s own `.catch()`
  converts into an unconditional `use_sunapi_client_checkbox.checked = false`. This is a real,
  reproducible bug in the shipped product (NVR device type + "Use SUNAPI" always fails), not a
  dormant/theoretical one** — see `docs/window-ui/TC.md`'s TC-26. `src/shared-v2/`'s `device.ts` uses
  `getSelectedPlayer().device === 'nvr'` instead, which succeeds where the original throws — TC-26
  asserts that exact asymmetry (old fails, new succeeds), not equality.
- **`initSunapiManager()` no longer fires overlapping/redundant chains.** The original has no guard
  at all — every one of its ~12 call sites (device.ts's `changehostname`/`changeport`/
  `changechannel`/`changehttptype`, `on_change_use_sunapi_client`; session.ts's `onPlayerSelect`
  ×2 and username/password `change` handlers; playback.ts's `search_overlapped_id`/`search_date`/
  `runTimelineSearch`) can independently trigger a full ~6-7-sequential-round-trip chain (attributes
  → videosource → videoprofilepolicy → videoprofile → timezone → dateinfo). Reported by the user as
  a real-device performance complaint ("vis.Timeline display speed too slow"); CPU profiling
  (Chrome DevTools Protocol `Profiler`, via Playwright) showed `vis.Timeline`'s own rendering is
  under 50ms and identical on both pages — the wall-clock cost is almost entirely these SUNAPI round
  trips, which are near-free on `tools/mock-sunapi-server/`'s localhost but real, compounding
  network latency against an actual camera. Two independent, targeted fixes, not a rewrite of the
  call-site pattern itself:
  - `state.sunapiInitInFlight` (a simple boolean guard) makes `initSunapiManager()` a no-op while a
    previous call's chain hasn't finished yet — covers genuinely-overlapping triggers (e.g. Search
    Date fired before the initial "Use SUNAPI" chain reaches its own `sunapiClient` assignment).
  - `session.ts`'s `#username`/`#password` `change` handlers now skip re-init when the field's value
    didn't actually change. Found live, not by reading source: clicking `#use_sunapi_client_checkbox`
    right after filling in credentials moves focus away from `#password`, and the *browser's own*
    blur-triggered `change` event fires there even though nothing was edited — the original's
    unconditional re-init turns that into a second full chain for free, every single time SUNAPI is
    turned on right after typing a password. `docs/window-ui/TC.md`'s TC-27 asserts exactly one
    `attributes.cgi` request for this sequence (new page only — the original still double-fires).
- ~~`updateTimeline()`'s visible window is fit to the actual item range, not hardcoded to
  "today".~~ **Retracted (2026-08-28) — this was a misdiagnosis, not a real deviation; see below.**
  `options.start`/`options.end` do read `new Date().setHours(0,0,0,0)`/`(23,59,59,999)` in the
  source, which looked like a hardcoded-to-today bug on paper. But `vis.Timeline` (this vendored
  4.20 build) auto-fits its visible window to the actual item range the first time `setItems()` is
  called with real data — those `start`/`end` options only matter before any items exist, so the
  original's `updateTimeline()` was never actually broken this way. A `visTimeline.fit(...)`/
  `setWindow(...)` call added here to "fix" it (tested only against a 3-item fixture, where it
  happened to look like it worked) turned out to actively **break** rendering once tested against
  a larger, realistic dataset (~150 items, matching a real-device report) — it rendered zero
  `.vis-item` elements, vs. the original's 150, in a live side-by-side comparison. Removed
  entirely; `src/shared-v2/playback.ts` now just lets `setItems()`'s own auto-fit run, matching the
  original exactly. The lesson: a source-reading-only diagnosis (no live comparison, small fixture)
  produced a plausible-sounding fix for a bug that didn't exist, which then caused a real one —
  see this doc's History and `docs/window-ui/TC.md`'s TC-18 for how a live, larger-scale comparison
  caught it.
