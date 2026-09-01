// Reusable horizontal event-timeline UI component -- see
// docs/event-timeline-component/ (MRD/PRD/SRS/DESIGN/TC) for the full spec.
// src/shared-v2/-only (no src/shared/ consumer) -- replaces the vendored
// `vis` npm package's `vis.Timeline` for src/shared-v2/modules/playback.ts's
// Playback recording timeline (docs/window-ui/SRS.md FR-7.6 v1.16). Hand-
// rolled vanilla DOM/TS, no charting library, matching this repo's existing
// src/component/calendar|switch|disclosure convention.
//
// Like calendar.ts (and unlike switch.ts/disclosure.ts), this does NOT
// follow pure progressive enhancement: the whole widget (rows, items, zoom
// window) is inherently data-driven and gets torn down and rebuilt on every
// new search, so mountEventTimeline() always builds a fresh instance into an
// initially-empty container rather than caching/reusing a previous one --
// the caller (playback.ts) is expected to call the previous instance's
// destroy() itself before mounting a new one for the same container, since
// it already clears the container's innerHTML on every search anyway.
//
// As of docs/event-timeline-component/SRS.md v2.0: also owns a "Selected
// Time" input pair (docs FR-11), the single canonical "what will play"
// state shared by both of playback.ts's Playback UIs (manual FR-7.1 and
// the SUNAPI Calendar panel, FR-7.8) -- see MountEventTimelineOptions'
// `onSelectedTimeChange`/EventTimelineController's `setSelectedTime()`.
// Since a remount wipes any local Selected Time back to its "now, no end"
// default, playback.ts persists the last known selection itself and
// re-applies it via `setSelectedTime()` right after every remount -- this
// component has no memory across its own destroy()/mountEventTimeline()
// cycle by design (see the file-scope note above). The 1H/6H/1D/1W/1M/1Y
// preset buttons (docs FR-4 v2.0) can also now trigger a caller-owned
// re-fetch via `onRangePresetSelect` instead of a purely local re-zoom --
// still no network calls from this component itself (NFR-1 unchanged).
//
// As of docs FR-15: also owns the "Overlapped Id" select, in the toolbar
// immediately left of the 1H/6H/1D/1W/1M/1Y preset buttons -- replaces
// playback.ts's/playbackCalendar.ts's own previously-separate
// #overlapped_id_area/#calendar_overlapped_id_area DOM-building, same
// single-canonical-control move as Selected Time above. Moved directly per
// the user's request. Like Selected Time, this component still makes no
// network calls itself (NFR-1) -- callers populate it via `overlappedIds`/
// `setOverlappedIds()` with an already-fetched list and read the current
// selection back via `getOverlappedId()`.
//
// Also owns the Calendar/SUNAPI flow's "Rule" select (`#event_rules_type`),
// immediately left of Overlapped Id -- same move, requested again after an
// earlier attempt that only relocated the static HTML markup regressed:
// this component tears down and rebuilds its whole toolbar on every
// mountEventTimeline() call (file header above), so a plain DOM move
// without also wiring the value through this component's own mount
// options/controller (the way Overlapped Id already was) got wiped on the
// very next remount (any day/preset click). Unlike Overlapped Id, Rule data
// is meaningful and expected to be interactive *before* the first search of
// a panel-visible session (playbackCalendar.ts's getDynamicRules() fetch
// runs independently of any day click) -- playbackCalendar.ts handles this
// by mounting an empty-rows/items "shell" instance of this widget as soon
// as Rule data is ready, which a real search later destroys and replaces
// via updateTimeline() exactly like any other remount (ruleTypes/
// selectedRuleType thread through that remount the same way overlappedIds/
// selectedOverlappedId already do). Selecting a Rule fires
// `onRuleTypeChange` (unlike Overlapped Id, which callers read passively
// via `getOverlappedId()`) since a Rule change is itself expected to
// trigger a fresh Timeline query, not just be read back later.

export interface EventTimelineRow {
  id: string;
  label: string;
  /** Only meaningful for detail rows -- picks which --evt-<class>-border/
   *  bg token pair (event-timeline.css) colors this row's label and its
   *  items. Ignored for the overview row (id 'All'), whose items keep each
   *  item's own className instead of one fixed row color. */
  colorClass?: string;
  /** Exactly one row should set this -- rendered above the detail rows as
   *  the collapsible "ALL EVENTS" mini-overview/zoom-scrubber strip. */
  overview?: boolean;
}

export interface EventTimelineItem {
  id: string;
  rowId: string;
  start: Date;
  end?: Date;
  /** Display text, e.g. the raw `Type` string ("Normal", "Rule1", ...). */
  label: string;
  /** Color class -- one of timeline.css's existing --evt-<class>-* keys
   *  ("normal", "motiondetection", "unknown", ...). */
  className: string;
  /** Passthrough for the caller's own click handling -- never read by this
   *  component itself. */
  raw?: unknown;
}

export interface MountEventTimelineOptions {
  /** id of an existing, empty container element. */
  containerId: string;
  /** First row with `overview: true` renders as the "ALL EVENTS" strip;
   *  every other row renders as its own detail row, in array order. */
  rows: EventTimelineRow[];
  items: EventTimelineItem[];
  /** The full extent to display (the "ALL EVENTS" overview scale, the
   *  outer zoom-clamp bound, and what a preset button's own active-state
   *  check compares against) -- when provided, this **is** the extent,
   *  exactly (not unioned with the item extent -- an earlier version of
   *  this option did union them "defensively, in case an item ever falls
   *  outside it", but a real server should never return an item outside
   *  the range it was queried for, and that union broke badly against a
   *  test double that doesn't honor query ranges at all; see MEMORY.md).
   *  Without it (FR-2's original behavior, still the fallback when
   *  omitted), a preset search that comes back with few or zero items
   *  collapses the display to just wherever those items happen to fall,
   *  instead of showing the full requested period (e.g. a real, empty
   *  hour for a 1H search) the way a search covering a wider span than
   *  its actual data always should. Pass the caller's own requested
   *  `[start, end]` here whenever one exists (a preset click, a Calendar
   *  day, the initial default search) -- omit only when there genuinely
   *  isn't one. */
  dataRange?: { start: Date; end: Date };
  /** GMT/timezone-aware axis tick + item tooltip formatter. Defaults to
   *  the browser's local-timezone `toLocaleTimeString()`. */
  formatTick?: (date: Date) => string;
  /** Defaults to a plain "1h 2m 3s"-style formatter. */
  formatDuration?: (ms: number) => string;
  /** Fires on a plain (non-dragging) click on an item, in either the
   *  overview row or a detail row. */
  onSelect?: (item: EventTimelineItem) => void;
  /** Fires on a double-click anywhere in the detail-rows/axis area --
   *  `time` is the clicked pixel's corresponding Date in the current zoom
   *  window, matching the original vis.Timeline `doubleClick` handler's
   *  `properties.time` (not necessarily an item's own start time). `item` is
   *  additionally provided (v2.14) when the double-click landed on an actual
   *  item -- pixel-derived `time` is only ever an approximation of where the
   *  user clicked (a real, reported miss: `time` landed 3 minutes past the
   *  end of a 4-minute item the user had double-clicked well inside),
   *  whereas `item.start`/`item.end` are the event's real, exact boundaries.
   *  Callers that want an exact seek onto the double-clicked event itself
   *  should prefer `item` over `time` when it's present. */
  onDoubleClick?: (time: Date, item?: EventTimelineItem) => void;
  /** Fires when the user edits the Selected Time inputs directly (typing a
   *  new date/time, or toggling "Has End Time") -- NOT fired by
   *  `setSelectedTime()` itself (plain `.value =` assignment doesn't raise
   *  a native `change` event, so programmatic updates from `onSelect`
   *  don't loop back here). `endDate`/`endTime` both `null` means
   *  open-ended (no end time) -- see docs/event-timeline-component/SRS.md
   *  FR-11. The component only ever hands the caller these four plain
   *  strings (`YYYY-MM-DD`/`HH:mm:ss`, matching native `<input
   *  type="date"|"time">` values) -- it has no notion of GMT/camera
   *  timezone (NFR-1); the caller (playback.ts) is responsible for any
   *  device-specific interpretation. */
  onSelectedTimeChange?: (startDate: string, startTime: string, endDate: string | null, endTime: string | null) => void;
  /** Fires when the user clicks one of the 1H/6H/1D/1W/1M/1Y preset
   *  buttons -- `fromDate`/`toDate` are `[now - presetMs, now]` (see
   *  docs/event-timeline-component/SRS.md FR-4 v2.0). Unlike the
   *  pre-v2.0 behavior (a purely local `setWindow()` re-zoom of
   *  already-fetched data), providing this callback hands the *decision*
   *  of what range to display to the caller, who is expected to
   *  re-fetch and re-mount with fresh data -- the component itself still
   *  makes no network calls (NFR-1 unchanged), it only computes the
   *  requested window's boundary Dates. If omitted, the preset buttons
   *  fall back to the original local-zoom-only behavior. */
  onRangePresetSelect?: (fromDate: Date, toDate: Date, label: string) => void;
  /** Initial Overlapped Id option values, rendered in the toolbar
   *  immediately to the left of the 1H/6H/1D/1W/1M/1Y preset buttons
   *  (docs/event-timeline-component/SRS.md FR-15) -- omit or pass an empty
   *  array to start with no control shown at all, matching the pre-move
   *  `#overlapped_id_area`/`#calendar_overlapped_id_area` DOM-building's own
   *  "absent until there's data" behavior. Mirrors the controller's
   *  `setOverlappedIds()` below; both render into the same single, page-
   *  unique `#overlapped_id` select (FR-13's "only one #timeline instance
   *  ever exists at a time" reasoning applies here too -- this replaces
   *  BOTH of playback.ts's/playbackCalendar.ts's previously-separate manual/
   *  Calendar-flow selects). Options render highest-index-first, so the
   *  select's native default (its first `<option>`) matches the pre-move
   *  select boxes' own default exactly. */
  overlappedIds?: string[];
  /** Which of `overlappedIds` starts selected -- defaults to the select's
   *  native default (highest-index-first, see `overlappedIds` above) when
   *  omitted or not present in `overlappedIds`. Exists for callers that
   *  remount without a fresh Overlapped Id fetch (e.g. playbackCalendar.ts's
   *  Rule-change path) and want the redrawn select to keep showing
   *  whichever value the user had actually queried with, not silently snap
   *  back to the list's own default. */
  selectedOverlappedId?: string;
  /** Initial Rule option values, rendered in the toolbar immediately to the
   *  left of Overlapped Id (docs/event-timeline-component/SRS.md FR-16) --
   *  omit or pass an empty array to start with no control shown at all,
   *  matching Overlapped Id's own "absent until there's data" behavior
   *  (`overlappedIds` above). Calendar/SUNAPI-flow-only (playbackCalendar.ts)
   *  -- the manual flow (playback.ts) never passes this, so its own
   *  `updateTimeline()` calls render no Rule control, same as before this
   *  control existed. `{ value, label }` since the select's value (SUNAPI's
   *  `Rule<N>` Timeline `Type` param) and its display label (the
   *  configured RuleName) differ. */
  ruleTypes?: { value: string; label: string }[];
  /** Which of `ruleTypes` starts selected -- defaults to the select's
   *  native default (first option) when omitted or not present in
   *  `ruleTypes`. Mirrors `selectedOverlappedId` -- lets a remount (e.g. a
   *  Rule-change re-search) keep showing the value the user actually
   *  queried with. */
  selectedRuleType?: string;
  /** Fires when the user changes the Rule select -- unlike Overlapped Id
   *  (read passively via `getOverlappedId()`), a Rule change is itself
   *  expected to trigger a fresh Timeline query, so this is a callback
   *  rather than a getter. Not fired by `setRuleTypes()` itself. */
  onRuleTypeChange?: (value: string) => void;
  /** Fires once, on pointer release, when the user drags the current-time
   *  marker (`setCustomTime()`'s line) left/right -- `date` is the Date at
   *  the dropped position in the current zoom window. Not fired during the
   *  drag itself (docs/event-timeline-component/SRS.md FR-14: "seek once on
   *  release, not continuously"), and not fired at all unless this option
   *  is provided -- omitting it leaves the marker exactly as before
   *  (a fixed, non-interactive line, `pointer-events: none`). */
  onCustomTimeSeek?: (date: Date) => void;
}

export interface EventTimelineController {
  /** Moves the "now"/playhead marker -- replaces vis.Timeline's
   *  addCustomTime()/setCustomTime(). Purely visual (the line itself);
   *  the caller (playback.ts) owns the actual current-time display
   *  (`#seeking_date`/`#seeking_time`, in the Video Control panel -- see
   *  FR-14, this component does not duplicate that display itself).
   *  `null` hides the marker -- the caller passes this whenever playback
   *  isn't actually in the PLAYING state (paused/stopped), since a frozen
   *  or stale line otherwise keeps showing the last position forever. */
  setCustomTime(date: Date | null): void;
  /** Programmatically sets the Selected Time inputs (e.g. from
   *  `onSelect` after the caller resolves an item's GMT-adjusted start/
   *  end) without raising `onSelectedTimeChange` -- see that option's own
   *  doc comment. `endDate`/`endTime` both `null` clears End Time
   *  (unchecks "Has End Time", open-ended). */
  setSelectedTime(startDate: string, startTime: string, endDate: string | null, endTime: string | null): void;
  /** Repopulates the Overlapped Id select (FR-15) -- an empty array removes
   *  it entirely, same add/remove-on-empty behavior the pre-move
   *  `#overlapped_id_area`/`#calendar_overlapped_id_area` DOM-building had.
   *  Options render highest-index-first (matching `overlappedIds`'s own
   *  mount-time option above), so the native default selection lands on
   *  the same value the pre-move select boxes defaulted to.
   *  `selectedId` mirrors `MountEventTimelineOptions.selectedOverlappedId`
   *  -- omit for the plain default-selection behavior. */
  setOverlappedIds(ids: string[], selectedId?: string): void;
  /** The Overlapped Id select's current value, or `null` when the control
   *  is empty/not rendered. Callers read this right before their own
   *  `getTimeline()` call (Rule change, a Selected Time-independent re-
   *  search) instead of querying `#overlapped_id` directly. */
  getOverlappedId(): string | null;
  /** Repopulates the Rule select (FR-16) -- same add/remove-on-empty
   *  behavior as `setOverlappedIds()`. `selectedValue` mirrors
   *  `MountEventTimelineOptions.selectedRuleType`. */
  setRuleTypes(options: { value: string; label: string }[], selectedValue?: string): void;
  /** The Rule select's current value, or `null` when the control is empty/
   *  not rendered. */
  getRuleType(): string | null;
  /** Detaches all listeners/observers. Callers that re-mount into the same
   *  container on every search (playback.ts) must call this on the
   *  previous instance first. */
  destroy(): void;
}

const MIN_WINDOW_MS = 5000;
const WHEEL_ZOOM_FACTOR = 1.2;
const BUTTON_ZOOM_FACTOR = 1.5;
const DRAG_THRESHOLD_PX = 4;
const MIN_LABELED_ITEM_WIDTH_PX = 46;
const ROW_HEADER_WIDTH_PX = 150;
const AXIS_TICK_COUNT = 5;

const ZOOM_PRESETS: { label: string; ms: number }[] = [
  { label: '1H', ms: 3600_000 },
  { label: '6H', ms: 6 * 3600_000 },
  { label: '1D', ms: 24 * 3600_000 },
  { label: '1W', ms: 7 * 24 * 3600_000 },
  { label: '1M', ms: 30 * 24 * 3600_000 },
  { label: '1Y', ms: 365 * 24 * 3600_000 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function defaultFormatTick(date: Date): string {
  return date.toLocaleTimeString();
}

function defaultFormatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/** Mounts a fresh event-timeline widget into `config.containerId`. Not
 *  idempotent (see file header) -- always builds a new instance. */
export function mountEventTimeline(config: MountEventTimelineOptions): EventTimelineController {
  const container = document.getElementById(config.containerId);
  if (container === null) {
    throw new Error(`mountEventTimeline: "${config.containerId}" does not exist`);
  }

  const formatTick = config.formatTick ?? defaultFormatTick;
  const formatDuration = config.formatDuration ?? defaultFormatDuration;

  const overviewRow = config.rows.find((r) => r.overview === true) ?? null;
  const detailRows = config.rows.filter((r) => r.overview !== true);

  const itemsByRow = new Map<string, EventTimelineItem[]>();
  for (const item of config.items) {
    const list = itemsByRow.get(item.rowId);
    if (list) {
      list.push(item);
    } else {
      itemsByRow.set(item.rowId, [item]);
    }
  }

  let dataStart = new Date();
  let dataEnd = new Date();
  if (config.dataRange) {
    // Deliberately NOT unioned with the item extent (an earlier version of
    // this did union them, defensively, "in case an item ever falls
    // outside the requested range") -- a real SUNAPI response should never
    // return an item outside the range it was queried for, so that union
    // was meant to be a no-op safety net. It instead actively broke every
    // test against tools/mock-sunapi-server/, which always returns the
    // same ~150-item static fixture regardless of the query's actual date
    // range (documented in MEMORY.md) -- unioning a "now"-anchored
    // requested range with that fixture's own unrelated fixed dates
    // produced a combined extent spanning from the fixture's dates all the
    // way to "now", compressing every real item into a sliver of the
    // track and making them overlap each other at the pixel level. Found
    // live via Playwright (TC-6/TC-7/TC-8 regressions right after adding
    // `dataRange`). Using the requested range as-is, unconditionally, both
    // matches real-server behavior exactly and sidesteps this entirely.
    dataStart = config.dataRange.start;
    dataEnd = config.dataRange.end.getTime() > dataStart.getTime()
      ? config.dataRange.end
      : new Date(dataStart.getTime() + MIN_WINDOW_MS);
  } else if (config.items.length > 0) {
    let minMs = Infinity;
    let maxMs = -Infinity;
    for (const item of config.items) {
      minMs = Math.min(minMs, item.start.getTime());
      maxMs = Math.max(maxMs, (item.end ?? item.start).getTime());
    }
    dataStart = new Date(minMs);
    dataEnd = new Date(maxMs === minMs ? minMs + MIN_WINDOW_MS : maxMs);
  }
  const fullRangeMs = () => Math.max(dataEnd.getTime() - dataStart.getTime(), MIN_WINDOW_MS);

  let windowStart = dataStart.getTime();
  let windowEnd = dataEnd.getTime();
  let customTime: Date | null = null;

  // ---- DOM scaffold -----------------------------------------------------
  container.replaceChildren();
  const root = document.createElement('div');
  root.className = 'event-timeline';

  const toolbar = document.createElement('div');
  toolbar.className = 'event-timeline-toolbar';

  // ---- Overlapped Id (docs/event-timeline-component/SRS.md FR-15) ------
  // Replaces playback.ts's/playbackCalendar.ts's own previously-separate
  // #overlapped_id_area/#calendar_overlapped_id_area DOM-building -- lives
  // here now so both flows share one control, positioned immediately to
  // the left of the 1H/6H/1D/1W/1M/1Y preset buttons below. Moved directly
  // per the user's request.
  const overlappedIdEl = document.createElement('div');
  overlappedIdEl.className = 'event-timeline-overlapped-id';
  let overlappedIdSelect: HTMLSelectElement | null = null;

  function renderOverlappedIds(ids: string[], selectedId?: string): void {
    overlappedIdEl.replaceChildren();
    overlappedIdSelect = null;
    if (ids.length === 0) {
      return;
    }
    const label = document.createElement('span');
    label.className = 'event-timeline-overlapped-id-label';
    label.textContent = 'Overlapped Id:';
    const select = document.createElement('select');
    select.id = 'overlapped_id';
    // Highest-index-first, matching the pre-move select boxes' own option
    // order -- their native default (first <option>) landed on ids[ids.length
    // - 1], not ids[0].
    for (let i = ids.length - 1; i >= 0; i--) {
      const opt = document.createElement('option');
      opt.value = ids[i];
      opt.textContent = ids[i];
      select.append(opt);
    }
    if (selectedId !== undefined && ids.includes(selectedId)) {
      select.value = selectedId;
    }
    overlappedIdEl.append(label, select);
    overlappedIdSelect = select;
  }
  renderOverlappedIds(config.overlappedIds ?? [], config.selectedOverlappedId);

  // ---- Rule (docs/event-timeline-component/SRS.md FR-16) ----------------
  // Calendar/SUNAPI-flow-only -- replaces playbackCalendar.ts's own
  // previously-separate static `#event_rules_type` markup, same move as
  // Overlapped Id above (see the file-header note on why a plain DOM move
  // alone doesn't survive a remount). Positioned immediately to the left of
  // Overlapped Id.
  const ruleTypeEl = document.createElement('div');
  ruleTypeEl.className = 'event-timeline-rule-type';
  let ruleTypeSelect: HTMLSelectElement | null = null;

  function renderRuleTypes(options: { value: string; label: string }[], selectedValue?: string): void {
    ruleTypeEl.replaceChildren();
    ruleTypeSelect = null;
    if (options.length === 0) {
      return;
    }
    const label = document.createElement('span');
    label.className = 'event-timeline-rule-type-label';
    label.textContent = 'Rule:';
    const select = document.createElement('select');
    select.id = 'event_rules_type';
    for (const opt of options) {
      const optionEl = document.createElement('option');
      optionEl.value = opt.value;
      optionEl.textContent = opt.label;
      select.append(optionEl);
    }
    if (selectedValue !== undefined && options.some((opt) => opt.value === selectedValue)) {
      select.value = selectedValue;
    }
    select.addEventListener('change', () => config.onRuleTypeChange?.(select.value));
    ruleTypeEl.append(label, select);
    ruleTypeSelect = select;
  }
  renderRuleTypes(config.ruleTypes ?? [], config.selectedRuleType);

  const toolbarLeft = document.createElement('div');
  toolbarLeft.className = 'event-timeline-toolbar-left';

  const presetsEl = document.createElement('div');
  presetsEl.className = 'event-timeline-presets';
  const presetButtons: HTMLButtonElement[] = [];
  for (const preset of ZOOM_PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'event-timeline-preset-btn';
    btn.textContent = preset.label;
    btn.addEventListener('click', () => {
      if (config.onRangePresetSelect) {
        const toDate = new Date();
        const fromDate = new Date(toDate.getTime() - preset.ms);
        config.onRangePresetSelect(fromDate, toDate, preset.label);
        return;
      }
      const end = dataEnd.getTime();
      const start = Math.max(dataStart.getTime(), end - preset.ms);
      setWindow(start, end);
    });
    presetsEl.append(btn);
    presetButtons.push(btn);
  }
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'event-timeline-preset-btn event-timeline-reset-btn';
  resetBtn.textContent = 'Reset';
  resetBtn.addEventListener('click', () => setWindow(dataStart.getTime(), dataEnd.getTime()));
  presetsEl.append(resetBtn);

  const zoomControlsEl = document.createElement('div');
  zoomControlsEl.className = 'event-timeline-zoom-controls';
  const zoomOutBtn = document.createElement('button');
  zoomOutBtn.type = 'button';
  zoomOutBtn.className = 'event-timeline-zoom-btn';
  zoomOutBtn.textContent = '−';
  zoomOutBtn.setAttribute('aria-label', 'Zoom out');
  const zoomReadout = document.createElement('span');
  zoomReadout.className = 'event-timeline-zoom-readout';
  const zoomInBtn = document.createElement('button');
  zoomInBtn.type = 'button';
  zoomInBtn.className = 'event-timeline-zoom-btn';
  zoomInBtn.textContent = '+';
  zoomInBtn.setAttribute('aria-label', 'Zoom in');
  zoomOutBtn.addEventListener('click', () => zoomAroundRatio(0.5, BUTTON_ZOOM_FACTOR));
  zoomInBtn.addEventListener('click', () => zoomAroundRatio(0.5, 1 / BUTTON_ZOOM_FACTOR));
  zoomControlsEl.append(zoomOutBtn, zoomReadout, zoomInBtn);

  toolbarLeft.append(ruleTypeEl, overlappedIdEl, presetsEl);
  toolbar.append(toolbarLeft, zoomControlsEl);
  root.append(toolbar);

  // ---- Selected Time (docs/event-timeline-component/SRS.md FR-11) -------
  // Pure playback-target state, owned by this component so both of
  // playback.ts's Playback UIs (manual FR-7.1 and the SUNAPI Calendar
  // panel, FR-7.8) share one place for "what will play" instead of each
  // keeping its own now-removed Manual Start/End Time fields. This
  // component never reads/writes SUNAPI or GMT concepts (NFR-1) -- it
  // only exposes plain YYYY-MM-DD/HH:mm:ss strings, exactly matching
  // native <input type="date"|"time"> values.
  const selectedTimeEl = document.createElement('div');
  selectedTimeEl.className = 'event-timeline-selected-time';

  const selectedTimeLabel = document.createElement('span');
  selectedTimeLabel.className = 'event-timeline-selected-time-label';
  selectedTimeLabel.textContent = 'Selected Time:';

  const selectedStartDate = document.createElement('input');
  selectedStartDate.type = 'date';
  selectedStartDate.id = 'selected_start_date';
  const selectedStartTime = document.createElement('input');
  selectedStartTime.type = 'time';
  selectedStartTime.id = 'selected_start_time';
  selectedStartTime.step = '1';

  const hasEndTimeLabel = document.createElement('label');
  hasEndTimeLabel.className = 'event-timeline-has-end-time-label';
  const hasEndTimeCheckbox = document.createElement('input');
  hasEndTimeCheckbox.type = 'checkbox';
  hasEndTimeCheckbox.id = 'selected_has_end_time';
  hasEndTimeLabel.append(hasEndTimeCheckbox, document.createTextNode(' Has End Time'));

  const selectedEndDate = document.createElement('input');
  selectedEndDate.type = 'date';
  selectedEndDate.id = 'selected_end_date';
  const selectedEndTime = document.createElement('input');
  selectedEndTime.type = 'time';
  selectedEndTime.id = 'selected_end_time';
  selectedEndTime.step = '1';

  selectedTimeEl.append(
    selectedTimeLabel, selectedStartDate, selectedStartTime,
    hasEndTimeLabel, selectedEndDate, selectedEndTime,
  );
  root.append(selectedTimeEl);

  function updateEndFieldsEnabled(): void {
    const hasEnd = hasEndTimeCheckbox.checked;
    selectedEndDate.disabled = !hasEnd;
    selectedEndTime.disabled = !hasEnd;
  }
  updateEndFieldsEnabled();

  // Default (before any item click / caller-driven setSelectedTime()):
  // now, no end time -- matches the pre-move #start_date/#support_end_time
  // startup defaults (today's date, End Time unchecked) exactly.
  {
    const now = new Date();
    const pad2 = (n: number) => String(n).padStart(2, '0');
    selectedStartDate.value = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    selectedStartTime.value = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  }

  function emitSelectedTimeChange(): void {
    if (!config.onSelectedTimeChange) {
      return;
    }
    const hasEnd = hasEndTimeCheckbox.checked;
    config.onSelectedTimeChange(
      selectedStartDate.value, selectedStartTime.value,
      hasEnd ? selectedEndDate.value : null, hasEnd ? selectedEndTime.value : null,
    );
  }
  selectedStartDate.addEventListener('change', emitSelectedTimeChange);
  selectedStartTime.addEventListener('change', emitSelectedTimeChange);
  selectedEndDate.addEventListener('change', emitSelectedTimeChange);
  selectedEndTime.addEventListener('change', emitSelectedTimeChange);
  hasEndTimeCheckbox.addEventListener('change', () => {
    updateEndFieldsEnabled();
    emitSelectedTimeChange();
  });

  interface RowRefs {
    row: EventTimelineRow;
    rowEl: HTMLElement;
    trackEl: HTMLElement;
    itemsLayerEl: HTMLElement;
  }

  let overviewRefs: RowRefs | null = null;
  // Gates the *detail rows'* (rowsContainer's) visibility -- clicking the
  // overview row's collapseBtn below collapses the whole per-Rule row list,
  // not the overview ("ALL EVENTS") row's own track. See the listener below.
  let allRowsCollapsed = false;
  let overviewHighlightEl: HTMLElement | null = null;

  // Wraps the overview row AND the detail rows together (not just the
  // latter) so the current-time marker -- appended into this wrapper, not
  // rowsContainer alone -- visually spans "ALL EVENTS" too, instead of
  // starting only below it.
  const rowsWrapper = document.createElement('div');
  rowsWrapper.className = 'event-timeline-rows-wrapper';
  root.append(rowsWrapper);

  if (overviewRow !== null) {
    const rowEl = document.createElement('div');
    rowEl.className = 'event-timeline-row event-timeline-overview-row';

    const header = document.createElement('div');
    header.className = 'event-timeline-row-header';
    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'event-timeline-collapse-btn';
    collapseBtn.setAttribute('aria-expanded', 'true');
    collapseBtn.textContent = '▾';
    const label = document.createElement('span');
    label.className = 'event-timeline-row-label event-timeline-overview-label';
    label.textContent = overviewRow.label;
    // Collapses/expands the detail rows (rowsContainer) below -- NOT this
    // overview row's own track, which stays visible either way. `rowsContainer`
    // is declared further down this function, but this listener only ever
    // runs on a later user click, well after mount finishes assigning it.
    collapseBtn.addEventListener('click', () => {
      allRowsCollapsed = !allRowsCollapsed;
      collapseBtn.setAttribute('aria-expanded', String(!allRowsCollapsed));
      collapseBtn.textContent = allRowsCollapsed ? '▸' : '▾';
      rowsContainer.classList.toggle('event-timeline-rows-collapsed', allRowsCollapsed);
    });
    header.append(collapseBtn, label);
    rowEl.append(header);

    const trackEl = document.createElement('div');
    trackEl.className = 'event-timeline-overview-track';
    const itemsLayerEl = document.createElement('div');
    itemsLayerEl.className = 'event-timeline-overview-items';
    const highlightEl = document.createElement('div');
    highlightEl.className = 'event-timeline-viewport-highlight';
    const handleLeft = document.createElement('div');
    handleLeft.className = 'event-timeline-viewport-handle event-timeline-viewport-handle-left';
    const handleRight = document.createElement('div');
    handleRight.className = 'event-timeline-viewport-handle event-timeline-viewport-handle-right';
    highlightEl.append(handleLeft, handleRight);
    trackEl.append(itemsLayerEl, highlightEl);
    rowEl.append(trackEl);
    rowsWrapper.append(rowEl);

    overviewRefs = { row: overviewRow, rowEl, trackEl, itemsLayerEl };
    overviewHighlightEl = highlightEl;

    wireOverviewDrag(trackEl);
    wireWheelZoom(trackEl);
  }

  const rowsContainer = document.createElement('div');
  rowsContainer.className = 'event-timeline-rows';
  rowsWrapper.append(rowsContainer);

  const detailRefs: RowRefs[] = [];
  for (const row of detailRows) {
    const rowEl = document.createElement('div');
    rowEl.className = 'event-timeline-row event-timeline-detail-row';

    const header = document.createElement('div');
    header.className = 'event-timeline-row-header';
    // Invisible placeholder matching the overview row's own collapse
    // button footprint (see below) -- without it, only the overview row's
    // header carries that leading button, so its own label starts further
    // right than every detail row's label and the row-title column doesn't
    // line up. Reported directly by the user. aria-hidden since it carries
    // no content/behavior, purely a layout spacer.
    const collapseSpacer = document.createElement('span');
    collapseSpacer.className = 'event-timeline-collapse-btn-spacer';
    collapseSpacer.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = `event-timeline-row-label ${row.colorClass ?? ''}`;
    label.textContent = row.label;
    header.append(collapseSpacer, label);
    rowEl.append(header);

    const trackEl = document.createElement('div');
    trackEl.className = 'event-timeline-row-track';
    rowEl.append(trackEl);
    rowsContainer.append(rowEl);

    detailRefs.push({ row, rowEl, trackEl, itemsLayerEl: trackEl });
  }

  wireZoomPan(rowsContainer);

  const axisRow = document.createElement('div');
  axisRow.className = 'event-timeline-axis-row';
  const axisSpacer = document.createElement('div');
  axisSpacer.className = 'event-timeline-row-header event-timeline-axis-spacer';
  const axisTrack = document.createElement('div');
  axisTrack.className = 'event-timeline-axis-track';
  axisRow.append(axisSpacer, axisTrack);
  root.append(axisRow);

  container.append(root);

  // ---- Scale / zoom-window math ------------------------------------------
  function timeToRatio(t: number, start: number, end: number): number {
    return (t - start) / (end - start);
  }

  function ratioToTime(ratio: number, start: number, end: number): number {
    return start + ratio * (end - start);
  }

  function setWindow(newStart: number, newEnd: number): void {
    let start = newStart;
    let end = Math.max(newEnd, start + MIN_WINDOW_MS);
    if (end - start > fullRangeMs()) {
      start = dataStart.getTime();
      end = dataEnd.getTime();
    }
    if (start < dataStart.getTime()) {
      end += dataStart.getTime() - start;
      start = dataStart.getTime();
    }
    if (end > dataEnd.getTime()) {
      start -= end - dataEnd.getTime();
      end = dataEnd.getTime();
    }
    windowStart = Math.max(start, dataStart.getTime());
    windowEnd = Math.min(end, dataEnd.getTime());
    render();
  }

  function zoomAroundRatio(ratio: number, factor: number): void {
    const anchorTime = ratioToTime(ratio, windowStart, windowEnd);
    let newRange = clamp((windowEnd - windowStart) * factor, MIN_WINDOW_MS, fullRangeMs());
    let newStart = anchorTime - ratio * newRange;
    setWindow(newStart, newStart + newRange);
  }

  // ---- Wheel zoom -- shared by the detail-rows area (wireZoomPan) and the
  // overview row's own track (wireOverviewDrag), so scrolling zooms the
  // same shared window regardless of which row the pointer happens to be
  // over. Requested directly by the user (the overview row previously had
  // no wheel handling of its own at all). ---------------------------------
  function wireWheelZoom(el: HTMLElement): void {
    el.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      zoomAroundRatio(ratio, event.deltaY > 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR);
    }, { passive: false });
  }

  // ---- Pointer interaction: zoom (wheel) + pan (drag) + click on items ---
  function wireZoomPan(el: HTMLElement): void {
    wireWheelZoom(el);

    let dragging = false;
    let dragStartX = 0;
    let dragStartWindowStart = 0;
    let dragStartWindowEnd = 0;
    let pointerDownTarget: HTMLElement | null = null;

    el.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }
      dragging = false;
      dragStartX = event.clientX;
      dragStartWindowStart = windowStart;
      dragStartWindowEnd = windowEnd;
      pointerDownTarget = event.target as HTMLElement;
      el.setPointerCapture(event.pointerId);
    });

    el.addEventListener('pointermove', (event) => {
      if (pointerDownTarget === null) {
        return;
      }
      const deltaPx = event.clientX - dragStartX;
      if (!dragging && Math.abs(deltaPx) < DRAG_THRESHOLD_PX) {
        return;
      }
      dragging = true;
      const rect = el.getBoundingClientRect();
      const deltaMs = -(deltaPx / rect.width) * (dragStartWindowEnd - dragStartWindowStart);
      setWindow(dragStartWindowStart + deltaMs, dragStartWindowEnd + deltaMs);
    });

    const finishPointer = (event: PointerEvent): void => {
      if (pointerDownTarget === null) {
        return;
      }
      if (!dragging) {
        handleItemOrTrackActivation(pointerDownTarget, el, event.clientX, false, event.clientY);
      }
      dragging = false;
      pointerDownTarget = null;
    };
    el.addEventListener('pointerup', finishPointer);
    el.addEventListener('pointercancel', () => {
      dragging = false;
      pointerDownTarget = null;
    });

    el.addEventListener('dblclick', (event) => {
      handleItemOrTrackActivation(event.target as HTMLElement, el, event.clientX, true, event.clientY);
    });
  }

  /** `clientY`, when given, backstops `target.closest('.event-timeline-item')`
   *  with a point-based lookup (`elementsFromPoint`) whenever that fails --
   *  needed for a plain click released on the overview's resize handles
   *  (`.event-timeline-viewport-handle`), which sit at the exact left/right
   *  edges of the current zoom window and, at the default full-extent zoom,
   *  land directly on top of whichever item starts/ends the data range.
   *  `target.closest()` can never find the item there (the handle isn't a
   *  descendant of it), so without this fallback that item -- commonly the
   *  earliest Normal item -- would be unselectable exactly like the
   *  highlight/marker collisions fixed above. Found live via Playwright. */
  function handleItemOrTrackActivation(target: HTMLElement, trackEl: HTMLElement, clientX: number, isDoubleClick: boolean, clientY?: number): void {
    let itemEl = target.closest<HTMLElement>('.event-timeline-item');
    if (itemEl === null && clientY !== undefined) {
      for (const el of document.elementsFromPoint(clientX, clientY)) {
        const found = (el as HTMLElement).closest<HTMLElement>('.event-timeline-item');
        if (found !== null) {
          itemEl = found;
          break;
        }
      }
    }
    let matchedItem: EventTimelineItem | undefined;
    if (itemEl !== null && itemEl.dataset.itemId !== undefined) {
      const item = itemsById.get(itemEl.dataset.itemId);
      if (item !== undefined) {
        matchedItem = item;
        if (config.onSelect) {
          config.onSelect(item);
        }
        markSelected(itemEl);
      }
    }
    if (isDoubleClick && config.onDoubleClick) {
      // `trackEl` here is `rowsContainer` (the only caller that ever passes
      // `isDoubleClick: true`, see wireZoomPan below) -- its bounding rect
      // spans BOTH each row's ROW_HEADER_WIDTH_PX label column AND the
      // actual time-scaled track, unlike the other ratio/pixel conversions
      // in this file (renderCustomTime, wireCustomTimeDrag) which all
      // subtract that header width first. Omitting it here shifted every
      // computed `time` later by roughly (header-width / total-width) of
      // the current zoom window's span -- a real, reported miss (double-
      // clicking inside an item landed the seek several minutes past the
      // item's own end). `matchedItem` (when present) sidesteps this
      // entirely by giving the caller the item's own exact boundaries
      // instead, but `time` itself still needs to be correct for a
      // double-click on empty track space, where there's no item to fall
      // back on.
      const rect = trackEl.getBoundingClientRect();
      const trackWidthPx = Math.max(rect.width - ROW_HEADER_WIDTH_PX, 0);
      const ratio = trackWidthPx > 0 ? clamp((clientX - rect.left - ROW_HEADER_WIDTH_PX) / trackWidthPx, 0, 1) : 0;
      config.onDoubleClick(new Date(ratioToTime(ratio, windowStart, windowEnd)), matchedItem);
    }
  }

  const selectedItemEls = new Set<HTMLElement>();
  function markSelected(itemEl: HTMLElement): void {
    for (const el of selectedItemEls) {
      el.classList.remove('event-timeline-item-selected');
    }
    selectedItemEls.clear();
    itemEl.classList.add('event-timeline-item-selected');
    selectedItemEls.add(itemEl);
  }

  // How close (in px) a pointerdown must land to the highlight's own left/
  // right edge to be treated as a resize rather than a pan/click -- replaces
  // the old separate `.event-timeline-viewport-handle` elements as real hit
  // targets (see below).
  const RESIZE_EDGE_PX = 6;

  // ---- Overview row's own drag (pan) + edge-resize (zoom) + item
  // click-to-select ---------------------------------------------------------
  // Everything here is wired on `trackEl` itself, NOT `highlightEl` or the
  // two `.event-timeline-viewport-handle` elements -- both are purely
  // visual now (`pointer-events: none`, event-timeline.css), so a plain
  // click anywhere in the overview (including where the highlight is drawn
  // on top of a Normal-type item, or right at its edge where a handle used
  // to sit) resolves `event.target` to the actual item/track element
  // underneath instead of some other element swallowing or occluding it.
  // Making the handles real, separate hit targets (an earlier version of
  // this fix) does make resizing work, but at the *default* full-extent
  // zoom the highlight spans the entire track, so both handles sit exactly
  // on the data range's own start/end pixel -- directly on top of whichever
  // item starts/ends the data range (commonly the earliest Normal item).
  // Playwright's own actionability check refuses to click an occluded
  // element at all (by design, to catch exactly this kind of real bug), so
  // *any* separate element covering that pixel keeps that item genuinely
  // unclickable for a real user's mouse too, no matter how the occluding
  // element's own event handlers forward the interaction. The only real
  // fix is to not have a separate hit-testable element there in the first
  // place -- resize is instead detected by proximity (`RESIZE_EDGE_PX`) to
  // the highlight's current edge, computed from `windowStart`/`windowEnd`
  // at pointerdown time, entirely within the one pointerdown/move/up flow
  // below. Found live via Playwright, confirmed against real mouse
  // behavior (the browser's own hit-testing, not just this component's JS).
  function wireOverviewDrag(trackEl: HTMLElement): void {
    type Mode = 'pan' | 'resize-left' | 'resize-right';

    let dragging = false;
    let mode: Mode = 'pan';
    let dragStartX = 0;
    let dragStartWindowStart = 0;
    let dragStartWindowEnd = 0;
    let pointerDownTarget: HTMLElement | null = null;

    trackEl.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }
      dragging = false;
      dragStartX = event.clientX;
      dragStartWindowStart = windowStart;
      dragStartWindowEnd = windowEnd;
      pointerDownTarget = event.target as HTMLElement;
      trackEl.setPointerCapture(event.pointerId);

      const rect = trackEl.getBoundingClientRect();
      const downX = event.clientX - rect.left;
      const leftEdgeX = timeToRatio(windowStart, dataStart.getTime(), dataEnd.getTime()) * rect.width;
      const rightEdgeX = timeToRatio(windowEnd, dataStart.getTime(), dataEnd.getTime()) * rect.width;
      if (Math.abs(downX - leftEdgeX) <= RESIZE_EDGE_PX) {
        mode = 'resize-left';
      } else if (Math.abs(downX - rightEdgeX) <= RESIZE_EDGE_PX) {
        mode = 'resize-right';
      } else {
        mode = 'pan';
      }
    });

    trackEl.addEventListener('pointermove', (event) => {
      if (pointerDownTarget === null) {
        return;
      }
      const deltaPx = event.clientX - dragStartX;
      if (!dragging && Math.abs(deltaPx) < DRAG_THRESHOLD_PX) {
        return;
      }
      dragging = true;
      const rect = trackEl.getBoundingClientRect();
      const deltaRatio = deltaPx / rect.width;
      const deltaMs = deltaRatio * fullRangeMs();
      if (mode === 'resize-left') {
        setWindow(dragStartWindowStart + deltaMs, dragStartWindowEnd);
      } else if (mode === 'resize-right') {
        setWindow(dragStartWindowStart, dragStartWindowEnd + deltaMs);
      } else {
        setWindow(dragStartWindowStart + deltaMs, dragStartWindowEnd + deltaMs);
      }
    });

    const finishPointer = (event: PointerEvent): void => {
      if (pointerDownTarget === null) {
        return;
      }
      if (!dragging) {
        handleItemOrTrackActivation(pointerDownTarget, trackEl, event.clientX, false, event.clientY);
      }
      dragging = false;
      pointerDownTarget = null;
    };
    trackEl.addEventListener('pointerup', finishPointer);
    trackEl.addEventListener('pointercancel', () => {
      dragging = false;
      pointerDownTarget = null;
    });
  }

  // ---- Item DOM + render --------------------------------------------------
  const itemsById = new Map<string, EventTimelineItem>();
  for (const item of config.items) {
    itemsById.set(item.id, item);
  }

  function buildItemEl(item: EventTimelineItem, start: number, end: number, widthPx: number): HTMLElement {
    const el = document.createElement('div');
    el.dataset.itemId = item.id;
    const durationMs = (item.end ?? item.start).getTime() - item.start.getTime();
    const isPoint = !item.end || durationMs <= 0;
    const left = timeToRatio(item.start.getTime(), start, end) * widthPx;

    if (isPoint) {
      el.className = `event-timeline-item event-timeline-item-point ${item.className}`;
      el.style.left = `${left}px`;
      el.title = `${item.label} @ ${formatTick(item.start)}`;
    } else {
      const right = timeToRatio((item.end as Date).getTime(), start, end) * widthPx;
      const barWidth = Math.max(right - left, 2);
      el.className = `event-timeline-item ${item.className}`;
      el.style.left = `${left}px`;
      el.style.width = `${barWidth}px`;
      el.title = `${item.label} ${formatDuration(durationMs)} (${formatTick(item.start)} - ${formatTick(item.end as Date)})`;
      if (barWidth >= MIN_LABELED_ITEM_WIDTH_PX) {
        const labelEl = document.createElement('span');
        labelEl.className = 'event-timeline-item-label';
        labelEl.textContent = `${item.label} ${formatDuration(durationMs)}`;
        el.append(labelEl);
      }
    }
    if (selectedItemEls.size > 0) {
      for (const selectedEl of selectedItemEls) {
        if (selectedEl.dataset.itemId === item.id) {
          el.classList.add('event-timeline-item-selected');
        }
      }
    }
    return el;
  }

  function renderRowItems(refs: RowRefs, start: number, end: number): void {
    const widthPx = refs.trackEl.clientWidth;
    refs.itemsLayerEl.replaceChildren();
    const rowItems = itemsByRow.get(refs.row.id) ?? [];
    const fragment = document.createDocumentFragment();
    for (const item of rowItems) {
      fragment.append(buildItemEl(item, start, end, widthPx));
    }
    refs.itemsLayerEl.append(fragment);
  }

  function renderOverviewHighlight(): void {
    if (overviewRefs === null || overviewHighlightEl === null) {
      return;
    }
    const widthPx = overviewRefs.trackEl.clientWidth;
    const left = timeToRatio(windowStart, dataStart.getTime(), dataEnd.getTime()) * widthPx;
    const right = timeToRatio(windowEnd, dataStart.getTime(), dataEnd.getTime()) * widthPx;
    overviewHighlightEl.style.left = `${left}px`;
    overviewHighlightEl.style.width = `${Math.max(right - left, 4)}px`;
  }

  function renderAxis(): void {
    axisTrack.replaceChildren();
    const widthPx = axisTrack.clientWidth;
    for (let i = 0; i <= AXIS_TICK_COUNT; i += 1) {
      const ratio = i / AXIS_TICK_COUNT;
      const t = ratioToTime(ratio, windowStart, windowEnd);
      const tick = document.createElement('span');
      tick.className = 'event-timeline-axis-tick';
      tick.style.left = `${ratio * widthPx}px`;
      tick.textContent = formatTick(new Date(t));
      axisTrack.append(tick);
    }
  }

  let customTimeEl: HTMLElement | null = null;
  // Overview ("ALL EVENTS") row's own copy of the marker line -- separate
  // element from `customTimeEl` because the two rows use different range
  // bases: detail rows show `windowStart`/`windowEnd` (the current zoom
  // window) while the overview row always shows the full `dataStart`/
  // `dataEnd` extent (same as `renderOverviewHighlight()`). A single `left`
  // computed from one basis and applied to both was visually wrong on
  // whichever row didn't share that basis -- most visible once zoomed in,
  // where the overview copy no longer lined up with its own items.
  // Reported directly by the user. `pointer-events: none`, purely visual,
  // like `customTimeEl` -- FR-14's draggable hit area stays detail-rows-only
  // regardless (see `customTimeHitEl` below).
  let customTimeOverviewEl: HTMLElement | null = null;
  // Separate from `customTimeEl` -- only created when `onCustomTimeSeek` is
  // provided, and appended into `rowsContainer` (the detail-rows-only
  // wrapper) rather than `rowsWrapper` (overview + detail rows), so its
  // pointer-events: auto hit area only ever spans the detail rows'
  // vertical extent, never the overview ("ALL EVENTS") row's. Without this
  // split, the single marker element spanning the full `rowsWrapper` height
  // (needed for FR-9 v2.2 -- the *visual* line must cross the overview row
  // too) would also sit, draggable, directly on top of whatever overview
  // item happens to start at the same time -- which by construction is
  // near-guaranteed to be the earliest Normal item, since `playback.ts`
  // initializes `customTime` to the earliest item's own start right after
  // every search. That silently made that item permanently unselectable
  // (`intercepts pointer events`, found live via Playwright), defeating the
  // overview click-to-select fix above for exactly the item most likely to
  // be clicked. The always-visible 2px line (`customTimeEl`) is unaffected
  // and keeps spanning the full height, pointer-events: none throughout.
  let customTimeHitEl: HTMLElement | null = null;
  // While true, renderCustomTime() leaves the marker's position alone --
  // the drag handler (wireCustomTimeDrag()) is moving it directly in
  // response to the pointer, and a render triggered by something else
  // (e.g. the ResizeObserver) mid-drag must not snap it back.
  let isDraggingCustomTime = false;

  /** FR-14: dragging the marker seeks once, on release, per
   *  docs/event-timeline-component/SRS.md's explicit "not continuously"
   *  choice -- during the drag the line follows the pointer (clamped to
   *  the current zoom window) purely visually, with no callback firing
   *  until pointerup. Only wired once, at marker-creation time, and only
   *  when `config.onCustomTimeSeek` is provided (omitting it leaves the
   *  marker exactly as before: fixed, `pointer-events: none`). `el` is
   *  `customTimeHitEl` (see above), NOT the always-visible line. */
  // rowsContainer spans BOTH the 150px row-header column and the track
  // column (it's the parent of full-width grid rows, header+track alike)
  // -- unlike each row's own `trackEl` (used for item positioning), which
  // starts right after the header. The marker/drag math below must offset
  // by ROW_HEADER_WIDTH_PX to land in the same track-relative space items
  // do; omitting this offset was a pre-existing latent bug (the marker
  // rendered shifted left by a header's width, most visible at low
  // ratios) that stayed harmless while the marker was purely a display
  // line (`pointer-events: none`) -- but the same unshifted math would
  // have positioned the new *draggable* hit area directly over the row
  // headers for any customTime near the start of the data range,
  // intercepting clicks meant for them. Found live via Playwright, not by
  // reading source.
  function wireCustomTimeDrag(el: HTMLElement): void {
    el.addEventListener('pointerdown', (downEvent) => {
      if (downEvent.button !== 0) {
        return;
      }
      downEvent.preventDefault();
      downEvent.stopPropagation();
      isDraggingCustomTime = true;
      el.setPointerCapture(downEvent.pointerId);
      // rowsContainer, not rowsWrapper -- same horizontal extent (both span
      // the full row width edge-to-edge), but using it directly keeps the
      // math anchored to el's actual positioning parent rather than relying
      // on the two happening to line up.
      const containerRect = rowsContainer.getBoundingClientRect();
      const trackLeft = containerRect.left + ROW_HEADER_WIDTH_PX;
      const trackWidth = Math.max(containerRect.width - ROW_HEADER_WIDTH_PX, 0);

      const ratioFromEvent = (moveEvent: PointerEvent): number => clamp((moveEvent.clientX - trackLeft) / trackWidth, 0, 1);

      const onMove = (moveEvent: PointerEvent): void => {
        const ratio = ratioFromEvent(moveEvent);
        const left = `${ROW_HEADER_WIDTH_PX + ratio * trackWidth}px`;
        el.style.left = left;
        if (customTimeEl !== null) {
          customTimeEl.style.left = left;
        }
      };
      const onUp = (upEvent: PointerEvent): void => {
        el.releasePointerCapture(upEvent.pointerId);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        isDraggingCustomTime = false;
        const ratio = ratioFromEvent(upEvent);
        const newTime = new Date(ratioToTime(ratio, windowStart, windowEnd));
        customTime = newTime;
        config.onCustomTimeSeek?.(newTime);
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
    });
  }

  function renderCustomTime(): void {
    if (customTime === null) {
      if (customTimeEl !== null) {
        customTimeEl.style.display = 'none';
      }
      if (customTimeHitEl !== null) {
        customTimeHitEl.style.display = 'none';
      }
      if (customTimeOverviewEl !== null) {
        customTimeOverviewEl.style.display = 'none';
      }
      return;
    }
    if (customTimeEl === null) {
      customTimeEl = document.createElement('div');
      customTimeEl.id = 'event_timeline_custom_time';
      customTimeEl.className = 'event-timeline-custom-time';
      rowsContainer.style.position = 'relative';
      rowsContainer.append(customTimeEl);
      if (config.onCustomTimeSeek) {
        customTimeHitEl = document.createElement('div');
        customTimeHitEl.id = 'event_timeline_custom_time_hit';
        customTimeHitEl.className = 'event-timeline-custom-time-hit';
        rowsContainer.append(customTimeHitEl);
        wireCustomTimeDrag(customTimeHitEl);
      }
      if (overviewRefs !== null) {
        customTimeOverviewEl = document.createElement('div');
        customTimeOverviewEl.className = 'event-timeline-custom-time';
        overviewRefs.trackEl.style.position = 'relative';
        overviewRefs.trackEl.append(customTimeOverviewEl);
      }
    }
    if (overviewRefs !== null && customTimeOverviewEl !== null) {
      const overviewWidthPx = overviewRefs.trackEl.clientWidth;
      const overviewRatio = timeToRatio(customTime.getTime(), dataStart.getTime(), dataEnd.getTime());
      const overviewVisible = overviewRatio >= 0 && overviewRatio <= 1;
      customTimeOverviewEl.style.left = `${clamp(overviewRatio, 0, 1) * overviewWidthPx}px`;
      customTimeOverviewEl.style.display = overviewVisible ? '' : 'none';
    }
    if (isDraggingCustomTime) {
      return;
    }
    const trackWidthPx = Math.max(rowsContainer.clientWidth - ROW_HEADER_WIDTH_PX, 0);
    const ratio = clamp(timeToRatio(customTime.getTime(), windowStart, windowEnd), 0, 1);
    const visible = ratio >= 0 && ratio <= 1;
    const left = `${ROW_HEADER_WIDTH_PX + ratio * trackWidthPx}px`;
    customTimeEl.style.left = left;
    customTimeEl.style.display = visible ? '' : 'none';
    if (customTimeHitEl !== null) {
      customTimeHitEl.style.left = left;
      customTimeHitEl.style.display = visible ? '' : 'none';
    }
  }

  function render(): void {
    if (overviewRefs !== null) {
      renderRowItems(overviewRefs, dataStart.getTime(), dataEnd.getTime());
      renderOverviewHighlight();
    }
    for (const refs of detailRefs) {
      renderRowItems(refs, windowStart, windowEnd);
    }
    renderAxis();
    renderCustomTime();
    const factor = fullRangeMs() / (windowEnd - windowStart);
    zoomReadout.textContent = `x${factor.toFixed(1)}`;

    for (let i = 0; i < ZOOM_PRESETS.length; i += 1) {
      const preset = ZOOM_PRESETS[i];
      const isActive = Math.abs((windowEnd - windowStart) - preset.ms) < 1000 && Math.abs(windowEnd - dataEnd.getTime()) < 1000;
      presetButtons[i].classList.toggle('event-timeline-preset-btn-active', isActive);
    }
  }

  const resizeObserver = new ResizeObserver(() => render());
  resizeObserver.observe(root);

  render();

  return {
    setCustomTime(date: Date | null): void {
      customTime = date;
      renderCustomTime();
    },
    setSelectedTime(startDate: string, startTime: string, endDate: string | null, endTime: string | null): void {
      selectedStartDate.value = startDate;
      selectedStartTime.value = startTime;
      hasEndTimeCheckbox.checked = endDate !== null && endTime !== null;
      selectedEndDate.value = endDate ?? '';
      selectedEndTime.value = endTime ?? '';
      updateEndFieldsEnabled();
    },
    setOverlappedIds(ids: string[], selectedId?: string): void {
      renderOverlappedIds(ids, selectedId);
    },
    getOverlappedId(): string | null {
      return overlappedIdSelect !== null ? overlappedIdSelect.value : null;
    },
    setRuleTypes(options: { value: string; label: string }[], selectedValue?: string): void {
      renderRuleTypes(options, selectedValue);
    },
    getRuleType(): string | null {
      return ruleTypeSelect !== null ? ruleTypeSelect.value : null;
    },
    destroy(): void {
      resizeObserver.disconnect();
      container.replaceChildren();
    },
  };
}
