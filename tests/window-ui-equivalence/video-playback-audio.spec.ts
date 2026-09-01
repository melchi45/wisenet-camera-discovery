// TC-14..TC-19 -- SRS FR-6 (Video Control state machine), FR-7 (Playback),
// FR-8 (Audio). See docs/window-ui/TC.md's "Not verifiable in this
// environment" section for why FR-6/FR-8 use synthetic player events
// instead of a real stream.
import { test, expect } from '@playwright/test';
import {
  openBothPages, startDiscoveryBoth, fillCredentialsBoth,
  expectSameState, BothPages,
} from './support';

/** Dispatches a synthetic 'statechange' CustomEvent on the one
 *  <rtsp-over-websocket> element, on both pages -- substitutes for a real
 *  stream reaching that readyState (TC.md's documented boundary). */
async function dispatchStatechange(pages: BothPages, stateName: 'PLAYING' | 'STOPPED' | 'PAUSED' | 'STEP'): Promise<void> {
  for (const page of [pages.oldPage, pages.newPage]) {
    await page.evaluate((stateName) => {
      const el = document.querySelector('rtsp-over-websocket') as any;
      const readyState = (window as any).RTSPOverWebSocketPlayState[stateName];
      el.dispatchEvent(new CustomEvent('statechange', { detail: { readyState, elementId: el.id } }));
    }, stateName);
  }
}

const BUTTON_IDS = ['play_button', 'stop_button', 'pause_button', 'resume_button', 'capture_button', 'capture2_button'];

test.describe('FR-6 Video Control state machine (synthetic statechange)', () => {
  let pages: BothPages;
  test.beforeEach(async ({ browser }) => { pages = await openBothPages(browser); });
  test.afterEach(async () => { await pages.close(); });

  for (const stateName of ['PLAYING', 'PAUSED', 'STEP'] as const) {
    test(`TC-14: statechange(${stateName}) leaves matching button-disabled states`, async () => {
      await dispatchStatechange(pages, stateName);
      for (const id of BUTTON_IDS) {
        await expectSameState(pages, '#' + id, ['disabled']);
      }
    });
  }

  test('TC-14: statechange(STOPPED) -- NOT cross-page equal, by design (documented deviation)', async () => {
    // The original's STOPPED branch does an unguarded
    // document.getElementById("timestamp_date").remove() (no #timestamp_date
    // exists yet -- it's only lazily created by ontimestamp() in 'live'
    // mode) and throws, aborting the rest of that branch -- see
    // docs/window-ui/DESIGN.md's "Deviations from legacy behavior". The old
    // page is EXPECTED to throw here and leave button state stuck at
    // whatever it was before STOPPED; the new page uses ?.remove() and must
    // reach the full, correct STOPPED state. This test asserts exactly
    // that asymmetry, not equality.
    let oldThrew = false;
    try {
      await pages.oldPage.evaluate(() => {
        const el = document.querySelector('rtsp-over-websocket') as any;
        const readyState = (window as any).RTSPOverWebSocketPlayState.STOPPED;
        el.dispatchEvent(new CustomEvent('statechange', { detail: { readyState, elementId: el.id } }));
      });
    } catch {
      oldThrew = true;
    }
    expect(oldThrew).toBe(true);

    await pages.newPage.evaluate(() => {
      const el = document.querySelector('rtsp-over-websocket') as any;
      const readyState = (window as any).RTSPOverWebSocketPlayState.STOPPED;
      el.dispatchEvent(new CustomEvent('statechange', { detail: { readyState, elementId: el.id } }));
    });
    // Not compared against old (old aborted before setting these) --
    // assert the new page's own correct STOPPED-state values directly.
    const newPlayDisabled = await pages.newPage.locator('#play_button').evaluate((el: HTMLButtonElement) => el.disabled);
    const newStopDisabled = await pages.newPage.locator('#stop_button').evaluate((el: HTMLButtonElement) => el.disabled);
    expect(newPlayDisabled).toBe(false);
    expect(newStopDisabled).toBe(true);
  });
});

test.describe('FR-8 Audio (synthetic player events)', () => {
  let pages: BothPages;
  test.beforeEach(async ({ browser }) => { pages = await openBothPages(browser); });
  test.afterEach(async () => { await pages.close(); });

  test('TC-19: changemute/changevolume sync matches', async () => {
    for (const page of [pages.oldPage, pages.newPage]) {
      await page.evaluate(() => {
        const el = document.querySelector('rtsp-over-websocket') as any;
        el.dispatchEvent(new CustomEvent('changemute', { detail: { status: true } }));
      });
    }
    await expectSameState(pages, '#unmute', ['disabled']);
    await expectSameState(pages, '#mute', ['disabled']);

    for (const page of [pages.oldPage, pages.newPage]) {
      await page.evaluate(() => {
        const el = document.querySelector('rtsp-over-websocket') as any;
        el.dispatchEvent(new CustomEvent('changevolume', { detail: { volume: 42 } }));
      });
    }
    await expectSameState(pages, '#volume', ['value']);
  });
});

// DEVIATION from legacy behavior, v2.0 (docs/window-ui/SRS.md FR-7.1-7.4,
// DESIGN.md): the old page's typed-date-range manual search flow
// (#search_overlapped_id/#search_date/#start_date/#end_date/
// #support_end_time/1 Day-3 Month toggle/#search_timeline) has no
// equivalent on the new page any more -- search is driven entirely by the
// shared Event Timeline widget's own 1H/6H/1D/1W/1M/1Y preset buttons
// (anchored to "now"), with a default "1 day ending now" search
// auto-firing the moment #playback_control becomes visible. "Manual
// Start/End Time" moved into that same widget as its own Selected Time
// inputs (#selected_start_date/#selected_has_end_time/etc.), populated by
// clicking a timeline item rather than typed in. Reported directly by the
// user. TC-15/16/17/18 below are consequently NEW-PAGE-ONLY for their new-
// page halves (the old page's own legacy flow is untouched and unaffected,
// asserted separately where it still applies) -- no single-page equality
// assertion is meaningful across a UI this different any more.
test.describe('FR-7 Playback (mock SUNAPI)', () => {
  let pages: BothPages;
  test.beforeEach(async ({ browser }) => {
    pages = await openBothPages(browser);
    await startDiscoveryBoth(pages);
    await pages.oldPage.locator('#datatable tbody tr').first().click();
    await pages.newPage.locator('#datatable tbody tr').first().click();
    await fillCredentialsBoth(pages, 'admin', 'admin1234');

    // #playback_control starts display:none -- FR-6.3's onchangeplaytype()
    // only reveals it once "Playback" is selected over the default "Live"
    // radio.
    await pages.oldPage.locator('#playback_radio').evaluate((el: HTMLInputElement) => el.click());
    await pages.newPage.locator('#playback_radio').evaluate((el: HTMLInputElement) => el.click());

    // Old page (src/shared/, untouched): its own manual flow needs an
    // explicit click to self-init a SUNAPI session (`if (!sunapiClient)
    // initSunapiManager()` inside search_overlapped_id()). New page
    // (v2.0): #playback_control's own default "1 day ending now" search
    // auto-fires as soon as it's visible, which self-inits SUNAPI on its
    // own -- no click needed, exactly per the redesign above.
    await pages.oldPage.locator('#search_overlapped_id').click();
    await pages.oldPage.waitForFunction(() => (document.getElementById('channel') as HTMLElement)?.tagName === 'SELECT');
    await pages.newPage.waitForFunction(() => (document.getElementById('channel') as HTMLElement)?.tagName === 'SELECT');
  });
  test.afterEach(async () => { await pages.close(); });

  test('TC-15: new page auto-fires a default "1 day ending now" search on entering Playback (new page only)', async () => {
    await pages.newPage.waitForTimeout(500);
    // FR-15 (event-timeline-component's SRS): Overlapped Id now renders
    // inside the Event Timeline widget's own toolbar, not a standalone
    // #overlapped_id_area -- moved directly per the user's request.
    const overlappedIdHtml = await pages.newPage.locator('#timeline .event-timeline-overlapped-id').innerHTML();
    expect(overlappedIdHtml).toContain('select');
    await expect(pages.newPage.locator('#timeline')).toBeVisible();
    expect(await pages.newPage.locator('#timeline .event-timeline-item').count()).toBeGreaterThan(0);
  });

  test('TC-16: Event Timeline preset buttons re-fetch a fresh Timeline range instead of only re-zooming (new page only)', async () => {
    await pages.newPage.waitForTimeout(500);
    let timelineRequestUrl: string | null = null;
    pages.newPage.on('request', (req) => {
      if (req.url().includes('msubmenu=timeline')) {
        timelineRequestUrl = req.url();
      }
    });
    await pages.newPage.locator('.event-timeline-preset-btn', { hasText: '6H' }).click();
    await pages.newPage.waitForTimeout(500);
    expect(timelineRequestUrl).not.toBeNull();
    expect(timelineRequestUrl!).toContain('msubmenu=timeline');
  });

  test('TC-18: timeline renders a realistic (~150-item) item count on both pages', async () => {
    // This is the test that originally caught two real bugs live against
    // the mock server's ~150-item fixture (docs/window-ui/DESIGN.md's
    // "Deviations from legacy behavior", retracted entry) -- kept at this
    // volume on both pages even though how each page reaches it has
    // diverged (old page's own untouched "3 Month" button; new page's own
    // "1Y" preset, hitting the same static fixture).
    await pages.oldPage.locator('#search_date').click();
    await pages.oldPage.waitForFunction(() => !(document.getElementById('search_timeline') as HTMLButtonElement).disabled);
    await pages.oldPage.locator('#search_timeline_range_threemonth').click();
    await pages.oldPage.locator('#search_timeline').click();
    await pages.oldPage.waitForTimeout(500);

    await pages.newPage.locator('.event-timeline-preset-btn', { hasText: '1Y' }).click();
    await pages.newPage.waitForTimeout(500);

    const oldItemCount = await pages.oldPage.locator('#timeline .vis-item').count();
    expect(oldItemCount).toBeGreaterThan(0);

    // FR-7.6 v1.16 (docs/window-ui/SRS.md/DESIGN.md): the new page no
    // longer uses vis.Timeline/vis-* classes at all -- it's rendered by
    // src/component/event-timeline/'s own custom widget, whose "ALL
    // EVENTS" overview row alone still matches the old page's total item
    // count exactly (every result renders exactly once there, same as the
    // old page's Normal+Event split always did). Distinct Rule#/event-type
    // items additionally get a second copy of the same item placed into
    // their own per-Rule detail row (so a channel with multiple configured
    // rules can tell them apart), so the new page's grand total item count
    // is intentionally higher than the old page's -- not a mismatch. See
    // docs/event-timeline-component/TC.md for that component's own
    // (new-page-only) zoom/pan/select/Hide test cases, not duplicated here.
    const newOverviewItemCount = await pages.newPage.locator('#timeline .event-timeline-overview-row .event-timeline-item').count();
    const newTotalItemCount = await pages.newPage.locator('#timeline .event-timeline-item').count();
    expect(newOverviewItemCount).toBe(oldItemCount);
    // The mock fixture always includes some non-Normal (MotionDetection)
    // events, so at least one extra per-Rule row item is expected here too.
    expect(newTotalItemCount).toBeGreaterThan(newOverviewItemCount);
  });

  test('TC-17: Selected Time\'s "Has End Time" checkbox clears/restores the player\'s endTime (new page only)', async () => {
    await pages.newPage.waitForTimeout(500);
    await pages.newPage.locator('#selected_has_end_time').uncheck();
    const endTimeAfterUncheck = await pages.newPage.evaluate(() => (document.querySelector('rtsp-over-websocket') as any).endTime);
    expect(endTimeAfterUncheck).toBeNull();

    await pages.newPage.locator('#selected_has_end_time').check();
    const endTimeAfterCheck = await pages.newPage.evaluate(() => (document.querySelector('rtsp-over-websocket') as any).endTime);
    expect(endTimeAfterCheck).not.toBeNull();
  });
});
