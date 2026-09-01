# TC — Calendar Component

| | |
|---|---|
| Title | Calendar Component — Test Cases (TC) |
| Abstract | Playwright test cases for `mountCalendar()`, exercised via `src/shared-v2/`'s FR-7.8 integration (`tests/window-ui-equivalence/`) — no isolated unit-test harness exists for this component. |
| Status | Draft |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [PRD](PRD.md) · [MRD](MRD.md) · [SRS](SRS.md) · [DESIGN](DESIGN.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-28 | Youngho Kim | Initial TC. |

## Method

Exercised through `docs/window-ui/TC.md`'s TC-31/TC-32 (against `dist/shared-v2-preview/` and
`tools/mock-sunapi-server/`, new-page-only — no `src/shared/` equivalent exists to compare
against) rather than a separate component-level test harness, since this component has no
meaningful standalone use outside that one integration.

| ID | SRS FR | Steps | Expected result |
|---|---|---|---|
| TC-1 | FR-1 | Mount with no `initialYear`/`initialMonth` | Grid shows today's month with the correct day count and weekday alignment for that month (cross-checked against `moment().daysInMonth()`/`moment().startOf('month').day()`). |
| TC-2 | FR-2 | Mount, then click next/prev | `onMonthChange` fires with the correct year/month for each navigation, including a December→January (year increment) and January→December (year decrement) rollover. |
| TC-3 | FR-3 | Call `setHighlightedDays([...], year, month)` for the currently-shown year/month | Exactly those day cells gain `.calendar-day-has-recording`; a second call with a different set replaces (not adds to) the first. |
| TC-4 | FR-3 (stale guard) | Call `setHighlightedDays([...], y, m)` for the current month, then navigate to a different month, *then* call `setHighlightedDays([...], y, m)` again with the now-stale `y`/`m` (simulating a late async response for the *previous* month) | The stale call is a no-op — the new month's grid shows no highlights from it, and `getYear()`/`getMonth()` reflect the new month, not `y`/`m`. |
| TC-5 | FR-4/FR-5 | Click a highlighted day; separately, click a non-highlighted day | `onDayClick` fires exactly once for the highlighted day, with the correct year/month/day; the non-highlighted day click does nothing (no callback, `cursor: default` not `pointer`). |
| TC-6 | FR-6 | Call `setSelectedDay(n)` | Day `n`'s cell gains the selection class; no `onDayClick`/`onMonthChange` fires as a side effect. |
| TC-7 | FR-7 | Call `mountCalendar()` twice for the same `containerId` | Second call is a no-op (no duplicate grid, no double-registered handlers — verified by confirming `onDayClick` fires exactly once per click, not twice); both calls' returned controllers still read/write the one live grid correctly. |
