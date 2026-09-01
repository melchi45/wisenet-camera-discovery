# PRD — Window UI Full Specification & Reimplementation

| | |
|---|---|
| Title | Window UI Full Specification & Reimplementation — Product Requirements Document (PRD) |
| Abstract | Problem, goals, non-goals, users, and success criteria for the full `window.html`/`window.ts` spec and its `src/shared-v2/` reimplementation. |
| Status | Draft |
| Component | `src/shared-v2/` (new), `docs/window-ui/`, `tools/mock-sunapi-server/`, `tests/` |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [MRD](MRD.md) · [SRS](SRS.md) · [DESIGN](DESIGN.md) · [TC](TC.md) · [../architecture.md](../architecture.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-28 | Youngho Kim | Initial PRD. |
| 1.1 | 2026-08-28 | Youngho Kim | The "wiring in is future work" Non-Goal below happened: `npm run build:shared-v2` now overwrites `dist/chrome-extension/`/`dist/nodejs/`'s shared web assets — see [MRD.md](MRD.md) History and `scripts/build.js`'s `buildSharedV2()`. Flagged the still-untested `IS_EXTENSION`-gated paths as a live risk, not just a Non-Goal, now that they're load-bearing in the shipped extension. |

## Problem

`src/shared/window.html`/`window.ts` has no complete specification, and reading it end to end
surfaced real dead controls no prior partial documentation pass had found (see [MRD.md](MRD.md)).

## Goals

- A complete SRS covering every control and behavior in `window.html`/`window.ts` — all 15 panel/
  behavior groups from the full-file inventory, including the "dead controls" negative space.
- A new, independently-written implementation (`src/shared-v2/`) built from that SRS, not copied
  from the original source, that reuses this repo's already-correct lower-level infrastructure
  (SUNAPI wire format, transport, native-proxy, the switch/disclosure components, the vendored
  RTSP player, `vis`) rather than reimplementing it.
- Automated Playwright verification that the new implementation is functionally equivalent to the
  original, run against both a synthetic-discovery-only flow and a mock-SUNAPI-backed flow (see
  [DESIGN.md](DESIGN.md)), iterated until green.

## Non-Goals

- **Not a visual redesign.** Same CSS, same classes; the goal is behavioral equivalence, not new
  styling.
- **Not an in-place replacement of `src/shared/`.** `src/shared/`'s own source is untouched — this
  is still a parallel, independently tested source tree, not a rewrite of the original. Its
  *build output*, however, is no longer isolated: per explicit user instruction, `npm run
  build:shared-v2` (run after `npm run build`) now overwrites `dist/chrome-extension/`'s and
  `dist/nodejs/examples/public/`'s shared web assets (`window.html`/`window.js`/`scripts/socket.js`,
  plus `css/calendar.css`) with the `src/shared-v2/` build — see [MRD.md](MRD.md)'s History and
  `scripts/build.js`'s `buildSharedV2()`. This happened once (and only once) the Playwright suite
  was green, matching the original conditional here.
- **Not a reimplementation of SUNAPI wire parsing, RTSP transport/demuxing, or the discovery UDP
  protocol.** `src/sunapi/`, `socket.ts`, `nativeSunapiClient.ts`/`nativeWebSocketTransport.ts`, and
  the vendored `@melchi45/rtsp-over-websocket` package are reused unmodified — see [MRD.md](MRD.md)'s
  alternatives.
- **Not verified against a real camera or real RTSP video stream.** This sandbox cannot reach a real
  Wisenet device (`CLAUDE.md`'s WSL2 networking note). A mock-SUNAPI HTTP server stands in for
  SUNAPI's REST responses; actual video frame rendering is out of scope for automated verification
  — see [TC.md](TC.md)'s explicit boundary list.
- **Not verified against the Chrome extension target.** Playwright drives the nodejs runtime target
  only (`IS_EXTENSION=false`) — packing/loading-unpacked/native-host installation isn't automatable
  here. `IS_EXTENSION`-gated code paths were implemented for spec completeness but never live-tested
  — **this is now a live risk, not just an out-of-scope note**, since v1.1's build-output overwrite
  means these paths are load-bearing in the actual shipped `dist/chrome-extension/`. Loading the
  extension unpacked and manually exercising it (native-host bypass checkbox, `chrome.*` APIs) is
  recommended before relying on it in production.
- **Dead controls are not "fixed."** Every currently-nonfunctional control (§ SRS "Known dead
  controls") stays inert in the new implementation too — this PRD is about equivalence, not
  improvement.

## Users

Whoever next needs to understand, extend, or eventually migrate off `window.ts`'s single-file
structure — this SDD is the reference for what it actually does today, verified rather than assumed.

## Success Criteria

- `docs/window-ui/SRS.md` has an FR for every control/behavior group in the full-file inventory,
  including the dead-control list.
- `src/shared-v2/` builds cleanly (`tsc`/Vite, matching `src/shared/`'s own build pattern) without
  being wired into the real `dist/` outputs.
- The Playwright suite (`tests/window-ui-equivalence/`) passes running both pages against the same
  synthetic discovery data and the same mock-SUNAPI server responses, for every FR marked testable
  in this environment in [TC.md](TC.md).
- `npm run build` (the real product build) is unaffected throughout — verified after every phase,
  not just at the end.
