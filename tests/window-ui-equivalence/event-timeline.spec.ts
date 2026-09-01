// docs/event-timeline-component/TC.md's TC-1..TC-9 -- src/component/
// event-timeline/'s own behavior (zoom/pan/select/Hide/re-mount), exercised
// through src/shared-v2/'s FR-7.6 Playback timeline integration. New-page
// only (NEW_URL) -- src/shared/'s own timeline is unaffected by this
// component and still uses vis.Timeline, so there is no old-page equivalent
// to compare against here (see docs/window-ui/TC.md's TC-18 for the one
// cross-page item-count check that still applies).

import { test, expect, Page } from '@playwright/test';
import { NEW_URL } from '../../playwright.config';

/** Reaches a populated #timeline on the new page only -- the same manual
 *  Playback flow docs/window-ui/TC.md's TC-15..18 drive on both pages,
 *  trimmed to just the new page. */
async function openNewPageWithTimeline(browser: any): Promise<Page> {
  // A tall viewport, not the Playwright default (~720px) -- #right_panel's
  // own internal scroll area (the page body itself has overflow-y:hidden,
  // per CLAUDE.md) has grown taller than the default viewport across this
  // session's cumulative Playback-panel additions (Selected Time, Current
  // Time, Rule/Overlapped Id repositioning). Playwright's own click
  // auto-scroll doesn't reliably reach elements below the fold of that
  // specific nested scroll container -- found live (a Hide-button click
  // that dispatched fine via a raw DOM .click() had zero effect through
  // Playwright's own .click(), and elementFromPoint() at several targets'
  // computed centers returned null, i.e. outside the 720px viewport
  // entirely) -- rather than patching every interaction with an explicit
  // scrollIntoViewIfNeeded(), giving the whole page room to lay out
  // without needing internal scroll at all sidesteps the entire class of
  // flakiness in one place.
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 2200 } });
  const page = await context.newPage();
  await page.route('https://img.icons8.com/**', (route: any) => route.abort());
  await page.goto(NEW_URL);
  await page.waitForTimeout(200);

  await page.locator('#init').click();
  await page.waitForSelector('#datatable tbody tr:nth-child(1)');
  await page.locator('#datatable tbody tr').first().click();
  await page.locator('#username').fill('admin');
  await page.locator('#username').dispatchEvent('change');
  await page.locator('#password').fill('admin1234');
  await page.locator('#password').dispatchEvent('change');

  // v2.0 (docs/window-ui/SRS.md FR-7.1): #playback_control's own default
  // "1 day ending now" search auto-fires as soon as it becomes visible --
  // no button clicks needed to reach a populated #timeline any more.
  await page.locator('#playback_radio').evaluate((el: HTMLInputElement) => el.click());
  await page.waitForFunction(() => (document.getElementById('channel') as HTMLElement)?.tagName === 'SELECT');
  await page.waitForSelector('#timeline .event-timeline-overview-row .event-timeline-item');

  return page;
}

test.describe('Event Timeline component (new page only)', () => {
  test('TC-1/TC-3: overview row first, one detail row per distinct non-Normal type, all preset buttons start inactive', async ({ browser }) => {
    const page = await openNewPageWithTimeline(browser);

    const rows = page.locator('#timeline .event-timeline-row');
    await expect(rows.first()).toHaveClass(/event-timeline-overview-row/);

    const detailRowCount = await page.locator('#timeline .event-timeline-detail-row').count();
    expect(detailRowCount).toBeGreaterThan(0);

    const overviewItemCount = await page.locator('#timeline .event-timeline-overview-row .event-timeline-item').count();
    const totalItemCount = await page.locator('#timeline .event-timeline-item').count();
    expect(overviewItemCount).toBeGreaterThan(0);
    expect(totalItemCount).toBeGreaterThan(overviewItemCount);

    // Full data extent doesn't exactly match any fixed preset width, so
    // none should start active.
    await expect(page.locator('.event-timeline-preset-btn-active')).toHaveCount(0);

    await page.context().close();
  });

  test('TC-3: clicking a preset button re-fetches a fresh Timeline range instead of only re-zooming (v2.0, onRangePresetSelect)', async ({ browser }) => {
    // v2.0 (SRS.md FR-5): since playback.ts always supplies
    // onRangePresetSelect for this real integration, a preset click no
    // longer just toggles a local "active" class on already-loaded data --
    // it re-fetches [now-preset, now] and the widget is destroyed/
    // remounted with the fresh response (docs/event-timeline-component/
    // DESIGN.md's "not idempotent" pattern, FR-12). The pre-v2.0 local-
    // zoom-only fallback (no onRangePresetSelect provided) is exercised
    // directly at the component level, not through this app integration --
    // see SRS.md FR-5's own "if omitted" clause.
    const page = await openNewPageWithTimeline(browser);

    let timelineRequestUrl: string | null = null;
    page.on('request', (req) => {
      if (req.url().includes('msubmenu=timeline')) {
        timelineRequestUrl = req.url();
      }
    });

    const sixHourBtn = page.locator('.event-timeline-preset-btn', { hasText: /^6H$/ });
    await sixHourBtn.click();
    await page.waitForTimeout(500);

    expect(timelineRequestUrl).not.toBeNull();
    expect(await page.locator('#timeline .event-timeline').count()).toBe(1);
    expect(await page.locator('#timeline .event-timeline-item').count()).toBeGreaterThan(0);

    await page.context().close();
  });

  test('TC-4/TC-5: wheel zoom narrows the window (no preset stays active); a subsequent drag pans without changing the zoom factor', async ({ browser }) => {
    const page = await openNewPageWithTimeline(browser);
    const readout = page.locator('.event-timeline-zoom-readout');
    const rows = page.locator('#timeline .event-timeline-rows');
    const box = (await rows.boundingBox())!;

    const readoutBefore = await readout.textContent();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -400); // negative deltaY -> zoom in
    const readoutAfterZoom = await readout.textContent();
    expect(readoutAfterZoom).not.toBe(readoutBefore);
    await expect(page.locator('.event-timeline-preset-btn-active')).toHaveCount(0);

    const ticksBefore = await page.locator('.event-timeline-axis-tick').allTextContents();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();

    const readoutAfterPan = await readout.textContent();
    expect(readoutAfterPan).toBe(readoutAfterZoom); // pan must not change zoom factor
    const ticksAfter = await page.locator('.event-timeline-axis-tick').allTextContents();
    expect(ticksAfter).not.toEqual(ticksBefore);

    await page.context().close();
  });

  test('TC-6/TC-7: selecting an item populates the widget\'s own Selected Time, both Start and End Time set for every item (v1.18/v2.0)', async ({ browser }) => {
    // As of the v2.0 Playback search redesign (docs/window-ui/SRS.md
    // FR-11/event-timeline-component's own SRS FR-11), "Manual Start/End
    // Time" moved from #start_date/#end_date (outside the widget) into
    // this component's own Selected Time inputs -- #selected_start_date/
    // #selected_has_end_time/#selected_end_date/etc. Per the earlier v1.18
    // deviation (docs/window-ui/DESIGN.md), every item -- Normal-classed
    // included -- sets and enables both Start and End Time; the legacy
    // "Normal disables End Time" behavior is not reproduced.
    const page = await openNewPageWithTimeline(browser);

    const eventItem = page.locator('#timeline .event-timeline-item:not(.normal)').first();
    await eventItem.click();
    await expect(eventItem).toHaveClass(/event-timeline-item-selected/);
    expect(await page.locator('#selected_has_end_time').isChecked()).toBe(true);
    expect(await page.locator('#selected_end_date').isDisabled()).toBe(false);
    const startAfterEvent = await page.locator('#selected_start_date').inputValue();
    expect(startAfterEvent.length).toBeGreaterThan(0);

    const normalItem = page.locator('#timeline .event-timeline-overview-row .event-timeline-item.normal').first();
    await normalItem.click();
    await expect(normalItem).toHaveClass(/event-timeline-item-selected/);
    expect(await page.locator('#selected_has_end_time').isChecked()).toBe(true);
    expect(await page.locator('#selected_end_date').isDisabled()).toBe(false);

    await page.context().close();
  });

  test('TC-8: a detail row\'s Hide button hides just that row and toggles back on a second click', async ({ browser }) => {
    const page = await openNewPageWithTimeline(browser);

    const detailRow = page.locator('#timeline .event-timeline-detail-row').first();
    const hideBtn = detailRow.locator('.event-timeline-hide-btn');

    await expect(detailRow).not.toHaveClass(/event-timeline-row-hidden/);
    await hideBtn.click();
    await expect(detailRow).toHaveClass(/event-timeline-row-hidden/);
    await expect(hideBtn).toHaveText('Show');

    await hideBtn.click();
    await expect(detailRow).not.toHaveClass(/event-timeline-row-hidden/);
    await expect(hideBtn).toHaveText('Hide');

    await page.context().close();
  });

  test('TC-9: searching twice in a row replaces the widget instead of stacking a second one', async ({ browser }) => {
    const page = await openNewPageWithTimeline(browser);

    const firstItemCount = await page.locator('#timeline .event-timeline-item').count();
    expect(await page.locator('#timeline .event-timeline').count()).toBe(1);

    // v2.0: a preset click is this app's own re-search trigger now (no
    // #search_timeline button any more) -- exercises the exact same
    // destroy()-before-remount path TC-9 is actually about.
    await page.locator('.event-timeline-preset-btn', { hasText: /^1D$/ }).click();
    await page.waitForTimeout(500);

    expect(await page.locator('#timeline .event-timeline').count()).toBe(1);
    const secondItemCount = await page.locator('#timeline .event-timeline-item').count();
    expect(secondItemCount).toBe(firstItemCount);

    await page.context().close();
  });
});
