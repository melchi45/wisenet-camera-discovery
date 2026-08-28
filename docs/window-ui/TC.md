# TC — Window UI Full Specification & Reimplementation

| | |
|---|---|
| Title | Window UI Full Specification & Reimplementation — Test Cases (TC) |
| Abstract | Playwright equivalence test cases (old `src/shared/` vs. new `src/shared-v2/`), organized by SRS section, with an explicit not-verifiable-here boundary list. |
| Status | Draft |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [PRD](PRD.md) · [MRD](MRD.md) · [SRS](SRS.md) · [DESIGN](DESIGN.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-28 | Youngho Kim | Initial TC. |
| 1.1 | 2026-08-28 | Youngho Kim | TC-18: added an explicit assertion that the fitted timeline window contains the returned items, and moved the mock server's fixture timeline data off "today" so this is actually exercised — see DESIGN.md's `updateTimeline()` deviation. |
| 1.2 | 2026-08-28 | Youngho Kim | Corrected `tools/mock-sunapi-server/`'s `getTimeline` fixture to the real `{TimeLineSearchResults: [...]}` envelope (was unwrapped, matching a since-fixed bug in `src/shared-v2/playback.ts` — TC-15/16/18 passed against the wrong shape on both sides without ever exercising the real one) and scaled it to ~150 items to match a real-device report's volume. |
| 1.3 | 2026-08-28 | Youngho Kim | TC-18 rewritten from "new-page-only deviation" back to a real cross-page equivalence check — the "deviation" it was asserting (v1.1) was a misdiagnosis; testing at the new ~150-item fixture volume (v1.2) is what caught both the real envelope bug and the bogus `fit()` "fix" live. |
| 1.4 | 2026-08-28 | Youngho Kim | Added TC-27 — a real-device performance report led to CPU profiling that ruled out vis.Timeline rendering (confirmed <50ms, identical both pages) and live request-counting that found redundant `initSunapiManager()` chains instead; this test asserts the fix (FR-15.5). |

## Method

Every test case (except where noted) loads **both** the original page (`dist/nodejs/examples/
public/`) and the new page (`dist/shared-v2-preview/`) in separate Playwright contexts, performs the
identical action on each, and asserts identical resulting DOM state (value/checked/disabled/
visibility/text content of every element the SRS's corresponding FR names). "Data source" says
which of the two backing fakes a case needs:

- **Synthetic discovery** — a fake `discover` `CustomEvent` dispatched via `page.evaluate()`,
  exactly mirroring what `socket.ts` would dispatch on a real UDP reply. No SUNAPI/mock server
  needed — covers FR-2 (table/topology) entirely.
- **Mock SUNAPI** — the device fields point at `tools/mock-sunapi-server/`'s address; exercises the
  full FR-4.5/FR-5/FR-7 chains end to end.
- **Neither** — pure client-side logic (FR-1, FR-3, FR-6/8/9/10/11 button-state wiring, FR-12/13),
  no backing data needed at all.

| ID | SRS FR | Data source | Steps | Expected result |
|---|---|---|---|---|
| TC-1 | FR-1.1 | Neither | Click `#init`, then `#disconnect` | `#init`/`#disconnect` disabled state flips both times, identically on both pages. |
| TC-2 | FR-1.2 | Neither | Toggle `#auto_discovery_toggle`, reload | Persisted setting round-trips via `/settings`; Start/Stop disabled state matches on reload, identically on both pages. |
| TC-3 | FR-1.3 | Neither | Click the dark-mode switch | `data-theme` and the icon/label flip identically on both pages. |
| TC-4 | FR-2.1/FR-2.2/FR-2.4 | Synthetic discovery | Dispatch 5+ fake devices, type a search substring, click a column header twice | Filtered/sorted row sets and `#datatable_info` text match exactly between pages. |
| TC-5 | FR-2.3 (+ `docs/star-topology/TC.md`'s own cases, re-run here for equivalence) | Synthetic discovery | Switch to Star Topology, group by each of the 5 options, search | Node/edge sets and grouping match exactly between pages — this subsumes `docs/star-topology/TC.md`'s TC-1–TC-11 as equivalence checks, not fresh functional checks. |
| TC-6 | FR-2.5 (+ `docs/control-panel-data-binding.md` §1) | Synthetic discovery | Click a discovered row | Every field §1's table lists ends in the identical state on both pages. |
| TC-7 | FR-3.1 (+ `docs/control-panel-data-binding.md` §2) | Neither | Change `#player_list` | Every field §2's table lists matches, including the documented always-true-guard behavior. |
| TC-8 | FR-3.2/FR-3.3 | Neither | Change username/password/statistics | Player property writes match. |
| TC-9 | FR-4.1/FR-4.2/FR-4.4 | Neither | Change device type/hostname/port/profile | Player property writes match. |
| TC-10 | FR-4.5 (+ `docs/control-panel-data-binding.md` §3) | Mock SUNAPI | Fill in the mock server's address, turn SUNAPI on | Every field §3's tables list (attributes sync, capability gating, channel populate, timezone/date sync, final button state) matches, including the Turning-Off revert table. |
| TC-11 | FR-4.6 | Mock SUNAPI | Toggle `#use_gmt`/`#timezone`/`#universaltime_checkbox` before and after SUNAPI on | Matches, including the capability-driven disable. |
| TC-12 | FR-4.7 | Neither | Click HTTP/HTTPS switch | `#port` default and player `.https` both match. |
| TC-13 | FR-5.2/FR-5.3 (+ `docs/control-panel-data-binding.md` §4) | Mock SUNAPI | With SUNAPI on, click a profile row | Badge rendering and the documented click-vs-change-event gap both match identically (i.e. the new page reproduces the *same* gap, not a fixed version — see DESIGN.md's deviation list for the one gap that is *not* reproduced). |
| TC-14 | FR-6.1–FR-6.9 | Neither (state-machine only — see boundary list) | Dispatch synthetic `statechange` events (`PLAYING`/`STOPPED`/`PAUSED`/`STEP`) via `page.evaluate()` on the `<rtsp-over-websocket>` element, without a real stream | Every button's disabled state after each synthetic event matches between pages — this is the practical substitute for real playback verification (see boundary list). |
| TC-15 | FR-7.1/FR-7.2 | Mock SUNAPI | Click Search Overlapped Id, Search Date | Returned list rendering / date-range rewrite matches. |
| TC-16 | FR-7.3 (+ `docs/architecture.md`'s Playback controls section) | Mock SUNAPI | Toggle 1 Day/3 Month, click Search Timeline | Same date-range computation, same `getTimeline()` call matches. |
| TC-17 | FR-7.4 | Neither | Toggle `#support_end_time` | Field show/hide and player `.endTime` null-vs-set behavior matches. |
| TC-18 | FR-7.6 | Mock SUNAPI | Run a timeline search against a realistic (~150-item) result set, click/select an item | Timeline group/item rendering (both pages render the same real `.vis-item` count, not just "the container became visible") and the resulting Manual Time field sync matches. This is the test that caught two real bugs live: `src/shared-v2/`'s missing `.TimeLineSearchResults` envelope-unwrap (rendered nothing against real data) and, after that fix, a since-removed `fit()` call that broke rendering at this item count even though it looked correct against a 3-item fixture — see DESIGN.md's "Deviations from legacy behavior" (retracted entry) for both. |
| TC-19 | FR-8.1–FR-8.4 | Neither (state-machine only) | Dispatch synthetic `changemute`/`changevolume` events | Disabled-state and value sync matches. |
| TC-20 | FR-9.1 | Neither | Toggle `#backup_checkbox` with/without a filename, with/without Playback mode | Validation alert and player property writes match. |
| TC-21 | FR-10.1 | Neither | Toggle `#instantplayback_checkbox` | Player `.playType` write matches. |
| TC-22 | FR-11.1 | Neither | Click `#fullscreen` | Player `.fullscreen` flip matches (including the double-toggle-from-the-player's-own-event behavior, reproduced as-is). |
| TC-23 | FR-12.2/FR-12.3 (+ `docs/disclosure-component/TC.md`, re-run for equivalence) | Neither | Toggle Use Debug, trigger a log line, Clear | `#debug` content and the panels' collapse/expand behavior matches. |
| TC-24 | FR-13.1 | Neither | Trigger a popup, click its close button | Both modals hide identically on both pages. |
| TC-25 | § Known dead controls | Neither | Click every control in SRS's dead-controls table on both pages | No error surfaces to the user on either page (console `ReferenceError` on the *original* for the `onclick="..."` ones is expected and accepted — see DESIGN.md; the new page has no listener at all, so nothing fires, which is the equivalence bar per PRD.md's Non-Goals). |
| TC-26 | DESIGN.md's `element.device` deviation | Mock SUNAPI, device type NVR | Run the `getDateInfo()` NVR branch | New page uses `getSelectedPlayer().device`, not a stray loop variable — documented as an intentional deviation, not a failure, in this test's own assertion message. |
| TC-27 | FR-15.5 (DESIGN.md's `sunapiInitInFlight` deviation) | Mock SUNAPI | Fill credentials, click "Use SUNAPI", immediately click Search Date (no wait) | Exactly one `attributes.cgi` request on the new page; the original genuinely sends two (a native blur-triggered `change` on `#password` re-triggers `initSunapiManager()`) — asserted as a deliberate asymmetry, not equality. |

## Not verifiable in this environment (documented boundary, not a silent gap)

- **Real RTSP video frame rendering.** No real camera/stream is reachable (`CLAUDE.md`'s WSL2
  networking note); TC-14/TC-19 substitute synthetic player events to verify `window.ts`'s *own*
  state-machine logic, which is the part actually within this SDD's scope — actual video decode/
  render is the vendored player's concern, already out of scope per [PRD.md](PRD.md)'s Non-Goals.
- **Chrome-extension-only paths** (`IS_EXTENSION` branches: native TLS proxy, `chrome.storage`-backed
  auto-discovery persistence, extension-to-extension forwarding, known-devices catch-up). Structurally
  implemented in `src/shared-v2/` for spec completeness, not exercised by Playwright (nodejs target
  only) — see [PRD.md](PRD.md)'s Non-Goals.
- **Real Digest authentication** against actual camera firmware — the mock server returns `200`
  directly rather than modeling a `401` challenge/response round (that logic lives in the native
  host, itself Chrome-extension-only and separately spec'd in `docs/native-https-proxy/`).
