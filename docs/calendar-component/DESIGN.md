# DESIGN — Calendar Component

| | |
|---|---|
| Title | Calendar Component — Design Document |
| Abstract | Why a dynamic-render exception to `switch`/`disclosure`'s style, the month-grid rendering approach, stale-month guarding, and idempotency. |
| Status | Draft |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [PRD](PRD.md) · [MRD](MRD.md) · [SRS](SRS.md) · [TC](TC.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-28 | Youngho Kim | Initial DESIGN. |

## Why dynamic render, not progressive enhancement

`src/component/switch/`'s `mountSwitch()` and `src/component/disclosure/`'s `mountDisclosure()`
both only enhance markup already authored in `window.html` — never generating DOM themselves. A
month calendar can't follow that: the grid (day count, first-weekday offset, which cells are
highlighted) is different every month, so it must be computed and rendered, not hand-authored once.
`mountCalendar()` mounts into an *initially-empty* `<div>` (`#playback_calendar` in
`src/shared-v2/window.html`) and owns everything inside it — see [MRD.md](MRD.md) for why this is
still consistent with this codebase's broader conventions (the discovery table/topology and Video
Source/Profile list already render dynamically from data for the identical reason).

## Month-grid rendering

Each render (initial mount, prev/next, `goToMonth()`) rebuilds the grid from scratch — simpler and
safer than diffing a 28–31-cell grid for a component this size, and matches
`renderDiscoveryTable()`/`updateTimeline()`'s own "clear and rebuild" pattern elsewhere in
`src/shared-v2/`:

1. `moment({year, month: month - 1}).daysInMonth()` for the day count (`moment` is 0-based for
   `month`; this component's own public API is 1-based, matching `Date.getMonth() + 1`'s convention
   already used throughout `src/shared-v2/playback.ts`).
2. `moment({year, month: month - 1, day: 1}).day()` for the first day's weekday (0 = Sunday) — that
   many leading blank cells are inserted before day 1.
3. One cell per day, `data-day="<n>"`; `.calendar-day-has-recording` applied by
   `setHighlightedDays()`, `.calendar-day-selected` by `setSelectedDay()`.

## Stale-month guarding (SRS FR-2/FR-3)

`onMonthChange` fires *before* the new grid renders, and `setHighlightedDays(days, forYear,
forMonth)` takes the month it applies to as **required** parameters rather than inferring it —
the component compares `forYear`/`forMonth` against its own current `year`/`month` closure state
and no-ops if they don't match. A caller's async `calendarsearch` response arriving after the user
has already clicked to a different month is silently dropped rather than painting highlights onto
the wrong grid, and the check needs no separate "request token"/generation counter — the month
itself, which the caller already knows (it's what it asked `getCalendarSearch()` for), is a
sufficient and simpler key. This mirrors a general pattern this codebase doesn't otherwise need
(most other `src/shared-v2/` async flows only have one live request at a time), made necessary
here because month navigation is fast/synchronous while the caller's search is not.

## Idempotency needs a cache, not just a DOM flag

`switch`/`disclosure`'s idempotency guard (`data-*-mounted`) works because their state lives
entirely on the DOM (a checkbox's `.checked`, a `<details>`'s `.open`) — a second mount call can
just skip re-attaching listeners and still return a controller that reads/writes the live element
correctly. This component's state (`year`/`month`/`highlightedDays`) lives in a JS closure created
by the *first* `mountCalendar()` call; a second call constructing a fresh closure would produce a
controller bound to wrong, reset state (back to `initialYear`/`initialMonth`, no highlights) even
though the DOM already shows a different month. `mountCalendar()` instead keys a module-level
`WeakMap<HTMLElement, CalendarController>` by the container element and returns the first call's
actual controller on any subsequent call for the same container.

## Idempotency

Guarded by a `data-calendar-mounted` attribute on the container, matching
`mountSwitch()`/`mountDisclosure()`'s own `data-*-mounted` convention exactly.

## Components (Files)

- `src/component/calendar/calendar.ts` — `mountCalendar()`, types, `CalendarController`.
- `src/component/calendar/calendar.css` — grid layout, `.calendar-day-has-recording`,
  `.calendar-day-selected`, prev/next button styling.
- `src/shared-v2/window.html` — `<div id="playback_calendar">` inside `#playback_control_calendar`
  (see `docs/window-ui/DESIGN.md`'s FR-7.8 section), plus the `<link rel="stylesheet"
  href="css/calendar.css">` tag.
- `src/shared-v2/modules/playbackCalendar.ts` — the one `mountCalendar()` call, with
  `onMonthChange`/`onDayClick` wired to `docs/window-ui/SRS.md`'s FR-7.8.4/FR-7.8.5.
- `scripts/build.js` — `buildSharedV2()` copies `calendar.css` into `dist/shared-v2-preview/css/`,
  same pattern `switch.css`/`disclosure.css` already use there. **Not** copied by
  `copySharedWebAssets()` (the real product's own asset copy) — `src/shared/` never references this
  component, matching `PRD.md`'s Non-Goals.
