// Playback -- SRS FR-7. docs/architecture.md's "Playback controls" section
// documents the legacy (pre-redesign) manual time range / 1 Day-3 Month
// toggle narrative; docs/window-ui/SRS.md FR-7.1-7.4 documents this
// module's CURRENT design (v2.0, `src/shared-v2/`-only): as of the
// Playback search redesign, both this manual flow and playbackCalendar.ts's
// Calendar flow search via the shared Event Timeline widget's own
// 1H/6H/1D/1W/1M/1Y preset buttons (anchored to "now") instead of typed
// `#start_date`/`#end_date` ranges -- see runManualTimelineSearch() below
// and docs/window-ui/DESIGN.md for the full rationale (reported directly
// by the user).

import moment from 'moment';
import { mountEventTimeline, EventTimelineItem, EventTimelineRow } from '../../component/event-timeline/event-timeline';
import { state } from './state';
import { changedebug, fastJsonStringfy, gettimezonestring } from './helpers';
import { initSunapiManager } from './device';

declare var SunapiError: any;
declare var RTSPOverWebSocketBaseError: any;
declare var RTSPOverWebSocketPlayState: any;
declare var HTTP_STATUS_CODES: any;

// ---------------------------------------------------------------------
// FR-7.1: manual-flow search, driven entirely by the Event Timeline
// widget's own preset buttons (docs/window-ui/SRS.md FR-7.1 v2.0) --
// `#start_date`/`#end_date`/"Search Overlapped Id"/"Search Date"/"1 Day"/
// "3 Month"/"Search Timeline" no longer exist; a default "1 day ending
// now" search auto-fires the first time this panel becomes visible
// (mirroring FR-7.8.3's Calendar auto-firing its first month search), and
// clicking a preset re-fires with that preset's own [now-preset, now]
// range instead.
// ---------------------------------------------------------------------

/** Whether the default "1 day ending now" search has already fired for
 *  this panel-visible session -- reset whenever the panel hides, so a
 *  fresh default search fires again the next time it's shown (matching
 *  playbackCalendar.ts's own `panelInitialized` pattern for the Calendar
 *  panel). No DOM field tracks "what range is currently queried" any more
 *  (see file header) -- a preset click always just recomputes
 *  `[now - preset, now]` fresh, it never needs to know the previous range. */
let manualPanelInitialized = false;

/** GMT-aware, matching every other search's own `moment(...).utcOffset(...)`
 *  conversion pattern (e.g. playbackCalendar.ts's equivalent) -- `date` is
 *  interpreted in LOCAL browser time (the same "wall clock" a native
 *  `<input type="date"|"time">` would show), formatted to SUNAPI's
 *  `YYYY-MM-DD HH:mm:ss` shape first. */
function formatManualSearchTime(date: Date): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const raw = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  if ((document.getElementById('use_gmt') as HTMLInputElement).checked) {
    const timezone = gettimezonestring((document.getElementById('timezone') as HTMLInputElement).value);
    return moment(raw).utcOffset(timezone).format('YYYY-MM-DD[T]HH:mm:ss[Z]');
  }
  return raw;
}

/** FR-7.1/FR-7.3 v2.0: getOverlappedIdList() then getTimeline() for
 *  `[fromDate, toDate]` -- sequenced, not concurrent, for the same reason
 *  playbackCalendar.ts's runOverlappedAndTimelineSearch() is (a real,
 *  confirmed digest-auth race in the vendored
 *  `@melchi45/rtsp-over-websocket` library's SunapiClient when two
 *  requests both need a fresh challenge at once -- see MEMORY.md). Called
 *  both for the initial default "1 day ending now" search
 *  (`updateManualPlaybackPanelVisibility()`) and for every subsequent
 *  Event Timeline preset-button click (`onManualRangePresetSelect`). */
function runManualTimelineSearch(fromDate: Date, toDate: Date): void {
  try {
    if (!state.getSelectedPlayer().sunapiClient) {
      initSunapiManager();
    }

    const fromStr = formatManualSearchTime(fromDate);
    const toStr = formatManualSearchTime(toDate);
    const channel = Number(state.getSelectedPlayer().channel) - 1;

    // `state.deviceInformation.attributes` is populated deep inside
    // initSunapiManager()'s own async chain (device.ts) -- the call above
    // is fire-and-forget (no Promise to await), so on this function's
    // very first, auto-fired invocation (FR-7.1 v2.0's default search,
    // called synchronously right after that self-init) attributes may not
    // exist yet at all. Optional chaining treats "not loaded yet" the same
    // as "not the single-channel special case" (falls through to the
    // `else` branch below, passing `channel` explicitly) rather than
    // throwing -- the original `search_overlapped_id()` never hit this
    // race in practice, since a user only ever clicked it well after
    // SUNAPI had already finished initializing via the checkbox flow.
    let overlappedIDList: Promise<any>;
    if (state.getSelectedPlayer().device === 'camera' && Number(state.deviceInformation.attributes?.MaxChannel) === 1) {
      overlappedIDList = state.getSunapiManager().getOverlappedIdList(fromStr, toStr);
    } else {
      overlappedIDList = state.getSunapiManager().getOverlappedIdList(fromStr, toStr, channel);
    }

    // FR-15: the select itself now lives inside the Event Timeline widget's
    // own toolbar (event-timeline.ts), not a standalone #overlapped_id_area
    // -- this fetch's result is threaded through to updateTimeline() below
    // instead of being DOM-built here directly. `overlappedId` (the value
    // used for the getTimeline() query right below, same as before) is
    // ids[ids.length - 1] -- the pre-move select box's own native default,
    // since its options were appended highest-index-first.
    let overlappedIds: string[] = [];
    let overlappedId: string | undefined;

    overlappedIDList
      .then((overlapped_id_list: any) => {
        if (typeof overlapped_id_list.OverlappedIDList !== 'undefined' && overlapped_id_list.OverlappedIDList.length > 0) {
          overlappedIds = overlapped_id_list.OverlappedIDList;
          overlappedId = overlappedIds[overlappedIds.length - 1];
          state.getSelectedPlayer().overlappedId = overlappedId;
        }
      })
      .catch((error: any) => {
        if (error instanceof SunapiError) {
          (window as any).popup('<div><h4>getOverlappedIdList error: ' + error.errorCode + '<br>message: ' + error.message + '<br>URI: ' + error.uri + '</h4></div>');
        } else if (error instanceof RTSPOverWebSocketBaseError) {
          (window as any).popup('<div><h4>getOverlappedIdList error: ' + error.errorCode + '<br>message: ' + error.message + '</h4></div>');
        }
      })
      .finally(() => {
        const requestPromise = overlappedId !== undefined
          ? state.getSunapiManager().getTimeline(fromStr, toStr, channel, overlappedId)
          : state.getSunapiManager().getTimeline(fromStr, toStr, channel);

        requestPromise
          .then((timeline: any) => {
            if (typeof timeline !== 'undefined') {
              updateTimeline(timeline.TimeLineSearchResults, onManualRangePresetSelect, { start: fromDate, end: toDate }, overlappedIds, overlappedId);
              (document.getElementById('timeline') as HTMLElement).style.display = 'block';
            } else {
              throw new Error((timeline as any).Error.Details);
            }
          })
          .catch((error: any) => {
            if (typeof error === 'number') {
              console.error('Http Error: ' + HTTP_STATUS_CODES[error]);
            } else {
              console.error('getTimeline error: ', fastJsonStringfy(error));
            }
          });
      });
  } catch (error) {
    console.error(error);
  }
}

function onManualRangePresetSelect(fromDate: Date, toDate: Date): void {
  runManualTimelineSearch(fromDate, toDate);
}

/** Called from playbackCalendar.ts's updatePlaybackSunapiUIVisibility()
 *  whenever this manual panel's own visibility is decided (mirrors that
 *  file's own `panelInitialized`/`initPlaybackCalendarPanel()` pattern for
 *  the Calendar panel) -- fires the default "1 day ending now" search the
 *  first time the panel becomes visible, and resets so a fresh default
 *  fires again the next time (device/channel may have changed meanwhile). */
export function updateManualPlaybackPanelVisibility(isVisible: boolean): void {
  if (isVisible) {
    // Guard against firing before any device has actually been selected --
    // Play Type can be switched to Playback with no row picked yet in
    // #datatable (a perfectly normal page state, e.g. a user exploring the
    // radio buttons first), in which case `hostname` is still empty and
    // initSunapiManager()/getOverlappedIdList() would run against a blank
    // device, surfacing real connection-error popups for no reason.
    const player = state.getSelectedPlayer();
    if (!manualPanelInitialized && player !== null && player.hostname) {
      manualPanelInitialized = true;
      const toDate = new Date();
      const fromDate = new Date(toDate.getTime() - 24 * 3600_000);
      runManualTimelineSearch(fromDate, toDate);
    }
  } else {
    manualPanelInitialized = false;
  }
}

/** FR-7.2/FR-7.8.4: extracts the day-of-month numbers (1-31) that have
 *  recordings from one `CalenderSearchResults[dateKey]` entry's per-day
 *  bitmask -- factored out of search_date() above so playbackCalendar.ts's
 *  month search (docs/window-ui/SRS.md FR-7.8.4) uses the exact same
 *  parsing logic rather than a second, potentially-drifting copy of it.
 *  `dateKey` defaults to the object's own single key when the response has
 *  exactly one (the normal case for a one-month `calendarsearch` query). */
export function parseRecordedDaysFromCalendarSearch(calendar: any, dateKey?: string): number[] {
  const key = dateKey ?? Object.keys(calendar.CalenderSearchResults ?? {})[0];
  if (key === undefined) {
    return [];
  }
  const recordedDates: number[] = [];
  const record_dates: any[] = Array.from(calendar.CalenderSearchResults[key].Result);
  for (let i = 0; i < record_dates.length; i++) {
    if (parseInt(record_dates[i]) === 1) {
      recordedDates.push(i + 1);
    }
  }
  return recordedDates;
}

// ---------------------------------------------------------------------
// FR-7.5
// ---------------------------------------------------------------------
export function changespeed(): void {
  try {
    state.getSelectedPlayer().playSpeed = (document.getElementById('speed') as HTMLSelectElement).value;
  } catch (error) {
    console.error(error);
  }
}

// ---------------------------------------------------------------------
// One "All" row (no more separate Normal/Event rows -- see MEMORY.md for
// why this was the original merge), rendered by src/component/event-timeline/'s
// custom widget (not vis.Timeline -- see docs/window-ui/SRS.md FR-7.6
// v1.16/docs/event-timeline-component/ for why this replaced it). As of a
// later change, Normal additionally gets its own detail row below "All",
// same as every distinct Rule# already did (updateTimeline() below) --
// requested directly by the user; not a reversal of the original All-row
// merge, "All" still exists and still combines everything. Each item's
// color is assigned dynamically by distinct `Type` string (see
// assignEventColorClass() below) rather than a fixed enum of known
// detection-type names -- a real device's Timeline items are labeled by
// which Rule triggered them (e.g. "Rule1"), not a generic category, so a
// fixed switch on known names left every real event bucketed into the
// same "unknown" color.
// `evt-`-prefixed so these can never collide with an unrelated global CSS
// class of the same bare name -- `src/shared/css/table.css`'s own `.normal`
// (`height: 40px; border: 1px solid red;`, meant for something else
// entirely in the discovery table) is reused as-is by src/shared-v2/'s
// window.html and was silently bleeding into the Normal row's label/items
// here, inflating that one row's height far past every other row's.
// Reported directly by the user as the Normal row's height visibly
// differing from every other row. Matches the `--evt-<class>-border/-bg`
// custom-property naming already used by event-timeline.css.
const EVENT_COLOR_CLASSES = [
  'evt-motiondetection', 'evt-audiodetection', 'evt-facedetection', 'evt-audioanalysis',
  'evt-videoanalysis', 'evt-defocusdetection', 'evt-ai', 'evt-unknown',
];

/** The same `type` string always gets the same color class, keyed off the
 *  Rule number embedded in the type itself (e.g. `"Rule3"` -> index 2 ->
 *  EVENT_COLOR_CLASSES[2]) rather than "whichever distinct type happened
 *  to be seen first in this render" -- the same physical Rule now keeps
 *  the same color across separate searches/renders instead of shifting
 *  depending on event ordering. Falls back to first-seen-order cycling
 *  only for a type string with no trailing number. `"normal"` always gets
 *  its own fixed green ('normal' class), never counted against the
 *  cycling palette. */
/** Resolves a Timeline result's raw "Rule<N>" Type string (1-based, e.g.
 *  "Rule3") to its configured RuleName (e.g. "MD 1") from
 *  state.dynamicRuleEntries -- the same getDynamicRules() entries
 *  playbackCalendar.ts's populateRuleSelect() uses for the Rule dropdown,
 *  with the same `Rule<N>` = entry's 0-based `Rule` field + 1 offset (see
 *  the comment there / MEMORY.md). Also requires the candidate entry's
 *  EventSources to include `channel` (the same 0-based value sent as the
 *  Timeline request's own `ChannelIDList` -- see playbackCalendar.ts's
 *  `channel` computation) -- getDynamicRules() returns every configured
 *  rule device-wide, not scoped to one channel, and `Rule` numbering is
 *  not guaranteed unique across channels, so matching on `Rule` alone
 *  could resolve to a different channel's same-numbered rule. Falls back
 *  to the raw type string when no matching/named rule for this channel is
 *  cached (e.g. the calendar panel hasn't been opened yet this session, or
 *  SUNAPI is Off). "Normal" is not rule-triggered data and is returned
 *  unchanged, never looked up. */
function resolveEventLabel(type: string, channel: number): string {
  const key = (type ?? '').toLowerCase();
  if (key === '' || key === 'normal') {
    return type;
  }
  const ruleNumber = parseInt(key.match(/^rule(\d+)$/)?.[1] ?? '', 10);
  if (Number.isNaN(ruleNumber)) {
    return type;
  }
  const entry = state.dynamicRuleEntries.find((candidate: any) => {
    return Number(candidate?.Rule) === ruleNumber - 1
      && (candidate.EventSources ?? []).some((source: any) => Number(source.Channel) === channel);
  });
  return typeof entry?.RuleName === 'string' && entry.RuleName !== '' ? entry.RuleName : type;
}

/** Whether a Timeline result's raw Type belongs to the currently-selected
 *  channel, per state.dynamicRuleEntries -- the same cache/offset
 *  resolveEventLabel() uses. A real device's Timeline endpoint has been
 *  observed returning `Results[]` rows for a Rule configured on a
 *  *different* channel than the one actually requested via `ChannelIDList`
 *  (reported directly by the user, e.g. Channel 2's Rule5/Rule6/Rule8/
 *  Rule9 showing up while Channel 1 was selected/queried) -- this filters
 *  those out client-side before they ever reach updateTimeline()'s
 *  rows/items, rather than just resolving to a mislabeled/unlabeled entry
 *  the way resolveEventLabel() alone would. "Normal" (not rule-triggered)
 *  always belongs to whichever channel was actually queried, so it's never
 *  filtered. A `Rule<N>` with no matching entry in state.dynamicRuleEntries
 *  at all (not even for a different channel -- e.g. rules not loaded yet
 *  this session) is also kept, not filtered: there's nothing to compare
 *  against, so filtering here could only ever hide data incorrectly,
 *  never correctly.
 *
 *  Checks EVERY entry sharing this Rule number, not just the first one
 *  found -- `getDynamicRules()` can list the same numeric Rule configured
 *  separately per channel (the exact cross-channel-leak report above only
 *  makes sense if it does), so a single `.find()` keyed on Rule number
 *  alone can land on a different channel's entry than the one actually
 *  queried and wrongly reject a legitimate same-channel event whose own
 *  entry sits elsewhere in the array. Reported directly by the user as a
 *  real device's timeline looking suspiciously sparse compared to the raw
 *  recording.cgi response -- resolveEventLabel() already avoided this by
 *  matching Rule number AND channel together in one predicate; this now
 *  does the same. */
function eventAppliesToChannel(type: string, channel: number): boolean {
  const key = (type ?? '').toLowerCase();
  if (key === '' || key === 'normal') {
    return true;
  }
  const ruleNumber = parseInt(key.match(/^rule(\d+)$/)?.[1] ?? '', 10);
  if (Number.isNaN(ruleNumber)) {
    return true;
  }
  const matchingEntries = state.dynamicRuleEntries.filter((candidate: any) => Number(candidate?.Rule) === ruleNumber - 1);
  if (matchingEntries.length === 0) {
    return true;
  }
  return matchingEntries.some((entry: any) => (entry.EventSources ?? []).some((source: any) => Number(source.Channel) === channel));
}

/** Collapses runs of overlapping/touching same-`Type` Timeline rows into a
 *  single [earliest StartTime, latest EndTime] row. A real device's Timeline
 *  response has been observed returning several "Normal" rows for what is
 *  really the same still-recording segment -- identical StartTime, each
 *  subsequent row's EndTime a little further along than the last (Result
 *  15..20 in the same poll, EndTime growing 00s/03s/07s/11s/15s/18s off the
 *  same 00s start) -- apparently the device re-indexes the still-open
 *  recording file on every poll rather than emitting one row once it
 *  closes. Rendered literally (one EventTimelineItem per raw row), these
 *  draw as several same-colored bars stacked directly on top of each other
 *  at the same left edge, reported directly by the user with a live
 *  example. Sorting by StartTime and merging any row whose StartTime falls
 *  strictly before the current run's EndTime -- keyed per `Type` so distinct
 *  event kinds never merge into each other -- fixes this while leaving
 *  genuinely separate (non-overlapping, or merely back-to-back with zero
 *  gap) occurrences of the same Type as distinct items, exactly as before
 *  (tools/mock-sunapi-server/'s fixture data can legitimately produce a
 *  zero-gap boundary between two consecutive same-Type segments -- that's
 *  adjacency, not the duplicate-snapshot overlap this exists to collapse,
 *  so it must NOT merge; see tests/window-ui-equivalence/'s TC-18 exact
 *  item-count parity check). */
function mergeOverlappingSameTypeResults(elements: any[]): any[] {
  const byType = new Map<string, any[]>();
  for (const element of elements) {
    const key = element.Type ?? '';
    const list = byType.get(key);
    if (list) {
      list.push(element);
    } else {
      byType.set(key, [element]);
    }
  }

  const merged: any[] = [];
  for (const list of byType.values()) {
    list.sort((a, b) => new Date(a.StartTime).getTime() - new Date(b.StartTime).getTime());
    let current: any | null = null;
    for (const element of list) {
      if (current === null) {
        current = { ...element };
        continue;
      }
      const elementStart = new Date(element.StartTime).getTime();
      const currentEnd = new Date(current.EndTime).getTime();
      if (elementStart < currentEnd) {
        if (new Date(element.EndTime).getTime() > currentEnd) {
          current.EndTime = element.EndTime;
          current.Result = element.Result;
        }
      } else {
        merged.push(current);
        current = { ...element };
      }
    }
    if (current !== null) {
      merged.push(current);
    }
  }
  return merged;
}

function assignEventColorClass(colorAssignments: Map<string, string>, type: string): string {
  const key = (type ?? '').toLowerCase();
  if (key === 'normal') {
    return 'evt-normal';
  }
  let colorClass = colorAssignments.get(key);
  if (typeof colorClass === 'undefined') {
    const ruleNumber = parseInt(key.match(/(\d+)\s*$/)?.[1] ?? '', 10);
    const index = Number.isNaN(ruleNumber) ? colorAssignments.size : ruleNumber - 1;
    const wrapped = ((index % EVENT_COLOR_CLASSES.length) + EVENT_COLOR_CLASSES.length) % EVENT_COLOR_CLASSES.length;
    colorClass = EVENT_COLOR_CLASSES[wrapped];
    colorAssignments.set(key, colorClass);
  }
  return colorClass;
}

/** The widget's own "Selected Time" (docs/event-timeline-component/SRS.md
 *  FR-11) is wiped back to its "now, no end" default on every remount
 *  (the component has no memory across its own destroy()/mount cycle --
 *  see event-timeline.ts's file header) -- persisted here instead, and
 *  re-applied to each freshly-mounted instance below, so a user's chosen
 *  playback point survives every subsequent timeline refresh (Rule
 *  change, range-preset click, ...) until they pick a new one or
 *  playbackCalendar.ts's resetPlaybackSearchStateForChannelChange() clears
 *  it via clearSelectedTime() on channel change. `null` means "nothing
 *  selected yet this session" (leave the freshly-mounted default as-is). */
let lastSelectedTime: { startDate: string; startTime: string; endDate: string | null; endTime: string | null } | null = null;

/** FR-7.8.6/device.ts's changechannel(): the previous channel's Selected
 *  Time (and the player's startTime/endTime it drove) is meaningless for
 *  the new channel. Resets the persisted state above and, if a timeline is
 *  currently mounted, its displayed Selected Time back to the same "now,
 *  no end" default a fresh mount starts with. */
export function clearSelectedTime(): void {
  lastSelectedTime = null;
  state.getSelectedPlayer().startTime = null;
  state.getSelectedPlayer().endTime = null;
  if (state.eventTimeline !== null) {
    const now = new Date();
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const startDate = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    const startTime = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
    state.eventTimeline.setSelectedTime(startDate, startTime, null, null);
  }
}

// FR-7.6: the event-timeline render. `onRangePresetSelect` is supplied by
// whichever flow (this module's own runManualTimelineSearch(), or
// playbackCalendar.ts's Calendar equivalent) actually issued this search --
// kept as a parameter rather than importing playbackCalendar.ts here, so
// the existing one-directional import (playbackCalendar.ts -> playback.ts)
// stays one-directional.
// ---------------------------------------------------------------------
export function updateTimeline(
  results: any,
  onRangePresetSelect?: (fromDate: Date, toDate: Date, label: string) => void,
  // The actual [fromDate, toDate] this search covered -- threaded through
  // to the widget's own `dataRange` (event-timeline.ts's FR-2), so a 1H/
  // 6H/1D/1W/1M/1Y preset (or the initial default search) always shows its
  // full requested period, even one with few or zero events in it, instead
  // of collapsing to just wherever the actual data happens to fall.
  // Requested directly by the user.
  dataRange?: { start: Date; end: Date },
  // FR-15: the same search's already-fetched Overlapped Id list, threaded
  // through to the widget's own toolbar control (event-timeline.ts's
  // `overlappedIds` mount option) -- both runManualTimelineSearch() and
  // playbackCalendar.ts's runOverlappedAndTimelineSearch() fetch this
  // BEFORE calling getTimeline()/updateTimeline(), since it's also a query
  // param of that same getTimeline() call.
  overlappedIds?: string[],
  // FR-15: which of overlappedIds the just-completed getTimeline() call
  // actually used -- only needed by playbackCalendar.ts's Rule-change path
  // (runCalendarTimelineSearch(), no fresh Overlapped Id fetch), so the
  // widget's redrawn select keeps showing that value instead of silently
  // snapping back to overlappedIds' own default (event-timeline.ts's
  // `selectedOverlappedId`).
  selectedOverlappedId?: string,
  // FR-16: the Calendar/SUNAPI flow's Rule options, threaded through to the
  // widget's own toolbar control (event-timeline.ts's `ruleTypes` mount
  // option) -- same move/reasoning as overlappedIds above. The manual flow
  // (runManualTimelineSearch()) never passes these, so its own
  // updateTimeline() calls render no Rule control (Calendar/SUNAPI-only).
  ruleTypes?: { value: string; label: string }[],
  // Which of ruleTypes is currently selected -- mirrors selectedOverlappedId,
  // so a Rule-change remount keeps showing the value just queried with.
  selectedRuleType?: string,
  // Fires when the user changes the Rule select inside the remounted
  // widget -- playbackCalendar.ts wires this back into its own re-search.
  onRuleTypeChange?: (value: string) => void,
): void {
  // Only the outer envelope being empty (no `results[0]` at all) is a real
  // error worth the popup below -- `results[0].Results` being an empty
  // array is a normal, expected "no events in this period" outcome for a
  // valid search (a 1H preset with no motion in the last hour, say), not a
  // failure, and should still mount an empty timeline covering the full
  // requested range rather than silently doing nothing.
  if (results.length > 0) {
    if (state.eventTimeline !== null) {
      state.eventTimeline.destroy();
      state.eventTimeline = null;
    }

    // Same 0-based channel numbering already sent as this search's own
    // `ChannelIDList` (see playback.ts's/playbackCalendar.ts's `channel`
    // computation) -- resolveEventLabel()/eventAppliesToChannel() need it
    // to disambiguate same-numbered Rules configured on different
    // channels.
    const channel = Number(state.getSelectedPlayer().channel) - 1;

    // A real device's Timeline response has been observed including
    // Results[] rows for Rules configured on a DIFFERENT channel than the
    // one actually queried via ChannelIDList -- filtered out here, before
    // anything below ever sees them, rather than left to render mislabeled
    // (see eventAppliesToChannel()'s own doc comment). Reported directly
    // by the user.
    const channelResults = mergeOverlappingSameTypeResults(
      (results[0].Results ?? []).filter((timeline_element: any) => eventAppliesToChannel(timeline_element.Type, channel)),
    );

    // "All" stays one combined line -- Normal + every Rule# event together,
    // colored per rule type. Each distinct Rule# additionally gets its own
    // row below "All" (sorted by its trailing rule number) so a channel
    // with several configured rules can still be told apart without
    // hunting through the merged row -- see docs/window-ui/SRS.md FR-7.6
    // v1.16 / docs/event-timeline-component/.
    const ruleGroupIds: string[] = [];
    const seenRuleGroups = new Set<string>();
    channelResults.forEach((timeline_element: any) => {
      const type = timeline_element.Type;
      const key = (type ?? '').toLowerCase();
      if (key !== '' && key !== 'normal' && !seenRuleGroups.has(key)) {
        seenRuleGroups.add(key);
        ruleGroupIds.push(type);
      }
    });
    ruleGroupIds.sort((a, b) => {
      const numA = parseInt(String(a).match(/(\d+)\s*$/)?.[1] ?? '', 10);
      const numB = parseInt(String(b).match(/(\d+)\s*$/)?.[1] ?? '', 10);
      if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
        return numA - numB;
      }
      return String(a).localeCompare(String(b));
    });

    // Normal (not rule-triggered) additionally gets its own detail row,
    // same as every distinct Rule# does above -- only added when at least
    // one Normal-classed item is actually present in this channel's
    // results, matching how a Rule# row only appears for rules that
    // actually occur. Requested directly by the user.
    const hasNormal = channelResults.some((timeline_element: any) => ((timeline_element.Type ?? '').toLowerCase()) === 'normal');

    const colorAssignments = new Map<string, string>();
    const rows: EventTimelineRow[] = [
      { id: 'All', label: 'ALL EVENTS', overview: true },
      ...(hasNormal ? [{ id: 'Normal', label: 'Normal', colorClass: 'evt-normal' }] : []),
      ...ruleGroupIds.map((type) => ({ id: type, label: resolveEventLabel(type, channel), colorClass: assignEventColorClass(colorAssignments, type) })),
    ];

    const items: EventTimelineItem[] = [];
    channelResults.forEach((timeline_element: any) => {
      try {
        const start = new Date(timeline_element.StartTime);
        const end = new Date(timeline_element.EndTime);
        const colorClass = assignEventColorClass(colorAssignments, timeline_element.Type);
        const item: EventTimelineItem = {
          id: String(timeline_element.Result),
          rowId: 'All',
          start,
          end,
          label: resolveEventLabel(timeline_element.Type, channel),
          className: colorClass,
          raw: timeline_element,
        };
        items.push(item);

        // Every event additionally gets a second copy of the same item in
        // its own row -- 'Normal' for Normal-classed items, its own Rule#
        // for everything else -- a distinct `id` since item ids must be
        // unique, but otherwise identical, so clicking either copy drives
        // the same onSelect behavior below.
        const groupRowId = colorClass === 'evt-normal' ? 'Normal' : timeline_element.Type;
        items.push({ ...item, id: item.id + '__group', rowId: groupRowId });
      } catch (error) {
        console.error(error);
      }
    });

    function formatTick(date: Date): string {
      if (!(document.getElementById('use_gmt') as HTMLInputElement).checked) {
        const timezone = gettimezonestring((document.getElementById('timezone') as HTMLInputElement).value);
        return moment(date).utcOffset(timezone).format('MM-DD HH:mm:ss');
      }
      return moment(date).utcOffset(state.localGmtOffset).format('MM-DD HH:mm:ss');
    }

    state.eventTimeline = mountEventTimeline({
      containerId: 'timeline',
      rows,
      items,
      dataRange,
      overlappedIds,
      selectedOverlappedId,
      ruleTypes,
      selectedRuleType,
      onRuleTypeChange,
      formatTick,
      onSelect: (item) => {
        if (state.getSelectedPlayer().readyState === RTSPOverWebSocketPlayState.PLAYING) {
          return;
        }
        try {
          // DEVIATION from legacy behavior (see docs/window-ui/DESIGN.md):
          // every selected item sets both Start and End Time, Normal-
          // classed items included. recording.cgi's Timeline response
          // always carries a real EndTime for every Result row regardless
          // of Type (Normal or Rule#) -- the legacy `src/shared/window.ts`
          // nonetheless special-cased 'normal' to null out endTime, with no
          // documented rationale (see MEMORY.md); reported by the user as
          // unwanted, so not reproduced here.
          const player = state.getSelectedPlayer();
          if (player.device === 'camera') {
            player.startTime = moment(item.start).utcOffset(state.localGmtOffset).format('YYYY-MM-DD[T]HH:mm:ss') + 'Z';
          } else {
            player.startTime = item.start.toISOString();
          }
          const startDate = player.startTime.split('T')[0];
          const startTime = player.startTime.split('T')[1].replace(/Z/gi, '');

          let endDate: string | null = null;
          let endTime: string | null = null;
          if (item.end) {
            if (player.device === 'camera') {
              player.endTime = moment(item.end).utcOffset(state.localGmtOffset).format('YYYY-MM-DD[T]HH:mm:ss') + 'Z';
            } else {
              player.endTime = item.end.toISOString();
            }
            endDate = player.endTime.split('T')[0];
            endTime = player.endTime.split('T')[1].replace(/Z/gi, '');
          } else {
            player.endTime = null;
          }

          lastSelectedTime = { startDate, startTime, endDate, endTime };
          state.eventTimeline?.setSelectedTime(startDate, startTime, endDate, endTime);
        } catch (error) {
          // Was previously unguarded in the original; a real "start time is
          // empty" (0x0411) report traced back to an unhandled exception
          // here. Guarded there already -- kept guarded here too (not a
          // deviation, this fix is already part of the behavior being
          // matched).
          console.error('timeline select error:', error);
        }
      },
      onDoubleClick: (time) => {
        if (state.getSelectedPlayer().readyState === RTSPOverWebSocketPlayState.PLAYING) {
          if (!(document.getElementById('use_gmt') as HTMLInputElement).checked) {
            if (state.getSelectedPlayer().device === 'camera') {
              state.getSelectedPlayer().seekingTime = moment(time).utcOffset(state.localGmtOffset).format('YYYY-MM-DD[T]HH:mm:ss') + 'Z';
            }
          } else {
            state.getSelectedPlayer().seekingTime = time.toISOString();
          }
        }
      },
      // FR-14 (docs/event-timeline-component/SRS.md): dragging the
      // current-time marker seeks exactly like onDoubleClick above (same
      // GMT-aware branching, same readyState guard) -- the difference is
      // this ALSO updates the shared #timestamp_date/#timestamp_time
      // readout (Video Control panel, `updateTimestampReadout()` above,
      // same fields 'live' mode uses) immediately, rather than waiting for
      // the player's own next `timestamp` event to report the new
      // position. Reported directly by the user: Current Time/its display
      // stays exactly where it already was (Video Control); only the
      // timeline's own line becomes interactive.
      onCustomTimeSeek: (time) => {
        try {
          const player = state.getSelectedPlayer();
          if (player.readyState !== RTSPOverWebSocketPlayState.PLAYING) {
            return;
          }
          let seekingTime: string | null = null;
          if (!(document.getElementById('use_gmt') as HTMLInputElement).checked) {
            if (player.device === 'camera') {
              seekingTime = moment(time).utcOffset(state.localGmtOffset).format('YYYY-MM-DD[T]HH:mm:ss') + 'Z';
            }
          } else {
            seekingTime = time.toISOString();
          }
          if (seekingTime === null) {
            return;
          }
          // Reported directly by the user: dragging the marker backward
          // (to an earlier point) and resuming played the stream in
          // reverse instead of forward from the new position. The most
          // likely cause is a stale negative value left over in the Speed
          // dropdown/`playSpeed` from earlier reverse-playback testing
          // (`#speed` has "-0.25x".."-256x" options) persisting across an
          // unrelated seek -- forcing normal forward speed on every
          // drag-seek keeps this interaction predictable regardless of
          // whatever speed was last selected. Scoped to this drag-seek
          // path only (not onDoubleClick above) since that's what was
          // reported; not verified against real hardware.
          (document.getElementById('speed') as HTMLSelectElement).value = '1';
          player.playSpeed = '1';
          player.seekingTime = seekingTime;
          updateTimestampReadout(seekingTime.split('T')[0], seekingTime.split('T')[1].replace(/Z/gi, ''));
        } catch (error) {
          console.error('custom time seek error:', error);
        }
      },
      onSelectedTimeChange: (startDate, startTime, endDate, endTime) => {
        // Fires only on a user-driven edit of the Selected Time inputs
        // (typing a new value, or toggling "Has End Time") -- never for
        // the setSelectedTime() calls this function makes itself (see
        // event-timeline.ts's own doc comment on why that's safe).
        try {
          const player = state.getSelectedPlayer();
          player.startTime = startDate + 'T' + startTime + 'Z';
          player.endTime = endDate !== null && endTime !== null ? endDate + 'T' + endTime + 'Z' : null;
          lastSelectedTime = { startDate, startTime, endDate, endTime };
        } catch (error) {
          console.error('selected time change error:', error);
        }
      },
      onRangePresetSelect,
    });

    // Persist the previous Selected Time (if any) across this remount --
    // see lastSelectedTime's own doc comment above.
    if (lastSelectedTime !== null) {
      state.eventTimeline.setSelectedTime(lastSelectedTime.startDate, lastSelectedTime.startTime, lastSelectedTime.endDate, lastSelectedTime.endTime);
    }

    if (items.length > 0) {
      const itemMin = Math.min(...items.map((item) => item.start.getTime()));
      state.eventTimeline.setCustomTime(new Date(itemMin));
    }
  } else {
    (window as any).popup('Result is empty' + fastJsonStringfy(results));
  }
}

/** Shared by `ontimestamp()`'s 'live' AND 'playback' cases (unified per the
 *  user's explicit request -- previously 'playback' wrote to a separate,
 *  static `#seeking_date`/`#seeking_time` pair; now both modes share this
 *  one dynamically-created readout in the Video Control panel's
 *  `#live_control`, created on first use exactly like the original
 *  'live'-only behavior did). */
function updateTimestampReadout(dateStr: string, timeStr: string): void {
  if (document.getElementById('timestamp_date') === null) {
    const dateInput = document.createElement('input');
    dateInput.id = 'timestamp_date';
    dateInput.type = 'date';
    // Same reasoning as #timestamp_time below: legacy's 100px was too
    // narrow to render the full "2026-09-01" (10 chars) in a disabled
    // native date input -- the last digit got clipped, visually leaving a
    // trailing "-" as the last thing shown. Reported directly by the user.
    dateInput.setAttribute('style', 'min-width: 140px;width: 140px !important;');
    document.getElementById('live_control')!.append(dateInput);

    const timeInput = document.createElement('input');
    timeInput.id = 'timestamp_time';
    timeInput.type = 'time';
    timeInput.step = '0.001';
    timeInput.min = '00:00:00.000';
    timeInput.max = '23:59:59.999';
    // Legacy's own "min-width: 130px;width: 100px !important;" was
    // self-contradictory and too narrow to render the full
    // "00:00:00.000" (step=0.001 adds a milliseconds field the native
    // time picker needs real room for) -- widened per the user's explicit
    // request, a deliberate deviation from legacy's sizing (not a port).
    timeInput.setAttribute('style', 'min-width: 160px;width: 160px !important;');
    document.getElementById('live_control')!.append(timeInput);

    (document.getElementById('timestamp_date') as HTMLInputElement).disabled = true;
    (document.getElementById('timestamp_time') as HTMLInputElement).disabled = true;
  }

  (document.getElementById('timestamp_date') as HTMLInputElement).value = dateStr;
  (document.getElementById('timestamp_time') as HTMLInputElement).value = timeStr;
}

/** FR-7.7. */
export function ontimestamp(timestamp: any): void {
  const elementPlayer = state.getSelectedPlayer();
  try {
    switch (timestamp.detail.mode) {
      case 'live': {
        if (timestamp.detail.local !== undefined && timestamp.detail.local !== null) {
          updateTimestampReadout(
            new Date(timestamp.detail.local).toISOString().split('T')[0],
            new Date(timestamp.detail.local).toISOString().split('T')[1].replace(/Z/gi, ''),
          );
        } else {
          updateTimestampReadout(
            new Date(timestamp.detail.timestamp).toISOString().split('T')[0],
            new Date(timestamp.detail.timestamp).toISOString().split('T')[1].replace(/Z/gi, ''),
          );
        }
        break;
      }
      case 'playback': {
        if (timestamp.detail.local !== undefined && timestamp.detail.local !== null) {
          updateTimestampReadout(
            new Date(timestamp.detail.local).toISOString().split('T')[0],
            new Date(timestamp.detail.local).toISOString().split('T')[1].replace(/Z/gi, ''),
          );
        } else {
          updateTimestampReadout(
            new Date(timestamp.detail.timestamp).toISOString().split('T')[0],
            new Date(timestamp.detail.timestamp).toISOString().split('T')[1].replace(/Z/gi, ''),
          );
        }

        let currentTimeBar: moment.Moment;
        if ((document.getElementById('use_gmt') as HTMLInputElement).checked) {
          let temp = '';
          temp += timestamp.detail.timezone > 0 ? '+' : '';
          temp += String(timestamp.detail.timezone / 60).padStart(2, '0') + ':00';
          currentTimeBar = moment(timestamp.detail.timestamp).utcOffset(temp);
        } else {
          if (elementPlayer.device === 'camera') {
            currentTimeBar = moment(timestamp.detail.local).utc();
          } else {
            currentTimeBar = moment(timestamp.detail.timestamp).utc();
          }
        }

        // FR-14: the marker only reflects an actually-playing position --
        // when paused/stopped, ontimestamp() stops firing new frames
        // entirely, which would otherwise leave a stale line frozen at the
        // last position forever; onstatechange() (videoControl.ts) is what
        // actually clears it on PAUSED/STOPPED, this guard just keeps a
        // late-arriving in-flight timestamp from re-drawing it in between.
        if (state.eventTimeline !== null) {
          if (elementPlayer.readyState === RTSPOverWebSocketPlayState.PLAYING) {
            state.eventTimeline.setCustomTime(currentTimeBar.toDate());
          } else {
            state.eventTimeline.setCustomTime(null);
          }
        }
        break;
      }
    }
  } catch (error) {
    console.error(error);
  }
}

export function setupPlayback(): void {
  // FR-15's original startup block (window.ts ~L380-414) used to default
  // #seeking_date to today's date here. #seeking_date/#seeking_time no
  // longer exist as static markup -- unified into #timestamp_date/
  // #timestamp_time (updateTimestampReadout() above), which -- like 'live'
  // mode already did -- is created on demand by the first `timestamp`
  // event rather than needing a startup default. #start_date/#end_date
  // also no longer exist as of the v2.0 Playback search redesign
  // (docs/window-ui/SRS.md FR-7.1-7.4) -- Selected Time
  // (src/component/event-timeline/) defaults to "now" itself, on mount.
  // #search_aitimeline/#search_three_month_aitimeline are known dead
  // controls (SRS "Known dead controls") -- stay disabled/unwired forever,
  // same as the original; unaffected by the search redesign.
  (document.getElementById('search_aitimeline') as HTMLButtonElement).disabled = true;

  document.getElementById('speed')!.addEventListener('change', changespeed);
  (document.getElementById('speed') as HTMLSelectElement).disabled = true;

  (document.getElementById('forward') as HTMLButtonElement).disabled = true;
  (document.getElementById('backward') as HTMLButtonElement).disabled = true;
}
