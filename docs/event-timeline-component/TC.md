# TC — Event Timeline Component

| | |
|---|---|
| Title | Event Timeline Component — Test Cases (TC) |
| Abstract | Playwright test cases for `mountEventTimeline()`, exercised via `src/shared-v2/`'s FR-7.6 integration — new-page-only, no `src/shared/` equivalent exists to compare against (it still uses `vis.Timeline`). |
| Status | Draft |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [PRD](PRD.md) · [MRD](MRD.md) · [SRS](SRS.md) · [DESIGN](DESIGN.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-31 | Youngho Kim | Initial TC. |
| 1.1 | 2026-08-31 | Youngho Kim | TC-7 corrected: Normal-classed item selection now sets/enables End Time like every other item (v1.18 deviation, requested by the user), no longer disables it. |
| 1.2 | 2026-08-31 | Youngho Kim | Added TC-11/TC-12 for FR-14 (draggable current-time marker + PLAYING-gated visibility). |
| 1.3 | 2026-08-31 | Youngho Kim | Added TC-13: the marker must span the overview row too (v2.2 fix), not just the detail rows. |
| 1.4 | 2026-08-31 | Youngho Kim | TC-7's click on `.event-timeline-overview-row .event-timeline-item.normal` was previously unreachable in practice — the overview row had no click-to-select wiring at all, and the (opaque, click-intercepting) viewport-highlight rectangle covered every item at the default full-extent zoom besides. Both fixed per SRS.md FR-3/FR-7 v2.3/DESIGN.md v2.2; TC-7 itself is unchanged (it already specified the correct expected behavior). |
| 1.5 | 2026-08-31 | Youngho Kim | TC-11 retargeted from `.event-timeline-custom-time-draggable`/`#seeking_date`/`#seeking_time` (retired) to the current `#event_timeline_custom_time_hit`/`#timestamp_date`/`#timestamp_time`, plus the new `#speed` reset. |
| 1.6 | 2026-08-31 | Youngho Kim | TC-7 needed two further fixes before it actually passed (both surfaced by running it, not by inspection): the current-time marker's own drag hit-area (`#event_timeline_custom_time_hit`) and, separately, the overview's two edge-resize handles each in turn occluded the same earliest-item pixel the v1.4 fix had just made reachable. See DESIGN.md v2.4/v2.5 and SRS.md FR-9 v2.5/FR-3 v2.6 for the fixes (customTimeHitEl confined to the detail rows; the handles replaced with edge-proximity detection, no longer real elements). TC-7 itself remains unchanged throughout. |

## Method

`tests/window-ui-equivalence/event-timeline.spec.ts`, driven against `dist/shared-v2-preview/` (the
`newPage` side of the existing Playwright harness) and `tools/mock-sunapi-server/`'s ~150-item
Timeline fixture, same setup `docs/window-ui/TC.md`'s TC-15..18 already use to reach a populated
`#timeline`. New-page-only — `src/shared/`'s own timeline is unaffected by this component and has
nothing to compare against. Wheel-zoom and drag-pan/drag-resize are exercised via Playwright's
`mouse.wheel()`/`mouse.down()`+`mouse.move()`+`mouse.up()`, not asserted pixel-for-pixel (this suite
checks the resulting *state* — window width, active preset, selected item — not exact coordinates).

| ID | SRS FR | Steps | Expected result |
|---|---|---|---|
| TC-1 | FR-1/FR-3/FR-4 | Run a Search Timeline against the mock fixture (mixed Normal/`MotionDetection` results) | `.event-timeline-overview-row` renders first, followed by one `.event-timeline-detail-row` per distinct non-Normal type present in the results; the overview row's own item count equals the total result count. |
| TC-2 | FR-4 | Inspect a wide (long-duration) bar item vs. a narrow one | The wide item has a visible `.event-timeline-item-label` child with `"<Type> <duration>"` text; the narrow item has none, but both have a `title` attribute containing the same text. |
| TC-3 | FR-5 (presets, v2.0) | Click a preset button (e.g. 6H) against this real app integration (which always supplies `onRangePresetSelect`) | A fresh `recording.cgi?msubmenu=timeline` request fires (`[now-preset, now]`); the widget is destroyed and remounted with the response (still exactly one `.event-timeline` root, per FR-12) rather than just toggling a local `.event-timeline-preset-btn-active` class on already-loaded data. The pre-v2.0 local-zoom-only behavior (no `onRangePresetSelect` provided) is a component-level fallback, not exercised by this app integration test. |
| TC-4 | FR-5 (wheel zoom) | `mouse.wheel()` with a negative `deltaY` over `.event-timeline-rows` | The zoom readout's factor increases (window narrows); no preset button remains marked active (the resulting window doesn't exactly match a fixed preset width). |
| TC-5 | FR-6 (pan) | Zoom in first (TC-4), then `mouse.down()`+`mouse.move()`+`mouse.up()` a drag across `.event-timeline-rows` | The zoom readout's factor is unchanged (pan doesn't change window width); the axis's tick labels (`.event-timeline-axis-tick`) change (window shifted). |
| TC-6 | FR-7 (select) / FR-13 (Selected Time, v2.0) | Click a bar item (any non-Normal one) | `onSelect` fires; `playback.ts`'s own handler resolves the item's GMT-adjusted start/end and calls `setSelectedTime()` — this component's own `#selected_start_date`/`#selected_start_time`/`#selected_end_date`/`#selected_end_time` all reflect that item, `#selected_has_end_time` is checked, and the End inputs are enabled. The clicked item gains `.event-timeline-item-selected`. |
| TC-7 | FR-7 (Normal select) / FR-13 | Click a Normal-classed item in the overview row | Same Selected Time sync as TC-6 — End Time is also set from the item's `end` and stays enabled/checked, the player's `endTime` is set (not nulled). **Since FR-7.6 v1.18** this matches every other item type; the old Normal-only "start-time-only, End Time disabled" behavior is a retired legacy quirk with no documented rationale, not reproduced here — see `docs/window-ui/DESIGN.md`'s "Deviations from legacy behavior". |
| TC-8 | FR-10 (Hide) | Click a detail row's "Hide" button | That row gains `.event-timeline-row-hidden` (not rendered); the button's text changes to "Show"; clicking again reverses both. |
| TC-9 | FR-12 (re-mount, not idempotent) | Search twice in a row (a preset click, twice) | The second `updateTimeline()` call's widget fully replaces the first's DOM (no duplicate `.event-timeline` root, no doubled item count) — verifies `playback.ts`'s own `state.eventTimeline.destroy()`-before-remount call, not a claim this component is itself idempotent (see DESIGN.md — it deliberately isn't). |
| TC-10 | FR-13 (Selected Time manual edit, v2.0) | After TC-6 selects an item, uncheck `#selected_has_end_time`, then re-check it | Unchecking disables `#selected_end_date`/`#selected_end_time` and raises `onSelectedTimeChange` with `endDate`/`endTime` both `null` — `playback.ts`'s handler sets the player's `endTime` to `null` (open-ended). Re-checking restores the End inputs (last-known values) and sets a non-null `endTime` again. |
| TC-11 | FR-14 (draggable marker, seeks on release) | While playback is PLAYING, drag `#event_timeline_custom_time_hit` to a new position and release | The marker (`#event_timeline_custom_time`) follows the pointer during the drag (no seek yet); on release, `onCustomTimeSeek` fires exactly once with the dropped position's time, `#timestamp_date`/`#timestamp_time` (Video Control panel, shared with `'live'` mode) update to that time, `#speed` resets to `1`, and the player's `seekingTime` is set. |
| TC-12 | FR-14 (PLAYING-gated visibility) | Start playback (marker visible, moving), then Pause, then Stop | The marker disappears on Pause and stays hidden through Stop — verifies `videoControl.ts`'s `onstatechange()` clears it (`setCustomTime(null)`) rather than leaving it frozen at the last position once `ontimestamp()` stops firing new frames. |
| TC-13 | FR-9/FR-14 (marker spans the overview row, v2.2) | With the marker visible, inspect its element's vertical extent relative to `.event-timeline-overview-row` | The marker's bounding box covers the full height from the top of the "ALL EVENTS" overview row down through the last detail row — not just the detail rows below it. Reported directly by the user (`.event-timeline-rows-wrapper` fix). |

## Not covered here

Touch/multi-touch gestures, keyboard-driven pan/zoom on the track itself, and behavior at item
volumes significantly beyond the ~150-item mock fixture are out of scope for this suite — see
DESIGN.md's "Known limitations".
