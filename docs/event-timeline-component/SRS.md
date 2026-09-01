# SRS — Event Timeline Component

| | |
|---|---|
| Title | Event Timeline Component — Software Requirements Specification (SRS) |
| Abstract | Functional and non-functional requirements for `mountEventTimeline()`. |
| Status | Draft |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [PRD](PRD.md) · [MRD](MRD.md) · [DESIGN](DESIGN.md) · [TC](TC.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-31 | Youngho Kim | Initial SRS. |
| 2.0 | 2026-08-31 | Youngho Kim | Added Selected Time (FR-13) and `onRangePresetSelect` (FR-5 rewrite) — this component now owns the single "what will play" state shared by both of `playback.ts`'s Playback UIs, and its preset buttons can trigger a caller-owned re-fetch instead of only a local re-zoom. Reported directly by the user; see `docs/window-ui/SRS.md` FR-7.1-7.4/FR-7.8 v2.0 and `PRD.md`'s retracted non-goal. |
| 2.1 | 2026-08-31 | Youngho Kim | FR-9's playhead marker (renamed "current-time marker" here) becomes draggable (FR-14): dragging it seeks `rtsp-over-websocket` once on release, via the caller's new `onCustomTimeSeek`. `#seeking_date`/`#seeking_time` (Video Control panel) are unaffected and NOT duplicated inside this component — an earlier draft of this change had moved that display into the widget; the user explicitly rejected this ("기존에 Video Control 에 있어야 하는 것을 네맘대로 timeline 으로 넣어 버렸네") and it was reverted before landing. The marker is now also gated on actual PLAYING state — `playback.ts`/`videoControl.ts` clear it (`setCustomTime(null)`) whenever playback is paused/stopped, rather than leaving it frozen at the last position. |
| 2.2 | 2026-08-31 | Youngho Kim | FR-9/FR-14: the marker now spans the overview ("ALL EVENTS") row too, not just the detail rows — it was being appended into `.event-timeline-rows` alone, a sibling of the overview row rather than an ancestor of it, so it never actually overlaid "ALL EVENTS" even though it visually abutted it. Fixed via a new wrapper (`.event-timeline-rows-wrapper`) containing both the overview row and `.event-timeline-rows`, which the marker is now positioned/appended relative to. Reported directly by the user. |
| 2.3 | 2026-08-31 | Youngho Kim | FR-3/FR-7: the overview row's items (Normal-classed ones especially, since Normal only ever appears there, never in its own detail row) were never actually reachable by a click, despite FR-7 already specifying "either the overview row or a detail row" — `wireOverviewDrag()` only ever wired the highlight rectangle's own pan/resize-handle dragging, with no click-vs-drag path into `handleItemOrTrackActivation()` at all. Compounding this, the highlight rectangle used a solid, opaque fill and sat on top of the items in z-order with `pointer-events: auto` covering its full body, so at the initial full-extent zoom (`windowStart`/`windowEnd` = `dataStart`/`dataEnd`, i.e. the highlight spans 100% of the track) it also visually hid every overview item underneath it. Fixed by making the highlight a purely visual, `pointer-events: none` overlay with a translucent (not solid) fill, and wiring the same drag-vs-click disambiguation used elsewhere (FR-6's threshold-based approach) directly onto the overview track itself — see v2.6 below for why the two edge-handles could not stay separate `pointer-events: auto` elements. Reported directly by the user. |
| 2.4 | 2026-08-31 | Youngho Kim | Formalized FR-14 (draggable current-time marker) as its own requirement, retargeted at `#timestamp_date`/`#timestamp_time` (the shared readout `playback.ts`'s `updateTimestampReadout()` now uses for both 'live' and 'playback' modes) instead of the now-retired `#seeking_date`/`#seeking_time` — see `docs/window-ui/SRS.md`'s corresponding entry. Both marker elements (`#event_timeline_custom_time`/`#event_timeline_custom_time_hit`) gained explicit ids, requested directly by the user. |
| 2.5 | 2026-08-31 | Youngho Kim | FR-9/FR-14: found while verifying v2.3 above — the draggable current-time marker's `pointer-events: auto` hit area spans the same full height as its visual line (v2.2, overview row included), and `playback.ts` initializes it to the *earliest* item's own start on every search, which in practice is always that item's own Normal bar in the overview row — so the marker sat directly on top of, and intercepted clicks meant for, precisely the item a v2.3 fix was supposed to make selectable. Split into two elements: the always-visible 2px line still spans the full height (`pointer-events: none`, unchanged), but the wider drag hit-target now lives only in `.event-timeline-rows` (detail rows), never `.event-timeline-rows-wrapper`, so it can no longer sit over an overview-row item. Found live via Playwright, not reported separately by the user (surfaced by the same TC-7 regression run as v2.3). |
| 2.6 | 2026-08-31 | Youngho Kim | FR-3: found while re-verifying v2.3/v2.5 above — the two edge-resize handles were still separate `pointer-events: auto` elements, so at the same default full-extent zoom they sit exactly on the data range's own start/end pixel, still occluding whichever item starts/ends there (typically the earliest Normal item) for real mouse hit-testing, not just this component's own click routing. No amount of forwarding logic inside the handle's own event handlers fixes this, since a real browser (and Playwright's actionability check, which correctly refuses to click an occluded element) resolves the click to the handle first regardless. Fixed by removing the handles as real hit targets entirely (`pointer-events: none`, purely visual now) and detecting a resize by proximity (`RESIZE_EDGE_PX` = 6px) to the highlight's current edge instead, computed from `windowStart`/`windowEnd` directly inside the track's own single pointerdown/move/up flow — the same flow that already does the pan/click-select disambiguation. Found live via Playwright. |

## Interface

```ts
export interface EventTimelineRow {
  id: string;
  label: string;
  colorClass?: string;   // detail rows only -- one of the --evt-<class>-* keys
  overview?: boolean;    // exactly one row should set this: the "ALL EVENTS" strip
}

export interface EventTimelineItem {
  id: string;
  rowId: string;
  start: Date;
  end?: Date;            // absent/<=start -> rendered as a point marker, not a bar
  label: string;
  className: string;     // one of the --evt-<class>-* keys, or 'normal'
  raw?: unknown;         // passthrough, never read by this component
}

export interface MountEventTimelineOptions {
  containerId: string;
  rows: EventTimelineRow[];
  items: EventTimelineItem[];
  formatTick?: (date: Date) => string;
  formatDuration?: (ms: number) => string;
  onSelect?: (item: EventTimelineItem) => void;
  onDoubleClick?: (time: Date) => void;
  // v2.0 (FR-13): user-driven Selected Time edits -- never fired by
  // setSelectedTime() itself. endDate/endTime both null = open-ended.
  onSelectedTimeChange?: (startDate: string, startTime: string, endDate: string | null, endTime: string | null) => void;
  // v2.0 (FR-5): a preset button click, handing the caller [now-preset, now]
  // to re-fetch and re-mount with, instead of a local re-zoom.
  onRangePresetSelect?: (fromDate: Date, toDate: Date, label: string) => void;
}

export interface EventTimelineController {
  setCustomTime(date: Date): void;
  // v2.0 (FR-13): programmatic Selected Time update -- does not raise
  // onSelectedTimeChange.
  setSelectedTime(startDate: string, startTime: string, endDate: string | null, endTime: string | null): void;
  destroy(): void;
}

export function mountEventTimeline(config: MountEventTimelineOptions): EventTimelineController;
```

## Functional requirements

- **FR-1 (rows/layout)**: the row with `overview: true` renders first, as a collapsible "ALL
  EVENTS" strip; every other row renders below it, in `rows` array order, as its own detail row.
  Both kinds share a two-column layout (a fixed-width label/Hide-button header, then a track).
- **FR-2 (data extent)**: the full data extent (`dataStart`/`dataEnd`) is computed once at mount
  from the min `start` and max (`end ?? start`) across all `items`, and never changes for the
  lifetime of one mounted instance.
- **FR-3 (overview row)**: items are drawn on the overview row scaled to the *full data extent*
  (never zooms), one absolutely-positioned element per item — a bar for a real `start`/`end` span,
  a small rotated-square "diamond" marker for a point item (no `end`, or `end` <= `start`). A
  draggable, edge-resizable highlight rectangle over this row shows the current zoom window,
  positioned on the same full-extent scale; dragging its body pans the zoom window, dragging either
  edge resizes it (zooms). **As of v2.3/v2.6**, the highlight rectangle and its two edge-handles are
  all `pointer-events: none` and the fill translucent — none of them are ever a real click target or
  fully hide the items underneath; panning, resizing, and clicking an item are all detected directly
  on the track itself (resize by proximity to the highlight's current edge, `RESIZE_EDGE_PX`, rather
  than a separate hit-testable handle element — v2.6). A header button collapses/expands the row's
  item markers (the highlight rectangle itself stays visible either way, since it's the pan/zoom
  control, not just a display).
- **FR-4 (detail rows)**: each non-overview row draws only the items whose `rowId` matches it,
  scaled to the *current zoom window* (so these rows visually zoom/pan together), styled per that
  row's `colorClass`. A bar wide enough (see NFR-2) shows an inline `"<label> <duration>"` text
  label; every item (labeled or not) carries a `title` attribute with the full label/duration/time
  range, for hover.
- **FR-5 (zoom)**: mouse wheel over the detail-rows/axis area zooms in/out centered on the cursor's
  time; the zoom in/out toolbar buttons zoom centered on the window's midpoint; a Reset button
  restores the window to the full data extent. All zooming is clamped so the window never exceeds
  the full data extent or shrinks below a minimum (5 seconds). Six preset buttons (1H/6H/1D/1W/1M/
  1Y): **as of v2.0**, if `onRangePresetSelect` is provided, a click computes `[now - preset, now]`
  (real wall-clock "now", not the data extent's own end) and hands those two `Date`s plus the
  preset's own label to that callback **instead of** re-zooming locally — the caller is expected to
  re-fetch for that range and re-mount with fresh data (the existing "always a fresh instance,
  caller destroys the old one first" pattern, FR-12). If `onRangePresetSelect` is omitted, a click
  falls back to the pre-v2.0 behavior: set the window to that fixed width ending at the data
  extent's own end, clamped like any other zoom.
- **FR-6 (pan)**: dragging anywhere in the detail-rows/axis area pans the current window (clamped to
  the data extent — panning cannot move the window's start before `dataStart` or its end after
  `dataEnd`).
- **FR-7 (selection)**: a plain click (no drag beyond a small movement threshold) on an item, in
  either the overview row or a detail row, invokes `onSelect(item)` with that exact `item` object
  and visually marks it selected (a dedicated CSS class); selecting one item deselects any
  previously-selected one.
- **FR-8 (double-click seek)**: a double-click anywhere in the detail-rows/axis area invokes
  `onDoubleClick(time)`, where `time` is the `Date` corresponding to the clicked pixel's position in
  the *current zoom window* — matching the previous `vis.Timeline`-based design's
  `doubleClick`/`properties.time` semantics, not necessarily an item's own `start`.
- **FR-9 (playhead)**: `setCustomTime(date)` positions a vertical marker line at `date`'s position
  in the current zoom window; the marker is hidden (not clamped/redrawn at an edge) whenever `date`
  falls outside the window. `setCustomTime(null)` (v2.1) hides it outright. As of v2.2, the marker
  spans the overview row ("ALL EVENTS") as well as the detail rows, not the detail rows alone.
- **FR-10 (per-row Hide)**: every row (overview and detail) has its own "Hide"/"Show" toggle button
  that hides/shows that entire row, self-contained within the component (not exposed on
  `EventTimelineController` — nothing outside the component needs to drive this programmatically,
  matching how the previous `vis.Timeline`-based design's own Hide button was self-contained inside
  its `groupTemplate()` closure).
- **FR-11 (resize-responsive)**: item/highlight/axis positions re-render whenever the mounted
  container's size changes (a `ResizeObserver`), not only on data/zoom/pan changes — the widget sits
  inside a resizable panel (`#right_panel`'s own `resize: horizontal`).
- **FR-12 (not idempotent by design)**: unlike `mountSwitch()`/`mountDisclosure()`/`mountCalendar()`,
  a second `mountEventTimeline()` call for the same container does **not** return/reuse a previous
  instance — it always builds a fresh one. The caller is responsible for calling a previous
  instance's `destroy()` first (see DESIGN.md for why).
- **FR-13 (Selected Time, v2.0)**: the component renders its own "Selected Time" inputs in the
  toolbar area — Start date+time (`#selected_start_date`/`#selected_start_time`, always enabled) and
  End date+time (`#selected_end_date`/`#selected_end_time`) gated behind a "Has End Time" checkbox
  (`#selected_has_end_time`; unchecked disables and blanks the End inputs — open-ended). On mount,
  defaults to "now" with no end time. The component does **not** auto-populate Selected Time on its
  own `onSelect` (FR-7) firing — the caller's own `onSelect` handler is expected to resolve the
  clicked item's `start`/`end` against whatever device-specific time semantics apply (this component
  has no SUNAPI/GMT awareness — NFR-1) and then call `setSelectedTime()` itself with the result. A
  user directly editing any of the five Selected Time controls raises
  `onSelectedTimeChange` with the four current string values; `setSelectedTime()` itself never raises
  it (plain `.value =` assignment doesn't fire a native `change` event). These ids are unique per
  page (only one `#timeline` instance ever exists at a time).
- **FR-14 (draggable current-time marker, v2.1)**: when `onCustomTimeSeek` is provided, the marker
  becomes draggable — a separate, wider drag-hit element (`#event_timeline_custom_time_hit`,
  `.event-timeline-custom-time-hit`) is layered over the always-visible 2px line
  (`#event_timeline_custom_time`, `.event-timeline-custom-time`, FR-9), confined to the detail-rows'
  vertical extent only (not the overview row's, to avoid intercepting overview item clicks — see
  DESIGN.md). Dragging moves both elements together purely visually; on release,
  `onCustomTimeSeek(date)` fires once with the dropped position's time (never fired continuously
  during the drag). The caller (`playback.ts`) is responsible for the actual seek and for updating
  its own current-time display (`#timestamp_date`/`#timestamp_time`, shared with 'live' mode's
  readout, in the Video Control panel — **not** `#seeking_date`/`#seeking_time`, an earlier, now-
  retired separate field pair unified into the same readout per the user's explicit request) — this
  component has no SUNAPI/GMT awareness (NFR-1) and does not duplicate that display itself.

## Non-functional requirements

- **NFR-1 (no SUNAPI/network awareness)**: this component makes no network calls and imports
  nothing SUNAPI-related — `playback.ts` owns every `getTimeline()` call and feeds this component
  only plain `rows`/`items` data. **Still true as of v2.0**: `onRangePresetSelect` hands the caller
  plain `Date` math (`now`/`now - preset`), and Selected Time (FR-13) is plain
  `YYYY-MM-DD`/`HH:mm:ss` strings — neither involves this component making a request or
  interpreting GMT/camera-timezone semantics itself.
- **NFR-2 (no new dependency)**: vanilla DOM/TS only, no charting/timeline library — matching
  `calendar`/`switch`/`disclosure`. The inline item-duration label is shown only when the item's
  rendered pixel width is at least 46px; narrower items still carry the same text in a `title`
  attribute.
- **NFR-3 (not virtualized)**: item elements are rebuilt on every render (zoom/pan/resize) rather
  than incrementally diffed or virtualized — acceptable at the ~150-item realistic volume
  `MEMORY.md`'s prior investigation already established as this feature's benchmark; not validated
  at materially larger volumes.
- **NFR-4 (theme-aware, no new palette)**: all colors are `var(--...)` custom properties already
  defined by `window.css` (`--surface`, `--border-color`, `--accent`, etc.) plus the `--evt-<class>-
  border`/`-bg` tokens copied from `src/shared/css/timeline.css` — both already have light and dark
  values, so this component needs no palette of its own.
