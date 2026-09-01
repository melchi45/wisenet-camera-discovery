# PRD — Calendar Component

| | |
|---|---|
| Title | Calendar Component — Product Requirements Document (PRD) |
| Abstract | Problem, goals, non-goals, users, and success criteria for `src/component/calendar/`'s `mountCalendar()`. |
| Status | Draft |
| Component | `src/component/calendar/` — used from `src/shared-v2/` only (`playbackCalendar.ts`) |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [MRD](MRD.md) · [SRS](SRS.md) · [DESIGN](DESIGN.md) · [TC](TC.md) · [../window-ui/SRS.md](../window-ui/SRS.md) (FR-7.8) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-28 | Youngho Kim | Initial PRD. |

## Problem

`docs/window-ui/SRS.md`'s FR-7.8 needs a month-view calendar: show a year/month, let the caller
mark specific days as "has recordings" once a `calendarsearch` result is known, and report day
clicks back to the caller — see [MRD.md](MRD.md).

## Goals

- A reusable month-grid calendar, mounted into an empty container.
- Previous/next month navigation, reporting the newly-shown month to the caller so it can re-run
  its own search for that month.
- A `setHighlightedDays()` API the caller calls after its own `calendarsearch` resolves — the
  component itself makes no SUNAPI calls and knows nothing about SUNAPI.
- Only highlighted days are clickable; the caller is told which day (year/month/day) was clicked.

## Non-Goals

- Not a date-*range* picker (click-and-drag a span) — one day click at a time, matching FR-7.8.5's
  single-day-click flow.
- Not a general-purpose scheduling/event calendar (no multi-event-per-day rendering, no time-of-day
  granularity) — day-level highlighting only.
- No SUNAPI/network awareness whatsoever — `playbackCalendar.ts` owns every `getCalendarSearch()`/
  `getOverlappedIdList()`/`getTimeline()` call and feeds this component only plain year/month/day
  data.
- Not applied anywhere in `src/shared/` (the real shipped product) — `src/shared-v2/`-only, same as
  the feature it supports.

## Users

Anyone using `src/shared-v2/`'s Playback panel with SUNAPI turned on, who wants to see which days
actually have footage before running a search, rather than guessing a date range by hand.

## User Story

> As a user reviewing recorded footage, I want to see which days in a month actually have
> recordings before I search, and pick one with a click instead of typing dates by hand.

## Success Criteria

- The calendar renders the correct number of days and weekday offset for any given month (verified
  against `moment`, already a project dependency, not hand-computed).
- `setHighlightedDays()` visibly distinguishes those days (a dedicated CSS class) and makes only
  those days clickable.
- Clicking a highlighted day invokes `onDayClick(year, month, day)` exactly once.
- Prev/next navigation invokes `onMonthChange(year, month)` for the newly-shown month, without the
  component itself fetching anything.
- `npm run build:shared-v2` succeeds; `npm run build` (the real, shipped product) is unaffected,
  since nothing under `src/component/calendar/` is imported from `src/shared/`.
