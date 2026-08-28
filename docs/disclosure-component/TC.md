# TC — Disclosure Component

| | |
|---|---|
| Title | Disclosure Component — Test Cases (TC) |
| Abstract | Manual test procedures verifying all three collapsible panels default-collapse, toggle correctly, and don't let header controls also toggle the panel. |
| Status | Implemented |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [PRD](PRD.md) · [MRD](MRD.md) · [SRS](SRS.md) · [DESIGN](DESIGN.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-28 | Youngho Kim | Split out of the original single-file `docs/disclosure-component.md` (this test table is new — the original doc had no TC section); added Title/Abstract/Author/Milestone/History metadata. |

These are **manual** test procedures, not automated tests. Run against either
`dist/chrome-extension/` (loaded unpacked) or `dist/nodejs/` (`npm run start`).

| ID | Title | Preconditions | Steps | Expected result |
|---|---|---|---|---|
| TC-1 | All three panels start collapsed | Fresh page load | Scroll to the bottom of the Control page | Debug Information, Discovery, and RTSP all render collapsed (chevron `∨`), no textarea content visible (FR-3). |
| TC-2 | Clicking a panel's title toggles it | Any panel collapsed | Click the panel's title/header row | The panel expands, its textarea becomes visible, chevron flips to `∧` (FR-1). Click again — it collapses, chevron flips back to `∨`. |
| TC-3 | Debug Information's "Use" checkbox does not toggle the panel | Debug Information collapsed | Click the "Use" checkbox (or its "Use" label text) inside the header | The checkbox's checked state changes (and `onchangeusedebug()` still runs, `_useDebug` updates) — the panel itself stays collapsed, does **not** expand (FR-2/FR-5, the label-wrapped-checkbox fix in DESIGN.md). |
| TC-4 | Debug Information's "Clear" button does not toggle the panel | Debug Information collapsed, `#debug` has content | Click "Clear" | `#debug`'s textarea content clears (`oncleardebug()` still runs) — the panel itself stays collapsed, does **not** expand (FR-2/FR-5). |
| TC-5 | Keyboard activation works | A panel's header is focused (Tab to it) | Press `Enter` or `Space` | The panel toggles open/closed, same as a mouse click (SRS NFR-1 — native `<summary>` behavior). |
| TC-6 | Reloading the page always resets to collapsed | Expand one or more panels | Reload the page | All three panels are collapsed again, regardless of what they were left as (FR-4 — no persistence). |
| TC-7 | Debug logging still appends correctly while collapsed | Debug Information collapsed | Trigger any action that logs to Debug Information (e.g. select a device) | The log content is appended to `#debug` regardless of the panel's collapsed state (verify by expanding afterward) — collapsing is purely visual, not functional. |
| TC-8 | `npm run build` succeeds and both dist outputs contain the migrated markup | Clean checkout | `npm run build` | Succeeds for both `dist/chrome-extension/` and `dist/nodejs/`; `disclosure.css` present in both `css/` output dirs; `mountDisclosure` present in the bundled `window.js`. |
