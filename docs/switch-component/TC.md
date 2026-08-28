# TC — Switch Component

| | |
|---|---|
| Title | Switch Component — Test Cases (TC) |
| Abstract | Manual test procedures verifying all 5 migrated switches render/behave correctly and that no pre-existing `window.ts` call site was broken. |
| Status | Implemented |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [PRD](PRD.md) · [MRD](MRD.md) · [SRS](SRS.md) · [DESIGN](DESIGN.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-28 | Youngho Kim | Split out of the original single-file `docs/switch-component.md` (this test table is new — the original doc had no TC section); added Title/Abstract/Author/Milestone/History metadata. |

These are **manual** test procedures, not automated tests — this UI has no automated test harness
(see `docs/star-topology/TC.md`/`docs/native-https-proxy/TC.md` for the same note). Run against
either `dist/chrome-extension/` (loaded unpacked) or `dist/nodejs/` (`npm run start`).

| ID | Title | Preconditions | Steps | Expected result |
|---|---|---|---|---|
| TC-1 | Dark mode switch renders and toggles the theme | Page loaded | Click the dark-mode switch in the toolbar | `data-theme` on `<html>` flips `dark`/`light`; the moon icon's text updates to "Dark Mode"/"Light Mode" (FR-1, `changedarkmode` unchanged). |
| TC-2 | HTTP/HTTPS pill renders as one joined pill and updates the port field | Page loaded | Click `HTTPS` in the Protocol pill | `#port` defaults to `443`; clicking `HTTP` defaults it to `80` (FR-2, `changehttptype` unchanged). Visually one continuous pill, not two disjoint boxes (regression check for the SUNAPI containerId bug — see DESIGN.md). |
| TC-3 | Live/Playback pill toggles the Playback controls section | Page loaded | Click `Playback` | `#playback_control` becomes visible (FR-2, `onchangeplaytype` unchanged). Click `Live` — it hides again. |
| TC-4 | Timeline range pill defaults to "1 Day" and changes what "Search Timeline" runs | Playback section visible | Click `Search Timeline` with the default selection, then switch to `3 Month` and click again | With `1 Day` selected, `search_oneday_timeline()` runs; with `3 Month` selected, `search_three_month_timeline()` runs (FR-3, `search_timeline_by_range()` reading `timelineRangeSwitch.getValue()`). |
| TC-5 | SUNAPI On/Off pill renders as one joined pill, not two disjoint boxes | Page loaded, a device's hostname/port filled in | Click the SUNAPI `On` segment | `#use_sunapi_client_checkbox` becomes checked, `initSunapiManager()` runs (FR-1). Visually one continuous pill — this is the specific regression check for the `#sunapi_info`→`#sunapi_toggle` containerId-scoping bug found in review (see DESIGN.md). |
| TC-6 | Selecting a discovered device turns SUNAPI/protocol fields the same way as before migration | A discovered device row exists | Click a Discovery result row | `#https_radio`/`#http_radio`/`#use_native_tls_proxy_checkbox` are set from the row's protocol, and SUNAPI is forced Off if it was On — same behavior `docs/control-panel-data-binding.md` §1 documents, unaffected by this migration (regression check for FR-10's "no markup generation" claim). |
| TC-7 | `npm run build` succeeds and both dist outputs contain the migrated markup | Clean checkout | `npm run build` | Succeeds for both `dist/chrome-extension/` and `dist/nodejs/`; `switch.css` present in both `css/` output dirs; `mountSwitch` present in the bundled `window.js`. |
| TC-8 | No dangling reference to the deleted `segmentedToggle.ts`/old CSS classes | After migration | `grep -rn "segmentedToggle\|segmented-toggle" src/` | Zero hits outside `src/component/switch/`'s own historical comments referencing the old name. |
| TC-9 *(not yet exercised by a live control)* | 3+-option switch and dot-mode rendering | — | No current call site uses `options.length >= 3` or `dot: true` — SRS FR-3/FR-4 are implemented and covered by `switch.ts`'s own validation (FR-8), but only verifiable today via a temporary test harness (e.g. a scratch `mountSwitch()` call added to a throwaway page), not a real Control panel control. Revisit this row once a real 3+-way or dot-mode switch is added to `window.html`. |
