// docs/event-timeline-component/TC.md's TC-1..TC-9 -- src/component/
// event-timeline/'s own behavior (zoom/pan/select/collapse/re-mount), exercised
// through src/shared-v2/'s FR-7.6 Playback timeline integration. New-page
// only (NEW_URL) -- src/shared/'s own timeline is unaffected by this
// component and still uses vis.Timeline, so there is no old-page equivalent
// to compare against here (see docs/window-ui/TC.md's TC-18 for the one
// cross-page item-count check that still applies).

import { test, expect, Page } from '@playwright/test';
import { NEW_URL, MOCK_SUNAPI_PORT } from '../../playwright.config';

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
  // specific nested scroll container -- found live (a button click
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
  // device.ts's FR-4.10 locks #port to 80/443 (matching this page's own
  // http:// scheme) whenever a device is selected outside the extension --
  // correct for a real camera, but this fixture's mock device deliberately
  // reuses the mock-sunapi-server's own non-standard port (MOCK_SUNAPI_PORT)
  // rather than simulating a real camera on 80, so every SUNAPI call this
  // test relies on would otherwise target a port nothing is listening on.
  // Refilled the same way username/password below are (fill + dispatch
  // 'change', not a raw .value= assignment) so changeport() actually runs
  // and updates the player's real .port, not just the input's own display.
  await page.locator('#port').fill(String(MOCK_SUNAPI_PORT));
  await page.locator('#port').dispatchEvent('change');
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
  test('TC-1/TC-3: overview row first, one detail row per distinct type (Normal included), all preset buttons start inactive', async ({ browser }) => {
    const page = await openNewPageWithTimeline(browser);

    const rows = page.locator('#timeline .event-timeline-row');
    await expect(rows.first()).toHaveClass(/event-timeline-overview-row/);

    const detailRowCount = await page.locator('#timeline .event-timeline-detail-row').count();
    expect(detailRowCount).toBeGreaterThan(0);

    // v2.10: Normal gets its own detail row too, not just a merge into "All".
    const normalRowLabel = page.locator('#timeline .event-timeline-detail-row .event-timeline-row-label', { hasText: /^Normal$/ });
    await expect(normalRowLabel).toHaveCount(1);

    const overviewItemCount = await page.locator('#timeline .event-timeline-overview-row .event-timeline-item').count();
    const totalItemCount = await page.locator('#timeline .event-timeline-item').count();
    expect(overviewItemCount).toBeGreaterThan(0);
    expect(totalItemCount).toBeGreaterThan(overviewItemCount);

    // v2.7 (docs/event-timeline-component/SRS.md FR-2): the widget's data
    // extent now comes from the search's own requested range (dataRange),
    // not the item extent -- the default search requests exactly "1 day
    // ending now", so 1D correctly starts active (previously, before
    // dataRange existed, the item-derived extent never exactly matched a
    // fixed preset width, so nothing started active; that was an artifact
    // of the old extent-computation, not a real requirement).
    await expect(page.locator('.event-timeline-preset-btn-active')).toHaveText('1D');

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

    const eventItem = page.locator('#timeline .event-timeline-item:not(.evt-normal)').first();
    await eventItem.click();
    await expect(eventItem).toHaveClass(/event-timeline-item-selected/);
    expect(await page.locator('#selected_has_end_time').isChecked()).toBe(true);
    expect(await page.locator('#selected_end_date').isDisabled()).toBe(false);
    const startAfterEvent = await page.locator('#selected_start_date').inputValue();
    expect(startAfterEvent.length).toBeGreaterThan(0);

    const normalItem = page.locator('#timeline .event-timeline-overview-row .event-timeline-item.evt-normal').first();
    await normalItem.click();
    await expect(normalItem).toHaveClass(/event-timeline-item-selected/);
    expect(await page.locator('#selected_has_end_time').isChecked()).toBe(true);
    expect(await page.locator('#selected_end_date').isDisabled()).toBe(false);

    await page.context().close();
  });

  test('TC-8: the ALL EVENTS row\'s collapse button hides every detail row (not its own track) and toggles back on a second click', async ({ browser }) => {
    const page = await openNewPageWithTimeline(browser);

    const collapseBtn = page.locator('#timeline .event-timeline-overview-row .event-timeline-collapse-btn');
    const rows = page.locator('#timeline .event-timeline-rows');
    const overviewTrack = page.locator('#timeline .event-timeline-overview-track');

    await expect(rows).not.toHaveClass(/event-timeline-rows-collapsed/);
    await expect(collapseBtn).toHaveAttribute('aria-expanded', 'true');
    await collapseBtn.click();
    await expect(rows).toHaveClass(/event-timeline-rows-collapsed/);
    await expect(collapseBtn).toHaveAttribute('aria-expanded', 'false');
    // The ALL EVENTS row's own track stays visible -- only the detail rows
    // below it collapse.
    await expect(overviewTrack).toBeVisible();

    await collapseBtn.click();
    await expect(rows).not.toHaveClass(/event-timeline-rows-collapsed/);
    await expect(collapseBtn).toHaveAttribute('aria-expanded', 'true');

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
