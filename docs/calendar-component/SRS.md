# SRS — Calendar Component

| | |
|---|---|
| Title | Calendar Component — Software Requirements Specification (SRS) |
| Abstract | Functional and non-functional requirements for `mountCalendar()`. |
| Status | Draft |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [PRD](PRD.md) · [MRD](MRD.md) · [DESIGN](DESIGN.md) · [TC](TC.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-28 | Youngho Kim | Initial SRS. |

## Interface

```ts
export interface MountCalendarOptions {
  containerId: string;           // id of an existing, empty container element
  initialYear?: number;          // default: current year
  initialMonth?: number;         // default: current month, 1-based (1 = January)
  onMonthChange?: (year: number, month: number) => void;  // fires on mount and on prev/next
  onDayClick?: (year: number, month: number, day: number) => void; // highlighted days only
}

export interface CalendarController {
  getYear(): number;
  getMonth(): number;                          // 1-based
  // days-of-month (1-31); replaces the previous set. forYear/forMonth are
  // REQUIRED (not inferred) -- a call whose forYear/forMonth no longer
  // match getYear()/getMonth() (the calendar has since navigated away) is
  // a silent no-op. See FR-3 and DESIGN.md's "Stale-month guarding".
  setHighlightedDays(days: number[], forYear: number, forMonth: number): void;
  setSelectedDay(day: number | null): void;     // visual selection only, no callback
  goToMonth(year: number, month: number): void; // programmatic navigation; fires onMonthChange
}

export function mountCalendar(config: MountCalendarOptions): CalendarController;
```

## Functional requirements

- **FR-1**: Renders a month grid for `initialYear`/`initialMonth` (default: today's year/month) —
  a header (previous-month button, "<Month> <Year>" label, next-month button), a weekday header
  row (Sun–Sat), and one cell per day of the month, with leading blank cells so day 1 aligns under
  its correct weekday. Day count and first-weekday offset are computed via `moment`, not
  hand-rolled date math.
- **FR-2**: `onMonthChange(year, month)` fires once on mount (for the initial month) and once per
  prev/next click or `goToMonth()` call, **before** the grid for the new month is drawn — so a
  caller's `setHighlightedDays()` response (typically from an async search kicked off inside its
  own `onMonthChange` handler) applies to the month the user is currently looking at, not a stale
  previous one.
- **FR-3**: `setHighlightedDays(days, forYear, forMonth)` replaces the previously-highlighted set
  (not additive) and applies a dedicated CSS class (`.calendar-day-has-recording`) to exactly those
  day cells — but only if `forYear`/`forMonth` still match the calendar's current
  `getYear()`/`getMonth()`; otherwise it's a silent no-op. `forYear`/`forMonth` are required, not
  inferred, precisely so a caller's async search resolving late (after the user already clicked
  next) can be matched against the month it was actually issued for and dropped rather than
  painting stale highlights onto whatever month is now showing.
- **FR-4**: Only highlighted day cells are clickable — a day with no `.calendar-day-has-recording`
  class does not fire `onDayClick` and is visually non-interactive (no pointer cursor, no
  hover state).
- **FR-5**: `onDayClick(year, month, day)` fires once per click on a highlighted day cell, with the
  year/month the calendar is currently showing (not the possibly-stale value at the time
  `setHighlightedDays()` was called).
- **FR-6**: `setSelectedDay(day)` visually marks one day cell as selected (a second, distinct CSS
  class) — purely cosmetic, does not fire `onDayClick`/`onMonthChange`, and does not affect which
  days are clickable.
- **FR-7 (idempotency)**: a second `mountCalendar()` call for the same `containerId` is a no-op
  past the first call (guarded by `data-calendar-mounted`, matching `switch`/`disclosure`'s own
  convention) — the returned controller still works correctly against the already-mounted DOM.
- **FR-8 (dynamic render, documented exception)**: unlike `mountSwitch()`/`mountDisclosure()`,
  `mountCalendar()` generates all of its own markup into an initially-empty container — see
  [MRD.md](MRD.md)/[DESIGN.md](DESIGN.md) for why this doesn't follow the pure
  progressive-enhancement pattern those two use.

## Non-functional requirements

- **NFR-1 (no SUNAPI/network awareness)**: this component makes no network calls and imports
  nothing SUNAPI-related — every date computation is local, every highlight comes from the
  caller's `setHighlightedDays()`.
- **NFR-2 (no new dependency)**: uses `moment` (already a `package.json` dependency, already used
  elsewhere in `src/shared-v2/playback.ts`) for date math; no new package.
- **NFR-3 (keyboard/basic accessibility)**: prev/next are real `<button>` elements (native
  keyboard activation); highlighted day cells are focusable and activate on `Enter`/`Space`, not
  click-only.
