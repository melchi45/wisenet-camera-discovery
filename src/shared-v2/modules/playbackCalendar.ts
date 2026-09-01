// SUNAPI-driven Calendar search for Playback -- SRS FR-7.8, src/shared-v2/
// only (no src/shared/ equivalent). See docs/window-ui/SRS.md's FR-7.8 for
// the full functional spec and docs/window-ui/DESIGN.md's own FR-7.8
// section for the design reasoning (two-panel switch, Rule-dropdown merge,
// static Language list) -- not re-explained here.
//
// Deliberately does NOT grow playback.ts (FR-7.1-FR-7.7's already-large,
// already-equivalence-tested module) -- only imports a handful of small
// helpers from it (parseRecordedDaysFromCalendarSearch, updateTimeline,
// clearSelectedTime, updateManualPlaybackPanelVisibility), one-directional
// (playback.ts imports nothing from here), so this file's existence adds
// zero risk to that module's existing behavior/tests.

import moment from 'moment';
import { mountCalendar, CalendarController } from '../../component/calendar/calendar';
import { mountEventTimeline } from '../../component/event-timeline/event-timeline';
import { state } from './state';
import { changedebug, fastJsonStringfy, gettimezonestring } from './helpers';
import { parseRecordedDaysFromCalendarSearch, updateTimeline, clearSelectedTime, updateManualPlaybackPanelVisibility } from './playback';

// SUNAPI's own documented attributes.cgi `Language` parameter enum (FR-7.8.1)
// -- not server-fetched, since no endpoint returns "which languages does
// this device support" as a list.
const LANGUAGES = [
  'English', 'Korean', 'Chinese', 'French', 'Italian', 'Spanish', 'German', 'Japanese',
  'Russian', 'Portuguese', 'Czech', 'Polish', 'Turkish', 'Dutch', 'Hungarian', 'Greek',
];

let calendarController: CalendarController | null = null;
// Guards the "first time visible" fetch chain (FR-7.8.1/FR-7.8.2/FR-7.8.3)
// -- reset whenever the panel is hidden, so it re-runs fresh the next time
// SUNAPI/Playback mode makes it visible again (the user's selected device,
// language, or configured rules may have changed in the meantime).
let panelInitialized = false;

/** FR-7.8: the single place that decides which of `#playback_control`
 *  (FR-7.1-FR-7.7's manual flow) / `#playback_control_calendar` (this
 *  file) is visible, based on Playback mode + SUNAPI state. Called from
 *  device.ts's on_change_use_sunapi_client() and videoControl.ts's
 *  onchangeplaytype() -- the two places that can flip either half of that
 *  condition. */
export function updatePlaybackSunapiUIVisibility(): void {
  try {
    const checkedPlayType = document.querySelector('input[type="radio"][name="play_type"]:checked') as HTMLInputElement | null;
    const isPlayback = checkedPlayType !== null && checkedPlayType.value === 'playback';
    const isSunapiOn = (document.getElementById('use_sunapi_client_checkbox') as HTMLInputElement).checked;
    const showCalendar = isPlayback && isSunapiOn;

    // Video Source (profile/resolution/fps selection) only applies to a
    // live stream -- an already-recorded Playback segment plays back
    // whatever profile it was recorded in, so this section is hidden while
    // in Playback mode and shown for Live, same explicit isPlayback-driven
    // toggle as every other section below. Requested directly by the user,
    // reported live via screenshot: this section stayed visible in
    // Playback mode since nothing gated it on Play Type before.
    (document.getElementById('video_source_group') as HTMLElement).style.display = isPlayback ? 'none' : 'block';

    const showManual = isPlayback && !showCalendar;
    (document.getElementById('playback_control') as HTMLElement).style.display = showManual ? 'block' : 'none';
    (document.getElementById('playback_control_calendar') as HTMLElement).style.display = showCalendar ? 'block' : 'none';
    // Video-playback controls (Forward/Backward/Speed, Seeking Date/Time,
    // etc.) apply regardless of which search flow is active -- gated on
    // isPlayback alone, not showManual/showCalendar, so switching to the
    // Calendar/SUNAPI flow no longer hides them along with the manual
    // flow's own search-only fields (Overlapped Id/AI Search).
    (document.getElementById('playback_video_controls') as HTMLElement).style.display = isPlayback ? 'block' : 'none';
    // FR-7.1 v2.0: mirrors this function's own showCalendar/panelInitialized
    // pattern below for the manual flow's default "1 day ending now" search.
    updateManualPlaybackPanelVisibility(showManual);

    // #playback-calendar-timeline wraps #playback_control_calendar and
    // #timeline together purely for layout (side-by-side, see its own HTML
    // comment) -- #timeline itself is a deliberate SIBLING of both search
    // panels (not nested in either), so switching between the manual/
    // calendar sub-panels *within* Playback mode never hides it. Toggled
    // explicitly here on `isPlayback` alone, same pattern as
    // #playback_video_controls right above, instead of the earlier design
    // where only #timeline itself got a Live-mode special-cased hide (a
    // leftover timeline from a previous Playback search otherwise stayed
    // visible after switching to Live) -- that left the group wrapper's own
    // visibility implicit (empty but not actually `display:none`) rather
    // than explicit like every other Playback-only section here. Requested
    // directly by the user.
    (document.getElementById('playback-calendar-timeline') as HTMLElement).style.display = isPlayback ? 'flex' : 'none';

    if (showCalendar) {
      if (!panelInitialized) {
        panelInitialized = true;
        initPlaybackCalendarPanel();
      }
    } else {
      panelInitialized = false;
    }
  } catch (error) {
    console.error(error);
  }
}

// Guards the very first getCalendarSearch() call each time this panel is
// (re-)shown against a real-device auth race -- see runMonthSearch()'s own
// comment below for the full explanation. null once consumed (or once
// there's nothing to wait for), so later month navigation isn't delayed.
let firstShowBarrier: Promise<unknown> | null = null;

/** FR-7.8.1/FR-7.8.2/FR-7.8.3: mount (or re-show) the Calendar and fetch
 *  Rules -- Language itself is no longer fetched here (see
 *  fetchDeviceLanguage()'s own comment); `languageFetchPromise` is reused as
 *  runMonthSearch()'s first-call barrier in its place, since by the time
 *  this panel is shown that fetch has normally already settled (SUNAPI
 *  turns on well before Playback mode is typically selected), but doesn't
 *  have to have -- `.finally()` below still sequences correctly either
 *  way. */
function initPlaybackCalendarPanel(): void {
  firstShowBarrier = (languageFetchPromise ?? Promise.resolve()).finally(() => {
    refreshEventRules();
  });

  if (calendarController === null) {
    calendarController = mountCalendar({
      containerId: 'playback_calendar',
      onMonthChange: (year, month) => runMonthSearch(year, month),
      onDayClick: (year, month, day) => onCalendarDayClick(year, month, day),
    });
    // mountCalendar() already fires onMonthChange once for the initial
    // month as part of mounting (src/component/calendar/calendar.ts) --
    // no separate runMonthSearch() call needed for the first mount.
  } else {
    runMonthSearch(calendarController.getYear(), calendarController.getMonth());
  }
}

/** The settlement of the most recent fetchDeviceLanguage() call -- reused by
 *  initPlaybackCalendarPanel() as its own runMonthSearch() first-call
 *  barrier (see there) instead of re-fetching getDeviceInfo() itself. */
let languageFetchPromise: Promise<unknown> | null = null;

/** FR-7.8.1 v2: getDeviceInfo() -> set #event_rules_language's selection --
 *  called from device.ts's on_change_use_sunapi_client() as soon as SUNAPI
 *  turns On, regardless of Play Type (this field moved out of
 *  #playback_control_calendar into the always-visible Device panel, next to
 *  Is Android? -- requested directly by the user). Still only meaningfully
 *  *used* by FR-7.8.2's Rule fetch (refreshEventRules(), which reads this
 *  select's value) once the Calendar panel actually shows -- this just
 *  moves *when* the value becomes known, not who reads it. */
export function fetchDeviceLanguage(): void {
  languageFetchPromise = state.getSunapiManager().getDeviceInfo()
    .then((info: any) => {
      const languageSelect = document.getElementById('event_rules_language') as HTMLSelectElement;
      if (info && typeof info.Language === 'string' && LANGUAGES.includes(info.Language)) {
        languageSelect.value = info.Language;
      }
    })
    .catch((error: any) => {
      changedebug('getDeviceInfo (device language) error: ' + fastJsonStringfy(error));
    });
}

/** FR-7.8.2: getDynamicRules(language) -> #event_rules_type, filtered to
 *  the currently-selected channel. Also called when #event_rules_language
 *  changes, and (via refreshRuleSelectForChannelChange()) when the channel
 *  selector changes while this panel is visible. */
function refreshEventRules(): void {
  const language = (document.getElementById('event_rules_language') as HTMLSelectElement).value;
  const channel = Number(state.getSelectedPlayer().channel) - 1;
  state.getSunapiManager().getDynamicRules(language)
    .then((ruleEntries: any) => {
      state.dynamicRuleEntries = ruleEntries ?? [];
      populateRuleSelect(ruleEntries, channel);
    })
    .catch((error: any) => {
      changedebug('getDynamicRules (playback calendar) error: ' + fastJsonStringfy(error));
    });
}

/** FR-16 (docs/event-timeline-component/SRS.md): the Rule select's options
 *  and current value -- the select itself lives inside the Event Timeline
 *  widget's own toolbar now (event-timeline.ts), rebuilt on every remount,
 *  so this module tracks both across remounts the same way
 *  `currentOverlappedIds` already does for Overlapped Id. `currentRuleTypeValue`
 *  defaults to 'All', matching getTimeline()'s own default `type` param
 *  (SunapiManager.ts's buildTimelineUri()) and the pre-move select's native
 *  default (its first, explicitly-added 'All' option). */
let currentRuleTypeOptions: { value: string; label: string }[] = [{ value: 'All', label: 'All' }];
let currentRuleTypeValue = 'All';

/** FR-16's own 'change' handler, threaded into every
 *  mountEventTimeline()/updateTimeline() call that renders the Rule select
 *  (ensureEventTimelineShell() below and runCalendarTimelineSearch()'s own
 *  updateTimeline() call) -- updates the tracked value then re-runs the
 *  Timeline query for it, same effect the pre-move static
 *  `#event_rules_type` 'change' listener had (see git history), just
 *  re-wired per-remount instead of attached once at setup time (a listener
 *  attached to a since-destroyed, previously-rendered select would never
 *  fire again after the very next remount). */
function onRuleTypeChange(value: string): void {
  currentRuleTypeValue = value;
  runCalendarTimelineSearch();
}

/** FR-16: mounts an empty-rows/items "shell" instance of the Event Timeline
 *  widget the first time this panel's Rule data is ready, so the Rule
 *  select has somewhere to render into (and is visible/interactive)
 *  *before* the first day/preset click -- unlike Overlapped Id, Rule data
 *  (getDynamicRules()) is fetched independently of any search and is meant
 *  to be usable immediately, but the widget itself is otherwise only ever
 *  created by updateTimeline() on a real Timeline response. A real search
 *  later destroys and replaces this shell via updateTimeline() exactly like
 *  any other remount (currentRuleTypeOptions/currentRuleTypeValue thread
 *  through that remount the same way currentOverlappedIds does). No-op if a
 *  widget (shell or real data) already exists -- callers still need to call
 *  `setRuleTypes()` themselves for that case (see populateRuleSelect()). */
function ensureEventTimelineShell(): void {
  if (state.eventTimeline !== null) {
    return;
  }
  state.eventTimeline = mountEventTimeline({
    containerId: 'timeline',
    rows: [],
    items: [],
    ruleTypes: currentRuleTypeOptions,
    selectedRuleType: currentRuleTypeValue,
    onRuleTypeChange,
  });
}

/** getDynamicRules() returns each *configured* rule as a whole
 *  (`{Rule: <number>, RuleName: <localized display name>, EventSources:
 *  [{Channel, ...}], ...}`) -- one option per rule whose EventSources
 *  include the selected channel, value `'Rule' + (Rule + 1)` (what
 *  recording.cgi's Timeline search actually expects as its `Type` param --
 *  the endpoint's `Rule<N>` numbering is 1-based, one higher than
 *  `getDynamicRules()`'s own 0-based `Rule` field, e.g. `Rule: 0` ->
 *  `Type=Rule1`), label `RuleName`. Confirmed against a real device's
 *  `eventrules.cgi?msubmenu=dynamicrules` response and a real
 *  `recording.cgi?msubmenu=timeline` request -- see MEMORY.md; this
 *  replaces an earlier, real-device-unverified design that built the list
 *  from EventSources[].Type (e.g. `MotionDetection`) merged across
 *  getDynamicRulesOptions()/getDynamicRules(), which doesn't match what
 *  the Timeline endpoint's `Type` param actually accepts. */
function populateRuleSelect(ruleEntries: any[], channel: number): void {
  // getTimeline()'s own `type` parameter defaults to 'All' when omitted
  // (SunapiManager.ts's buildTimelineUri()) -- offered here explicitly, as
  // the first/default option, so the user can search every event type
  // instead of one specific Rule.
  const options: { value: string; label: string }[] = [{ value: 'All', label: 'All' }];

  for (const entry of ruleEntries ?? []) {
    if (typeof entry.Rule !== 'number') {
      continue;
    }
    const appliesToChannel = (entry.EventSources ?? []).some((source: any) => Number(source.Channel) === channel);
    if (!appliesToChannel) {
      continue;
    }
    options.push({
      value: 'Rule' + (entry.Rule + 1),
      label: typeof entry.RuleName === 'string' ? entry.RuleName : 'Rule ' + (entry.Rule + 1),
    });
  }

  currentRuleTypeOptions = options;
  if (!options.some((opt) => opt.value === currentRuleTypeValue)) {
    currentRuleTypeValue = 'All';
  }
  ensureEventTimelineShell();
  state.eventTimeline?.setRuleTypes(currentRuleTypeOptions, currentRuleTypeValue);
}

/** Called from device.ts's changechannel() -- the Rule list is
 *  channel-filtered (see populateRuleSelect()), so switching channels
 *  while this panel is visible needs a fresh getDynamicRules() fetch, not
 *  just a re-render of already-fetched data. No-op while the panel isn't
 *  showing (Live mode, or Playback with SUNAPI Off) to avoid a wasted
 *  request. */
export function refreshRuleSelectForChannelChange(): void {
  const panel = document.getElementById('playback_control_calendar') as HTMLElement | null;
  if (panel !== null && panel.style.display !== 'none') {
    refreshEventRules();
  }
}

/** Called from device.ts's changechannel(), unconditionally on every
 *  channel change -- gates itself on Play Type internally, same style as
 *  the other channel-change handlers here. A channel change invalidates
 *  every piece of day-specific Playback state built up for the OLD
 *  channel, since none of it was ever fetched/valid for the NEW one:
 *
 *  - The player itself may still be playing/paused on the OLD channel's
 *    recording -- `stop()`ing it applies regardless of which of the two
 *    Playback search UIs (this Calendar panel, or FR-7.1-FR-7.7's manual
 *    flow) is currently in use, since the player instance is shared.
 *  - `#timeline` (FR-7.6) likewise may hold the OLD channel's rendered
 *    results, from either UI -- hidden the same way `updatePlaybackSunapiUIVisibility()`
 *    already hides it on leaving Playback mode entirely.
 *  - Overlapped Id (the Event Timeline's own toolbar select, shared with
 *    FR-7.1's manual flow -- see event-timeline.ts FR-15) resets to its
 *    pre-day-click (empty) state, and `currentCalendarSearchRange` clears
 *    (so a stray Rule change before the next day/preset click silently
 *    no-ops rather than reusing the OLD channel's range). `#timeline`
 *    itself (their shared container, also Rule's -- FR-16) is already
 *    hidden by the unconditional step above. Selected Time (the Event
 *    Timeline's own, shared with FR-7.1's manual flow) resets via
 *    playback.ts's clearSelectedTime(). Rule's own options/value are left
 *    untouched here (never were, even before FR-16) -- the separate,
 *    already-in-flight `refreshRuleSelectForChannelChange()` fetch (called
 *    just before this function, see device.ts) repopulates them for the new
 *    channel shortly after.
 *  - Finally, FR-7.8.4's month search re-runs for the currently-displayed
 *    month so the Calendar's highlighted-recorded-days reflect the NEW
 *    channel (same 0-based `ChannelIDList` numbering as FR-7.8.2/FR-7.8.5) --
 *    passing `revealSearchArea: false` so this specific re-fetch does NOT
 *    undo the reset above by re-showing `#timeline` the way a normal month
 *    navigation does (there's nothing to show yet: no day has been clicked
 *    for the new channel).
 *
 *  The Calendar-specific steps no-op while this panel isn't showing (Live
 *  mode, or Playback with SUNAPI Off) -- same guard as
 *  refreshRuleSelectForChannelChange() -- but the player-stop and
 *  `#timeline`-hide steps run whenever Play Type is Playback, regardless
 *  of SUNAPI state, since both apply to FR-7.1-FR-7.7's manual flow too. */
export function resetPlaybackSearchStateForChannelChange(): void {
  try {
    const checkedPlayType = document.querySelector('input[type="radio"][name="play_type"]:checked') as HTMLInputElement | null;
    if (checkedPlayType === null || checkedPlayType.value !== 'playback') {
      return;
    }

    (document.getElementById('timeline') as HTMLElement).style.display = 'none';
    state.getSelectedPlayer().stop();

    const panel = document.getElementById('playback_control_calendar') as HTMLElement | null;
    if (panel === null || panel.style.display === 'none') {
      return;
    }

    // FR-15: the select itself now lives inside the Event Timeline widget
    // (event-timeline.ts), not a standalone #calendar_overlapped_id_area --
    // reset the cached list and the widget's own selection instead of
    // removing DOM elements directly.
    currentOverlappedIds = [];
    state.eventTimeline?.setOverlappedIds([]);
    calendarController?.setSelectedDay(null);
    state.getSelectedPlayer().overlappedId = 0;
    currentCalendarSearchRange = null;
    clearSelectedTime();

    if (calendarController !== null) {
      runMonthSearch(calendarController.getYear(), calendarController.getMonth(), false);
    }
  } catch (error) {
    console.error(error);
  }
}

/** FR-7.8.4: getCalendarSearch(YYYY-MM, channel) -> highlight recorded days
 *  -> reveal `#timeline` (the Rule/Overlapped Id controls' shared
 *  container, FR-16/FR-15).
 *
 *  The very first call each time the panel is shown waits on
 *  `firstShowBarrier` (fetchLanguageAndRules()'s own getDeviceInfo()
 *  settlement) before actually issuing getCalendarSearch() -- reported
 *  directly by the user against a real device: getCalendarSearch()
 *  intermittently came back 401 while every other request succeeded. Root
 *  cause, confirmed by reading the vendored `@melchi45/rtsp-over-websocket`
 *  library's SunapiClient: its digest-auth retry counter (`authCount`) is
 *  shared, unscoped instance state, not per-request -- when two requests
 *  both need a fresh (uncached) digest challenge at the same time (which
 *  getDeviceInfo() and this function's getCalendarSearch() are, since
 *  mountCalendar() fires this synchronously right alongside
 *  fetchLanguageAndRules() kicking off getDeviceInfo()), whichever 401
 *  response is processed second sees the counter already incremented by
 *  the first and gives up instead of retrying with credentials -- a real
 *  bug in that library, but not one this app can fix without republishing
 *  it, so this waits out the specific race window instead. Explains the
 *  user's "doesn't always happen": it only surfaces when this is the
 *  first request in a while needing a fresh challenge, not on every call.
 *  Only the FIRST call after a fresh show waits; subsequent month
 *  navigation calls (barrier already null) proceed immediately, since by
 *  then the digest challenge is cached and concurrent calls are safe (see
 *  the investigation this comment is based on).
 *
 *  `revealSearchArea` (default `true`, matching every pre-existing caller:
 *  initial mount and month navigation) shows `#timeline` (ensuring the FR-16
 *  shell exists first, in case this resolves before populateRuleSelect()'s
 *  own does) once the fetch resolves, regardless of whether any day has
 *  recordings -- see this function's own doc comment above.
 *  `resetPlaybackSearchStateForChannelChange()` passes `false` for its own
 *  channel-change-triggered re-fetch, since that function has deliberately
 *  just hidden that same container and there's nothing yet to show for the
 *  new channel until a day is clicked again. */
function runMonthSearch(year: number, month: number, revealSearchArea = true): void {
  const barrier = firstShowBarrier;
  firstShowBarrier = null;

  const doSearch = () => {
    try {
      const channel = Number(state.getSelectedPlayer().channel) - 1;
      const monthStr = year + '-' + String(month).padStart(2, '0');
      state.getSunapiManager().getCalendarSearch(monthStr, channel)
        .then((calendar: any) => {
          const recordedDays = parseRecordedDaysFromCalendarSearch(calendar);
          calendarController?.setHighlightedDays(recordedDays, year, month);
          if (revealSearchArea) {
            ensureEventTimelineShell();
            (document.getElementById('timeline') as HTMLElement).style.display = 'block';
          }
        })
        .catch((error: any) => {
          changedebug('getCalendarSearch (playback calendar) error: ' + fastJsonStringfy(error));
        });
    } catch (error) {
      console.error(error);
    }
  };

  if (barrier) {
    barrier.finally(doSearch);
  } else {
    doSearch();
  }
}

/** FR-7.8.5: fire Overlapped Id + Timeline searches for the clicked day's
 *  full 00:00:00-23:59:59 range. */
function onCalendarDayClick(year: number, month: number, day: number): void {
  try {
    // Defensive: a day is clickable (highlighted) independently of
    // #timeline's own visibility -- normally already showing by the time
    // any day is clickable (FR-7.8.4's month search reveals it before
    // highlighting anything), but resetPlaybackSearchStateForChannelChange()
    // (FR-7.8.6) deliberately leaves it hidden after a channel change until
    // the next month navigation. Without this, a day click right after a
    // channel change (no month nav in between) would populate Rule/
    // Overlapped Id into a still-`display:none` container, invisible to
    // the user.
    ensureEventTimelineShell();
    (document.getElementById('timeline') as HTMLElement).style.display = 'block';

    calendarController?.setSelectedDay(day);
    const dayStr = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    runOverlappedAndTimelineSearch(
      applyCalendarGmtConversion(dayStr + ' 00:00:00'),
      applyCalendarGmtConversion(dayStr + ' 23:59:59'),
    );
  } catch (error) {
    console.error(error);
  }
}

/** GMT-aware, matching FR-7.1's own equivalent conversion -- `raw` is
 *  `YYYY-MM-DD HH:mm:ss` (local wall-clock components), converted to
 *  SUNAPI's `YYYY-MM-DD[T]HH:mm:ss[Z]` shape if `#use_gmt` is checked. */
function applyCalendarGmtConversion(raw: string): string {
  if ((document.getElementById('use_gmt') as HTMLInputElement).checked) {
    const timezone = gettimezonestring((document.getElementById('timezone') as HTMLInputElement).value);
    return moment(raw).utcOffset(timezone).format('YYYY-MM-DD[T]HH:mm:ss[Z]');
  }
  return raw;
}

/** For the Event Timeline's own preset-button clicks (FR-7.8.2 v2.0) --
 *  `date` is interpreted in local browser time, same as
 *  playback.ts's formatManualSearchTime(). */
function formatDateForCalendarSearch(date: Date): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** The date range this flow's last search actually used -- no DOM field
 *  tracks it any more (`#calendar_start_date`/etc. were removed along
 *  with the rest of "Manual Start/End Time" -> Selected Time, see
 *  docs/window-ui/SRS.md FR-7.8.2 v2.0), so runCalendarTimelineSearch()
 *  (FR-7.8.2, Rule change) needs it tracked here instead. Set by
 *  runOverlappedAndTimelineSearch() (day click or preset click); cleared
 *  by resetPlaybackSearchStateForChannelChange() on channel change. `null`
 *  means "nothing searched yet this panel-visible session" -- both readers
 *  treat that as a silent no-op. */
let currentCalendarSearchRange: { strSearchStartTime: string; strSearchEndTime: string } | null = null;

/** This flow's last-fetched Overlapped Id list -- FR-15's move of the
 *  select into the Event Timeline widget's own toolbar means there's no
 *  standalone `#calendar_overlapped_id_area` DOM to read back any more
 *  (see event-timeline.ts). Set by runOverlappedAndTimelineSearch() (day
 *  click or preset click); reset to `[]` by
 *  resetPlaybackSearchStateForChannelChange() on channel change. Empty
 *  means "nothing fetched yet this panel-visible session, or the last
 *  fetch came back with no overlapping sessions" -- runCalendarTimelineSearch()
 *  then falls back to the widget's own current live selection (a Rule
 *  change re-search, which doesn't re-fetch this list). */
let currentOverlappedIds: string[] = [];

/** FR-7.8.5: getOverlappedIdList() then getTimeline() (via
 *  runCalendarTimelineSearch()) -- sequenced, not fired as independent/
 *  concurrent Promises the way FR-7.1/FR-7.3's own equivalent pattern
 *  does. Reported directly by the user against a real device: getTimeline()
 *  intermittently came back 401 while every other request succeeded
 *  (confirmed NOT a credentials/URL/camera problem -- pasting the exact
 *  same failing URL into the browser's address bar works). Same root
 *  cause as runMonthSearch()'s firstShowBarrier (see its comment and
 *  MEMORY.md): the vendored @melchi45/rtsp-over-websocket library's
 *  SunapiClient shares its digest-auth retry counter across every call on
 *  the client instance, so two requests both needing a fresh challenge at
 *  once can race, and whichever loses fails outright instead of retrying
 *  with credentials. getOverlappedIdList() and getTimeline() were fired
 *  concurrently on every single day click (not just the panel's first
 *  show), so unlike the month-search barrier (which only needs to guard
 *  the very first call), this race could recur on every click. Waiting
 *  for getOverlappedIdList() to settle before firing getTimeline() closes
 *  that window -- as a side effect, getTimeline()'s overlappedId argument
 *  now reflects THIS click's freshly-fetched list (currentOverlappedIds is
 *  already updated by the time runCalendarTimelineSearch() reads it) rather
 *  than the previous click's stale value, which is arguably more correct
 *  anyway.
 *
 *  As of FR-7.8.5 v2.0, called with an explicit range (a day click's own
 *  00:00:00-23:59:59, or a preset click's `[now-preset, now]` via
 *  onCalendarRangePresetSelect()) rather than reading it back from now-
 *  removed `#calendar_start_date`/etc. fields. */
function runOverlappedAndTimelineSearch(strSearchStartTime: string, strSearchEndTime: string): void {
  try {
    currentCalendarSearchRange = { strSearchStartTime, strSearchEndTime };
    const channel = Number(state.getSelectedPlayer().channel) - 1;

    state.getSunapiManager().getOverlappedIdList(strSearchStartTime, strSearchEndTime, channel)
      .then((overlapped: any) => {
        currentOverlappedIds = typeof overlapped.OverlappedIDList !== 'undefined' ? overlapped.OverlappedIDList : [];
      })
      .catch((error: any) => {
        changedebug('getOverlappedIdList (playback calendar) error: ' + fastJsonStringfy(error));
        currentOverlappedIds = [];
      })
      .finally(() => {
        runCalendarTimelineSearch();
      });
  } catch (error) {
    console.error(error);
  }
}

/** FR-16: the Rule select's own 'change' handler (`onRuleTypeChange` above,
 *  threaded through every mount of the widget that renders it) -- re-fetches
 *  just getTimeline() (not Overlapped Id) for the currently-set date range
 *  and Overlapped Id, with the newly-selected Rule as the query's own `Type`
 *  param, and redraws `#timeline` from that response. Split out of
 *  runOverlappedAndTimelineSearch() (which still calls this as its own
 *  tail step after a day click) since changing which Rule to filter by
 *  only changes the Timeline query's `Type`, not which recording session
 *  (Overlapped Id) is selected -- re-fetching that too on every Rule
 *  change would be a wasted request. No-op (silently) if nothing has been
 *  searched yet this panel-visible session (`currentCalendarSearchRange`
 *  still `null`) -- reachable now that Rule is interactive before any day
 *  click (FR-16's shell), not just via the pre-FR-16 static select. Also
 *  passed as `updateTimeline()`'s `onRangePresetSelect` by both callers
 *  below, since a preset click should always land here regardless of what
 *  triggered the search it's redrawing.
 *
 *  FR-15: since Overlapped Id now lives inside the Event Timeline widget's
 *  own toolbar, and `updateTimeline()` fully remounts that widget on every
 *  call (including this Rule-change path, not just a fresh day/preset
 *  search), the query's own `overlappedId` is picked by preferring the
 *  widget's current live selection -- but only when it's actually a member
 *  of `currentOverlappedIds` (a Rule change re-search: same day, same
 *  list, so a user's manual pick is still valid and should be honored).
 *  When it isn't (a fresh day/preset search just replaced
 *  `currentOverlappedIds` with a different day's list, so the old
 *  selection has nothing to do with it, or nothing has been selected yet),
 *  falls back to the new list's own default (its last element -- matching
 *  the pre-move select box's own highest-index-first default). The result
 *  is also passed back into `updateTimeline()`'s `selectedOverlappedId` so
 *  the remounted select keeps showing this same value instead of silently
 *  snapping to the list's default. `currentRuleTypeValue` (FR-16) needs no
 *  equivalent live-vs-cache reconciliation -- unlike Overlapped Id it's
 *  updated synchronously, right here, by `onRuleTypeChange` before this
 *  function is even called, so it's always already the value just picked. */
function runCalendarTimelineSearch(): void {
  try {
    if (currentCalendarSearchRange === null) {
      return;
    }
    const { strSearchStartTime, strSearchEndTime } = currentCalendarSearchRange;
    const channel = Number(state.getSelectedPlayer().channel) - 1;
    const ruleType = currentRuleTypeValue;
    const liveSelection = state.eventTimeline?.getOverlappedId() ?? null;
    const overlappedId = liveSelection !== null && currentOverlappedIds.includes(liveSelection)
      ? liveSelection
      : currentOverlappedIds[currentOverlappedIds.length - 1];

    state.getSunapiManager().getTimeline(strSearchStartTime, strSearchEndTime, channel, overlappedId, ruleType)
      .then((timeline: any) => {
        if (typeof timeline !== 'undefined') {
          updateTimeline(
            timeline.TimeLineSearchResults, onCalendarRangePresetSelect,
            { start: new Date(strSearchStartTime), end: new Date(strSearchEndTime) },
            currentOverlappedIds, overlappedId,
            currentRuleTypeOptions, currentRuleTypeValue, onRuleTypeChange,
          );
          (document.getElementById('timeline') as HTMLElement).style.display = 'block';
        }
      })
      .catch((error: any) => {
        changedebug('getTimeline (playback calendar) error: ' + fastJsonStringfy(error));
      });
  } catch (error) {
    console.error(error);
  }
}

/** FR-7.6/FR-7.8.5 v2.0: the Event Timeline's 1H/6H/1D/1W/1M/1Y preset
 *  buttons, when this Calendar panel is the one that rendered the timeline
 *  being viewed -- re-runs the full Overlapped Id + Timeline sequence
 *  (same as a day click) for `[fromDate, toDate]` instead of the
 *  previously-clicked day's 00:00:00-23:59:59. */
function onCalendarRangePresetSelect(fromDate: Date, toDate: Date): void {
  runOverlappedAndTimelineSearch(
    applyCalendarGmtConversion(formatDateForCalendarSearch(fromDate)),
    applyCalendarGmtConversion(formatDateForCalendarSearch(toDate)),
  );
}

export function setupPlaybackCalendar(): void {
  const languageSelect = document.getElementById('event_rules_language') as HTMLSelectElement;
  for (const lang of LANGUAGES) {
    const option = document.createElement('option');
    option.value = lang;
    option.textContent = lang;
    languageSelect.append(option);
  }
  languageSelect.addEventListener('change', refreshEventRules);

  // FR-16: unlike #event_rules_language above (a static element that lives
  // for the page's whole lifetime), the Rule select itself now lives inside
  // the Event Timeline widget's own toolbar, torn down and rebuilt on every
  // remount -- a single addEventListener() here would stop firing after the
  // very first remount, since it'd be attached to an already-destroyed
  // element. Wired per-mount instead, via `onRuleTypeChange` passed to every
  // mountEventTimeline()/updateTimeline() call that renders it
  // (ensureEventTimelineShell(), runCalendarTimelineSearch()).
}
