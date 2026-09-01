# DESIGN — Event Timeline Component

| | |
|---|---|
| Title | Event Timeline Component — Design Document |
| Abstract | The two-scale overview/detail-row model, click-vs-drag disambiguation, why this isn't idempotent, and known limitations. |
| Status | Draft |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [PRD](PRD.md) · [MRD](MRD.md) · [SRS](SRS.md) · [TC](TC.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-31 | Youngho Kim | Initial DESIGN. |
| 2.0 | 2026-08-31 | Youngho Kim | Updated the file-changes list: `playback.ts`'s `onSelect` now wires `setSelectedTime()`/`onSelectedTimeChange` (Selected Time lives in this component, SRS.md FR-13) instead of an external Manual Start/End Time field sync; `onRangePresetSelect` is supplied per-caller (manual flow vs. Calendar flow) as `updateTimeline()`'s own parameter, keeping `playback.ts`->`playbackCalendar.ts` non-imports intact. Reported directly by the user. |
| 2.1 | 2026-08-31 | Youngho Kim | FR-14: the current-time marker becomes draggable (`onCustomTimeSeek`, seeks `#seeking_date`/`#seeking_time` + the player once on release) and is now hidden whenever playback isn't actually `PLAYING` (`videoControl.ts`'s `onstatechange()` clears it on `STOPPED`/`PAUSED`). `#seeking_date`/`#seeking_time` stay exactly where they already were (Video Control panel) — not duplicated into this component. |
| 2.2 | 2026-08-31 | Youngho Kim | Corrected the "Click vs. drag" section below and rewrote `wireOverviewDrag()` to match: the overview row's items (Normal-classed ones especially) were never actually reachable by a click — the previous text's claim that they "use the same item-click path as detail rows" did not match the shipped code, which only ever wired the highlight's own pan/resize-handle dragging. The opaque, `pointer-events: auto` highlight rectangle also sat on top of the items, hiding them at the (default) full-extent zoom where it spans the whole track. Fixed per SRS.md FR-3/FR-7 v2.3; reported directly by the user. |
| 2.3 | 2026-08-31 | Youngho Kim | FR-14's target field pair corrected: `#seeking_date`/`#seeking_time` retired, unified into `#timestamp_date`/`#timestamp_time` (shared with `'live'` mode) per the user's explicit request — see `docs/window-ui/SRS.md` v2.2. Drag-seek also now force-resets the player to forward speed, a mitigation for a reported reverse-playback symptom when dragging backward then resuming. |
| 2.4 | 2026-08-31 | Youngho Kim | Found while verifying v2.2: the draggable current-time marker (FR-14) also blocked overview-row item clicks, since its `pointer-events: auto` hit area spanned the same full height as its visual line (v2.2 above) and `playback.ts` starts it at the earliest item's own start — always that item's Normal bar in the overview row. Split into `customTimeEl` (always-visible line, unchanged, `pointer-events: none`, spans the full height) and a separate `customTimeHitEl` (the actual drag target, `.event-timeline-custom-time-hit`), appended only into the detail-rows wrapper so it can never sit over an overview item. See SRS.md FR-9/FR-14 v2.5. |
| 2.5 | 2026-08-31 | Youngho Kim | Found while re-verifying v2.2: the two edge-resize handles kept from v2.2 (`pointer-events: auto`, explicitly re-enabled) had the exact same problem as the highlight and the marker before their own fixes — at the default full-extent zoom they sit exactly on the data range's start/end pixel, occluding whichever item is there for the browser's real hit-testing (not just this component's own routing), confirmed by Playwright's actionability check correctly refusing to click an occluded element. Removed as real hit targets (`pointer-events: none`, purely visual); resize is now detected by proximity to the highlight's edge (`RESIZE_EDGE_PX`) inside the track's own single pointerdown/move/up flow instead of a separate element. See "Click vs. drag" below and SRS.md FR-3 v2.6. |
| 2.6 | 2026-09-01 | Youngho Kim | Three fixes reported directly by the user: color classes are now `evt-`-prefixed (`evt-normal`, `evt-motiondetection`, ...) so they can never collide with an unrelated bare-word global class — `src/shared/css/table.css`'s own `.normal` (reused as-is on the `src/shared-v2/` page) was leaking `height: 40px; border: 1px solid red;` into this component's Normal row; detail-row headers now reserve an invisible spacer matching the overview row's collapse-button width, so row-title labels actually line up in a column; and the overview row's collapse button now hides its entire track (items, highlight, edge-handles together), not just the item markers as v2.2-v2.5 left it — the empty-but-full-height leftover track read as broken, not as v2.3's deliberate "highlight stays available as a pan/zoom control" design. See SRS.md FR-1/FR-3/NFR-5 v2.9. |
| 2.7 | 2026-09-01 | Youngho Kim | Requested directly by the user right after v2.6: every row (overview and detail) is now a fixed `height: 20px` (`.event-timeline-row`/`.event-timeline-row-track`/`.event-timeline-overview-track`, previously auto/30px/25px respectively), and `src/shared/css/table.css`'s `.normal` rule had its `height: 40px` line deleted outright rather than just left unreachable by the v2.6 `evt-` rename. See SRS.md v2.10. |
| 2.8 | 2026-09-01 | Youngho Kim | Overlapped Id moves into this component's own toolbar (immediately left of the 1H/6H/1D/1W/1M/1Y preset buttons, `.event-timeline-toolbar-left` wrapping both) — requested directly by the user. Replaces `playback.ts`'s/`playbackCalendar.ts`'s own previously-separate `#overlapped_id_area`/`#calendar_overlapped_id_area` DOM-building with a single shared control (`setOverlappedIds()`/`getOverlappedId()`), the same single-canonical-control move v2.0 already did for Selected Time. See SRS.md FR-15 v2.11. |
| 2.9 | 2026-09-01 | Youngho Kim | Reported directly by the user: the current-time marker's overview ("ALL EVENTS") appearance used the wrong position once zoomed in, because v2.2's single `customTimeEl` spans both rows via one `left` computed only from the detail rows' `windowStart`/`windowEnd` basis, while the overview row's own items are always laid out on the full `dataStart`/`dataEnd` extent. Split into two elements: `customTimeEl` (unchanged id/behavior, now appended into `.event-timeline-rows` instead of the overview-spanning `.event-timeline-rows-wrapper`) and a new `customTimeOverviewEl`, appended into the overview row's own `.event-timeline-overview-track` and positioned on that track's own `dataStart`/`dataEnd` basis (same as `renderOverviewHighlight()`). `customTimeHitEl` (FR-14's drag target) is unaffected — already detail-rows-only since v2.4. See SRS.md FR-9 v2.13. |
| 2.10 | 2026-09-01 | Youngho Kim | `handleItemOrTrackActivation()`'s double-click ratio math (FR-8) computed the click's `time` from `rowsContainer.getBoundingClientRect()` without subtracting `ROW_HEADER_WIDTH_PX` first — every other pixel/ratio conversion in this file does (`renderCustomTime`, `wireCustomTimeDrag`), since `rowsContainer` spans each row's label column *and* its track, not just the track. Left uncorrected, this shifted every computed `time` later by roughly (header-width ÷ total-width) of the current zoom window's span. Reported directly by the user with a console trace: double-clicking well inside a 4-minute item seeked ~3 minutes past that item's own end. Fixed alongside a second change: `onDoubleClick` now also receives the double-clicked `EventTimelineItem` (when one was hit) as a second argument, so a caller can use that item's own exact `start`/`end` instead of relying on pixel math at all — `playback.ts` does exactly this (see `docs/window-ui/DESIGN.md`'s corresponding entry). See SRS.md FR-8 v2.14. |
| 2.11 | 2026-09-01 | Youngho Kim | Two changes requested directly by the user: the per-row "Hide"/"Show" button (every row, overview and detail) is removed outright (`hiddenRowIds`/`setRowHidden()`/`.event-timeline-hide-btn`/`.event-timeline-row-hidden` all deleted); and the overview row's own `.event-timeline-collapse-btn` click handler is retargeted from folding that row's own track (v2.6's `.event-timeline-overview-collapsed`) to instead toggling `.event-timeline-rows-collapsed` on `rowsContainer`, hiding/showing every detail row at once while "ALL EVENTS" itself stays visible either way. See SRS.md FR-3/FR-10 v2.15. |

## Why a full custom widget, not a `vis.Timeline` reskin

See [MRD.md](MRD.md) for the full reasoning — in short, `vis.Timeline` has no overview/minimap
concept at all (confirmed by grepping the vendored build for `minimap`/`overview`: zero matches),
so the requested "ALL EVENTS" viewport-highlight strip can't be reached by restyling it. This
component replaces `vis.Timeline` for `src/shared-v2/`'s Playback timeline only — `src/shared/`'s
own untouched original still uses it, and so does `src/shared-v2/`'s unrelated Star Topology view
(`vis.Network`, a different part of the same vendored `vis` package).

## Two scales, one shared zoom-window state

The core design decision is that the overview row and the detail rows are drawn on **two different,
simultaneously-visible scales** against the same underlying `windowStart`/`windowEnd` state:

- The overview row's items are always scaled to the **full data extent**
  (`dataStart`/`dataEnd`, fixed for the component's lifetime) — it never zooms, so it always shows
  the whole fetched range at a glance.
- Every detail row's items are scaled to the **current zoom window** (`windowStart`/`windowEnd`) —
  these zoom and pan together as the window changes.
- The overview row additionally draws a highlight rectangle positioned by mapping
  `windowStart`/`windowEnd` onto its own full-extent scale — this rectangle *is* the zoom window,
  visualized, and is also the only pan/zoom control needed for it (drag the body to pan, drag either
  edge to resize/zoom) — no separate minimap-plus-scrollbar pair, no second widget instance.

This means the SRS's zoom/pan requirements (FR-5/FR-6) and the overview requirement (FR-3) are one
mechanism, not two: `setWindow(start, end)` is the single function every zoom/pan interaction (wheel,
buttons, presets, detail-row drag, overview-row drag, overview edge-handle drag) funnels through,
and every render (`render()`) re-draws both scales from that one pair of numbers plus the fixed
`dataStart`/`dataEnd`. `setWindow()` itself owns all the clamping (never wider than the full extent,
never narrower than `MIN_WINDOW_MS`, never outside `[dataStart, dataEnd]`), so every caller of it can
pass an out-of-range value without its own clamping logic.

## Click vs. drag, without relying on native `click`

Distinguishing "select this item" from "start panning the row it's in" can't use the browser's
native `click` event alone — a real pan gesture starts with a `pointerdown` on (or over) an item just
as often as a plain click does. Instead, `pointerdown`/`pointermove`/`pointerup` are handled directly:
`pointerdown` only records the starting position; `pointermove` only starts actually panning once
the cumulative movement exceeds a small threshold (`DRAG_THRESHOLD_PX`, 4px); `pointerup` checks
whether that threshold was ever crossed — if not, it's treated as a click and dispatched to
`onSelect`/`onDoubleClick` based on what was under the *original* `pointerdown` target. This sidesteps
needing to `preventDefault()` a real `click` (which would also suppress `dblclick` detection) while
still getting deterministic click-vs-drag behavior regardless of how far the pointer briefly wobbled
during a fast click.

The overview row's own pan/resize dragging is implemented separately (`wireOverviewDrag()`), but
**as of v2.2/v2.6** it reuses the exact same drag-vs-click disambiguation described above, wired
directly onto the overview track (not the highlight rectangle or its edge-handles): a real drag
pans or resizes the window past `DRAG_THRESHOLD_PX`, and a plain click/release without one is
handed to `handleItemOrTrackActivation()`, the same function detail rows use. This only works
because the highlight rectangle AND its two edge-handles are all `pointer-events: none`
(event-timeline.css) — purely visual, never intercepting the pointer — leaving `event.target` at
`pointerdown` time resolved to whatever's actually underneath (an item, or the bare track).

**v2.6 correction**: an earlier version of this fix (v2.3) kept the two edge-handles as separate
`pointer-events: auto` elements, explicitly re-enabling hit-testing on them (overriding the
inherited `none` from their highlight parent) so they stayed directly draggable, with
`stopPropagation()` on their own `pointerdown` so a resize never also fired a click on whatever
item sat beneath the handle. This missed that at the *default* full-extent zoom the highlight spans
the entire track, so both handles sit exactly on the data range's own start/end pixel — directly on
top of whichever item starts/ends the data range (commonly the earliest Normal item), occluding it
for the *browser's own hit-testing*, not just this component's click routing. No amount of
forwarding logic inside the occluding element's own handlers fixes that (confirmed by Playwright's
actionability check, which correctly refuses to force a click through an occluding element — the
same thing a real mouse click resolves to the topmost element regardless of what that element's own
JS does with it). The handles are now purely visual; a resize is instead detected by *proximity* to
the highlight's current edge (`RESIZE_EDGE_PX`, 6px), computed from `windowStart`/`windowEnd`
directly inside the track's own pointerdown handler — no separate element ever sits on the pixel a
real item occupies.

## Not idempotent, unlike `calendar`/`switch`/`disclosure` — an explicit `destroy()` instead

Every other `src/component/*` widget either skips re-mounting entirely on a second call (`switch`/
`disclosure`'s `data-*-mounted` flag) or returns the *same* controller from a module-level cache
(`calendar`'s `WeakMap`). Neither fits here: `playback.ts` already clears and rebuilds `#timeline`'s
entire contents on every new Search Timeline run (`updateTimeline()` is called once per search, with
a genuinely different `rows`/`items` data set each time — not a re-render of the same underlying
data the way `calendar`'s month navigation is). A cached "same instance, new data" API would need its
own `setData()`-style method for no real benefit, since the caller already treats each search as a
fresh timeline. Instead, `mountEventTimeline()` always builds a new instance, and exposes `destroy()`
(disconnects the `ResizeObserver`, clears the container) for the caller to invoke on the *previous*
instance before mounting a new one — `updateTimeline()` does exactly this via `state.eventTimeline`.

## Rule# rows and coloring are unchanged from the prior `vis.Timeline`-based design

The `rows`/`items` this component receives are still built exactly as the previous `stack: false` +
per-Rule# revision computed them (`docs/window-ui/SRS.md` FR-7.6 v1.15, `MEMORY.md`) — one `"All"`
row containing every item, plus a second copy of each non-Normal item under its own Rule#-named row,
colors assigned deterministically from the Rule# embedded in the type string. None of that logic
lives in this component; `playback.ts` still owns it and just reshapes its existing output into this
component's `EventTimelineRow[]`/`EventTimelineItem[]` shape.

## Known limitations (not pursued, see PRD.md's Non-Goals for the deliberate ones)

- No touch/pointer-gesture support beyond what the Pointer Events API gives for free (a mouse or a
  single-touch drag both work via `pointerdown`/`pointermove`/`pointerup`; multi-touch pinch-to-zoom
  is not implemented).
- No keyboard navigation *within* the timeline track itself (arrow-key pan, +/- zoom) — the toolbar's
  preset/zoom/reset/collapse buttons are real `<button>` elements and so are already keyboard-
  operable, but there is no keyboard equivalent for wheel-zoom or drag-pan on the track/overview row.
- Not validated at item volumes materially larger than the ~150-item realistic benchmark `MEMORY.md`
  already established for this feature — items are fully rebuilt (not diffed/virtualized) on every
  render, which is where a much larger data set would first show a performance cost.

## Components (Files)

- `src/component/event-timeline/event-timeline.ts` — `mountEventTimeline()`, types,
  `EventTimelineController`.
- `src/component/event-timeline/event-timeline.css` — layout, the `--evt-<class>-*` color tokens
  (copied from `src/shared/css/timeline.css`, not moved — that file stays untouched for the old
  page), toolbar/row/item/axis styling.
- `src/shared-v2/window.html` — `<link rel="stylesheet" href="css/event-timeline.css">` in place of
  the previous `css/timeline.css` link; `<div id="timeline">` itself is unchanged (still the mount
  container, still toggled via `.style.display` by `playback.ts`).
- `src/shared-v2/modules/playback.ts` — `updateTimeline()`'s one `mountEventTimeline()` call, with
  `onSelect`/`onDoubleClick` wired to player-seek logic and (as of v2.0) `setSelectedTime()`/
  `onSelectedTimeChange` wired to the player's `startTime`/`endTime` (`docs/window-ui/SRS.md`
  FR-7.6/FR-11) — Manual Start/End Time no longer lives outside this component at all.
  `onRangePresetSelect` (v2.0) is supplied differently per caller: `playback.ts`'s own manual-flow
  re-fetch, or `playbackCalendar.ts`'s Calendar-flow equivalent, passed in as `updateTimeline()`'s
  second parameter (kept one-directional — `playback.ts` never imports from `playbackCalendar.ts`).
  As of v2.8 (FR-15), `updateTimeline()` also takes `overlappedIds`/`selectedOverlappedId` parameters,
  threaded straight into the same `mountEventTimeline()` call's own options of the same name —
  `runManualTimelineSearch()` fetches the list itself (unchanged network sequence: Overlapped Id
  before Timeline, since it's a query param of the latter) and no longer builds any DOM for it
  directly.
  `ontimestamp()`'s `'playback'` case calls `state.eventTimeline.setCustomTime()` in place of the
  previous `visTimeline.setCustomTime()` — as of v2.1 (FR-14) gated on
  `readyState === PLAYING`, passing `null` otherwise. `onCustomTimeSeek` (v2.1) mirrors the existing
  `onDoubleClick` handler's GMT-aware branching/`readyState === PLAYING` guard, and additionally
  writes the new time straight into `#timestamp_date`/`#timestamp_time` (Video Control panel, shared
  with `'live'` mode's own readout as of v2.2 — see `updateTimestampReadout()`, not the now-retired
  `#seeking_date`/`#seeking_time`) instead of waiting for the player's own next `timestamp` event to
  report it. **v2.2**: also force-resets the player to forward speed (`playSpeed = '1'`) on every
  drag-seek, a mitigation for a reported reverse-playback symptom.
- `src/shared-v2/modules/playbackCalendar.ts` — `runOverlappedAndTimelineSearch()`'s Overlapped Id
  fetch now stores the raw list in a module-level `currentOverlappedIds` instead of building DOM;
  `runCalendarTimelineSearch()` (also the Rule-change/`#event_rules_type` handler, which does NOT
  re-fetch Overlapped Id) picks the query's `overlappedId` by preferring
  `state.eventTimeline?.getOverlappedId()` when it's still a member of `currentOverlappedIds` (a Rule
  change re-search: same list, so a user's manual pick is still valid) and falling back to
  `currentOverlappedIds`'s own default otherwise (a fresh day/preset search just replaced the list
  with a different day's) — this is `selectedOverlappedId`'s reason for existing at all: without
  passing it back into `updateTimeline()`, the widget's full remount (FR-12, every call) would
  silently reset a Rule-change re-search's select back to the new list's default instead of keeping
  whatever the query itself actually used.
- `src/shared-v2/modules/videoControl.ts` — `onstatechange()`'s `STOPPED`/`PAUSED` branches call
  `state.eventTimeline?.setCustomTime(null)` (v2.1, FR-14): once playback isn't `PLAYING`,
  `ontimestamp()` stops firing entirely, so nothing else would ever clear a marker left over from
  before the stop/pause.
- `src/shared-v2/modules/state.ts` — `eventTimeline: EventTimelineController | null` in place of the
  previous `visTimeline: any`.
- `scripts/build.js` — `buildSharedV2()` copies `event-timeline.css` into
  `dist/shared-v2-preview/css/` (same pattern `calendar.css`/`switch.css`/`disclosure.css` already
  use there) and into the shipped `dist/chrome-extension/`/`dist/nodejs/examples/public/` overwrite
  step alongside `calendar.css`. **Not** copied by `copySharedWebAssets()` (the real product's own
  asset copy) — `src/shared/` never references this component, matching `PRD.md`'s Non-Goals.
