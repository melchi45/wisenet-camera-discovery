// Reusable month-view calendar UI component -- see docs/calendar-component/
// (MRD/PRD/SRS/DESIGN/TC) for the full spec. src/shared-v2/-only (no
// src/shared/ consumer) -- used by src/shared-v2/modules/playbackCalendar.ts
// for docs/window-ui/SRS.md's FR-7.8.
//
// Unlike src/component/switch/ and src/component/disclosure/, this does NOT
// follow pure progressive enhancement -- the grid is inherently data-driven
// (day count/weekday offset/highlighted days differ every month), so
// mountCalendar() mounts into an initially-empty container and generates
// the grid itself, re-rendering on every navigation. See MRD.md/DESIGN.md
// for why this is still consistent with this codebase's broader
// conventions (the discovery table/topology and Video Source/Profile list
// already render dynamically from data for the same reason).

import moment from 'moment';

export interface MountCalendarOptions {
  /** id of an existing, empty container element. */
  containerId: string;
  /** Default: current year. */
  initialYear?: number;
  /** Default: current month, 1-based (1 = January). */
  initialMonth?: number;
  /** Fires once on mount (for the initial month) and once per prev/next
   *  click or goToMonth() call, BEFORE the new month's grid is drawn. */
  onMonthChange?: (year: number, month: number) => void;
  /** Fires once per click on a highlighted day cell. */
  onDayClick?: (year: number, month: number, day: number) => void;
}

export interface CalendarController {
  getYear(): number;
  getMonth(): number;
  /** Replaces the previously-highlighted set for (forYear, forMonth) --
   *  required, not inferred, so a caller's async search response can be
   *  matched against whichever month it was actually issued for. A call
   *  for a month the calendar has since navigated away from (forYear/
   *  forMonth no longer match getYear()/getMonth()) is a silent no-op --
   *  see DESIGN.md's "Stale-month guarding". */
  setHighlightedDays(days: number[], forYear: number, forMonth: number): void;
  /** Visual-only; does not fire onDayClick/onMonthChange. */
  setSelectedDay(day: number | null): void;
  /** Programmatic navigation; fires onMonthChange like prev/next do. */
  goToMonth(year: number, month: number): void;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Idempotency (SRS FR-7) can't just skip re-attaching listeners the way
// switch/disclosure do -- unlike those two, this component's state (year/
// month/highlighted days) lives in JS closures, not read back from live
// DOM attributes, so a second mountCalendar() call for the same container
// must return the FIRST call's actual controller, not construct a new one
// bound to fresh (wrong) closure state. A module-level cache, keyed by the
// container element, does that.
const mountedControllers = new WeakMap<HTMLElement, CalendarController>();

/** Idempotent -- a second call for the same `containerId` returns the same
 *  controller the first call built, per the note above (same spirit as
 *  src/component/switch/'s mountSwitch() and src/component/disclosure/'s
 *  mountDisclosure(), which use a `data-*-mounted` DOM flag instead since
 *  their state lives on the DOM itself, not in a closure). */
export function mountCalendar(config: MountCalendarOptions): CalendarController {
  const container = document.getElementById(config.containerId);
  if (container === null) {
    throw new Error(`mountCalendar: "${config.containerId}" does not exist`);
  }

  const existing = mountedControllers.get(container);
  if (existing) {
    return existing;
  }

  const today = new Date();
  let year = config.initialYear ?? today.getFullYear();
  let month = config.initialMonth ?? today.getMonth() + 1;
  let highlightedDays: Set<number> = new Set();
  let selectedDay: number | null = null;

  function render(): void {
    container!.replaceChildren();

    const header = document.createElement('div');
    header.className = 'calendar-header';

    const prevButton = document.createElement('button');
    prevButton.type = 'button';
    prevButton.className = 'calendar-nav-button calendar-nav-prev';
    prevButton.textContent = '<';
    prevButton.addEventListener('click', () => goToMonth(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1));

    const label = document.createElement('span');
    label.className = 'calendar-month-label';
    label.textContent = `${MONTH_LABELS[month - 1]} ${year}`;

    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.className = 'calendar-nav-button calendar-nav-next';
    nextButton.textContent = '>';
    nextButton.addEventListener('click', () => goToMonth(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1));

    header.append(prevButton, label, nextButton);
    container!.append(header);

    const weekdayRow = document.createElement('div');
    weekdayRow.className = 'calendar-weekday-row';
    for (const w of WEEKDAY_LABELS) {
      const cell = document.createElement('span');
      cell.className = 'calendar-weekday-cell';
      cell.textContent = w;
      weekdayRow.append(cell);
    }
    container!.append(weekdayRow);

    const grid = document.createElement('div');
    grid.className = 'calendar-grid';

    const daysInMonth = moment({ year, month: month - 1 }).daysInMonth();
    const firstWeekday = moment({ year, month: month - 1, day: 1 }).day();

    for (let i = 0; i < firstWeekday; i += 1) {
      const blank = document.createElement('span');
      blank.className = 'calendar-day-cell calendar-day-blank';
      grid.append(blank);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const cell = document.createElement('span');
      cell.className = 'calendar-day-cell';
      cell.textContent = String(day);
      cell.dataset.day = String(day);

      const hasRecording = highlightedDays.has(day);
      if (hasRecording) {
        cell.classList.add('calendar-day-has-recording');
        cell.tabIndex = 0;
      }
      if (selectedDay === day) {
        cell.classList.add('calendar-day-selected');
      }

      if (hasRecording && config.onDayClick) {
        const fire = () => config.onDayClick!(year, month, day);
        cell.addEventListener('click', fire);
        cell.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            fire();
          }
        });
      }

      grid.append(cell);
    }

    container!.append(grid);
  }

  function goToMonth(newYear: number, newMonth: number): void {
    year = newYear;
    month = newMonth;
    highlightedDays = new Set();
    selectedDay = null;
    if (config.onMonthChange) {
      config.onMonthChange(year, month);
    }
    render();
  }

  render();
  if (config.onMonthChange) {
    config.onMonthChange(year, month);
  }

  const controller: CalendarController = {
    getYear: () => year,
    getMonth: () => month,
    setHighlightedDays: (days: number[], forYear: number, forMonth: number) => {
      if (forYear !== year || forMonth !== month) {
        return; // stale -- calendar has since navigated to a different month
      }
      highlightedDays = new Set(days);
      render();
    },
    setSelectedDay: (day: number | null) => {
      selectedDay = day;
      render();
    },
    goToMonth,
  };
  mountedControllers.set(container, controller);
  return controller;
}
