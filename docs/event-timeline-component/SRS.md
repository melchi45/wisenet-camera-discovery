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
| 2.7 | 2026-08-31 | Youngho Kim | Two additions requested directly by the user: FR-5, mouse wheel now zooms over the overview row's own track too (`wireWheelZoom()`, shared with the detail-rows area) — previously only the latter had wheel handling at all. FR-2, a new `dataRange` option seeds the full data extent (unioned with the item extent) instead of the extent always being purely item-derived — lets a preset search or the initial default search always display its full requested period even with few or zero items in it. |
| 2.8 | 2026-08-31 | Youngho Kim | FR-2 corrected: v2.7's union with the item extent is dropped — `dataRange`, when provided, now IS the extent, unconditionally. The union broke TC-6/TC-7/TC-8 (items rendered compressed into an unusable sliver, unclickable) against `tools/mock-sunapi-server/`'s always-static fixture, whose fixed historical dates sit months away from any real test run's "now" — unioning a "now"-anchored requested range with that fixture's own unrelated dates produced a combined extent spanning from the fixture's dates to "now". Found live via Playwright; also fixed the fixture itself (see MEMORY.md) so it stays realistic against this FR-2 behavior going forward. |
| 2.9 | 2026-09-01 | Youngho Kim | Three fixes reported directly by the user comparing the rendered timeline against a real device: (1) NFR-5, the Normal row's height differed visibly from every other row — `src/shared/css/table.css`'s own unrelated bare `.normal` rule (reused as-is on the `src/shared-v2/` page) collided with this component's own `normal` color class; every color class is now `evt-`-prefixed. (2) FR-1, detail row labels didn't line up with the overview row's "ALL EVENTS" label, offset by the overview-only collapse button's own width — detail rows now reserve a matching invisible spacer. (3) FR-3, the overview row's collapse button previously only hid its item markers (leaving an empty-looking, still full-height track behind, with the highlight rectangle deliberately left visible per v2.3-v2.8's own design) — reversed: it now hides the entire track (items, highlight, and edge-handles together), actually folding the row down to its header. |
| 2.10 | 2026-09-01 | Youngho Kim | Requested directly by the user, right after v2.9: `.event-timeline-row`/`.event-timeline-row-track`/`.event-timeline-overview-track` all explicitly set `height: 20px` (previously an un-set/auto row height, a 30px detail track, and a 25px overview track respectively) — every row (overview and detail alike) is now the same fixed height. `src/shared/css/table.css`'s own `.normal` rule (the v2.9/NFR-5 collision source) also had its `height: 40px` declaration removed outright, not just made unreachable by the `evt-` rename — its `border` declaration is untouched, since that part of the rule isn't implicated in the collision. |
| 2.11 | 2026-09-01 | Youngho Kim | New FR-15: this component now also owns the "Overlapped Id" select, in the toolbar immediately left of the 1H/6H/1D/1W/1M/1Y preset buttons — the same single-canonical-control move v2.0 already did for Selected Time, replacing `playback.ts`'s/`playbackCalendar.ts`'s own previously-separate `#overlapped_id_area`/`#calendar_overlapped_id_area` DOM-building. Requested directly by the user. |
| 2.12 | 2026-09-01 | Youngho Kim | New FR-16: this component now also owns the Calendar/SUNAPI flow's "Rule" select, immediately left of Overlapped Id — same move as FR-15, requested again after an earlier attempt that only relocated the static HTML markup regressed on the very next remount (see FR-16's own body). `playbackCalendar.ts` mounts an empty-rows/items "shell" instance of this component (`ensureEventTimelineShell()`) so Rule is interactive before the first search of a panel-visible session, unlike Overlapped Id which stays absent until real data exists. |

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
  // v2.11 (FR-15): initial Overlapped Id options -- empty/omitted hides the
  // control. selectedOverlappedId picks which one starts selected (defaults
  // to the native highest-index-first default when omitted/not found).
  overlappedIds?: string[];
  selectedOverlappedId?: string;
}

export interface EventTimelineController {
  setCustomTime(date: Date): void;
  // v2.0 (FR-13): programmatic Selected Time update -- does not raise
  // onSelectedTimeChange.
  setSelectedTime(startDate: string, startTime: string, endDate: string | null, endTime: string | null): void;
  // v2.11 (FR-15): repopulates the Overlapped Id select ([] removes it) /
  // reads its current value ('null' when empty/not rendered).
  setOverlappedIds(ids: string[], selectedId?: string): void;
  getOverlappedId(): string | null;
  destroy(): void;
}

export function mountEventTimeline(config: MountEventTimelineOptions): EventTimelineController;
```

## Functional requirements

- **FR-1 (rows/layout)**: the row with `overview: true` renders first, as a collapsible "ALL
  EVENTS" strip; every other row renders below it, in `rows` array order, as its own detail row.
  Both kinds share a two-column layout (a fixed-width label/Hide-button header, then a track). **As
  of v2.9**, every detail row's header also reserves an invisible spacer the same width as the
  overview row's own collapse button (`▾`), which only the overview row actually has — without it,
  only the overview row's label was pushed right by that leading button, so the row-title column
  didn't line up. Reported directly by the user.
- **FR-2 (data extent, v2.8)**: the full data extent (`dataStart`/`dataEnd`) is computed once at
  mount, and never changes for the lifetime of one mounted instance. When `dataRange` is provided, it
  **is** the extent, exactly (not unioned with the item extent — an earlier draft did union them
  "defensively", but a real server should never return an item outside the range it was queried for,
  so that union was meant to be a no-op; it instead broke badly against `tools/mock-sunapi-server/`'s
  always-static fixture, whose fixed historical dates are nowhere near any real test run's actual
  "now" — see MEMORY.md); when `dataRange` is omitted, the extent is purely item-derived, same as
  before. This is what lets a preset search (1H/6H/1D/1W/1M/1Y) or the initial default search always
  show its full requested period — even one with few or zero items in it — instead of collapsing to
  just wherever
  the actual data happens to fall. Requested directly by the user.
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
  **entire track** (v2.9) — item markers, the highlight rectangle, and its edge-handles all hide
  together, folding the row down to just its header, matching the collapse button's own
  `aria-expanded` semantics. (v2.3-v2.8 scoped this to just the item markers, leaving the
  highlight visible either way "since it's the pan/zoom control, not just a display" — reversed
  directly by the user: the row visibly not collapsing at all, with an empty-looking track left
  behind, read as broken rather than as a deliberate always-available pan/zoom control.)
- **FR-4 (detail rows)**: each non-overview row draws only the items whose `rowId` matches it,
  scaled to the *current zoom window* (so these rows visually zoom/pan together), styled per that
  row's `colorClass`. A bar wide enough (see NFR-2) shows an inline `"<label> <duration>"` text
  label; every item (labeled or not) carries a `title` attribute with the full label/duration/time
  range, for hover.
- **FR-5 (zoom)**: mouse wheel over the detail-rows/axis area **or the overview row's own track
  (v2.5)** zooms in/out centered on the cursor's time — both wire the same wheel handler
  (`wireWheelZoom()`) onto the same shared `windowStart`/`windowEnd`, so scrolling zooms identically
  regardless of which row the pointer happens to be over; the zoom in/out toolbar buttons zoom centered on the window's midpoint; a Reset button
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

- **FR-15 (Overlapped Id, v2.11)**: the component renders its own "Overlapped Id" select in the
  toolbar, immediately to the left of the 1H/6H/1D/1W/1M/1Y preset buttons (`#overlapped_id`,
  wrapped in `.event-timeline-overlapped-id`, itself inside a `.event-timeline-toolbar-left` group
  with `.event-timeline-presets` so the two sit adjacent). Empty/omitted `overlappedIds` renders no
  control at all — matching the pre-move `#overlapped_id_area`/`#calendar_overlapped_id_area` DOM-
  building's own "absent until there's data" behavior — rather than an empty, disabled `<select>`.
  Options render highest-index-first (`ids[ids.length - 1]` first), so the select's native default
  (its first `<option>`) matches the pre-move select boxes' own default exactly.
  `selectedOverlappedId`/`setOverlappedIds()`'s own `selectedId` argument pick a different starting
  selection (falling back to the native default when omitted or not present in `ids`) — needed by
  callers that remount without a fresh Overlapped Id fetch (e.g. `playbackCalendar.ts`'s Rule-change
  re-search) and want the redrawn select to keep showing whichever value the last query actually
  used, not silently snap back to the list's own default. Like Selected Time (FR-13), this control
  is wiped back to empty on every remount unless the caller re-supplies `overlappedIds` itself — this
  component has no memory across its own `destroy()`/`mountEventTimeline()` cycle by design (see
  DESIGN.md). Requested directly by the user (moved out of `#playback_control`/
  `#playback_control_calendar`, where it lived as two separate, near-identical DOM-building code
  paths, into this shared component instead).

- **FR-16 (Rule, v2.12)**: the component also renders a "Rule" select in the toolbar, immediately to
  the left of Overlapped Id (`#event_rules_type`, wrapped in `.event-timeline-rule-type`, same
  `.event-timeline-toolbar-left` group). Same "absent until there's data" behavior as Overlapped Id
  (empty/omitted `ruleTypes` renders no control), but Calendar/SUNAPI-flow-only — the manual flow
  (`playback.ts`) never passes `ruleTypes`, so its own timeline never shows this control. Unlike
  Overlapped Id (read passively via `getOverlappedId()`), selecting a Rule fires `onRuleTypeChange`
  since a Rule change is itself expected to trigger a fresh Timeline query, not just be read back
  later. `{ value, label }` options (not a plain string list like `overlappedIds`) since the select's
  value (the Timeline query's `Type` param, e.g. `Rule2`) and its display label (the device's
  configured `RuleName`) differ. `selectedRuleType`/`setRuleTypes()`'s own `selectedValue` argument
  mirror `selectedOverlappedId`/`setOverlappedIds()` exactly.

  Moved directly per the user's request, after an earlier attempt that only relocated the static
  HTML markup regressed: this component tears down and rebuilds its whole toolbar on every
  `mountEventTimeline()` call, so a plain DOM move without also wiring the value through this
  component's own mount options/controller (the way Overlapped Id already was) got wiped on the
  very next remount (any day/preset click). Unlike Overlapped Id, Rule data
  (`getDynamicRules()`) is meaningful and expected to be interactive *before* the first search of a
  panel-visible session — `playbackCalendar.ts` handles this by mounting an empty-rows/items "shell"
  instance of this component as soon as Rule data is ready (`ensureEventTimelineShell()`), which a
  real search later destroys and replaces via `updateTimeline()` exactly like any other remount
  (`ruleTypes`/`selectedRuleType` thread through that remount the same way `overlappedIds`/
  `selectedOverlappedId` already do).

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
- **NFR-5 (namespaced color classes, v2.9)**: every per-`Type` color class (`playback.ts`'s
  `EVENT_COLOR_CLASSES`/`assignEventColorClass()`) is `evt-`-prefixed (`evt-normal`,
  `evt-motiondetection`, ...), never a bare word — `src/shared-v2/`'s `window.html` also loads
  `css/table.css` (reused as-is from `src/shared/`, per `docs/architecture.md`'s shared-asset
  convention), whose own unrelated `.normal { height: 40px; border: 1px solid red; }` rule
  (meant for the discovery result table) was silently applying to this component's own
  Normal-colored row label/items too, since both used the exact same bare `normal` class name —
  inflating just that one row's height far past every other row's. Reported directly by the user.
