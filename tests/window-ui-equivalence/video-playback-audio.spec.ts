// TC-14..TC-19 -- SRS FR-6 (Video Control state machine), FR-7 (Playback),
// FR-8 (Audio). See docs/window-ui/TC.md's "Not verifiable in this
// environment" section for why FR-6/FR-8 use synthetic player events
// instead of a real stream.
import { test, expect } from '@playwright/test';
import {
  openBothPages, startDiscoveryBoth, fillCredentialsBoth, clickCheckboxBoth,
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

test.describe('FR-7 Playback (mock SUNAPI)', () => {
  let pages: BothPages;
  test.beforeEach(async ({ browser }) => {
    pages = await openBothPages(browser);
    await startDiscoveryBoth(pages);
    await pages.oldPage.locator('#datatable tbody tr').first().click();
    await pages.newPage.locator('#datatable tbody tr').first().click();
    await fillCredentialsBoth(pages, 'admin', 'admin1234');
    await clickCheckboxBoth(pages, '#use_sunapi_client_checkbox');
    await pages.oldPage.waitForFunction(() => (document.getElementById('channel') as HTMLElement)?.tagName === 'SELECT');
    await pages.newPage.waitForFunction(() => (document.getElementById('channel') as HTMLElement)?.tagName === 'SELECT');

    // #playback_control (search_overlapped_id/search_date/search_timeline/
    // start&end date fields) starts display:none -- FR-6.3's
    // onchangeplaytype() only reveals it once "Playback" is selected over
    // the default "Live" radio.
    await pages.oldPage.locator('#playback_radio').evaluate((el: HTMLInputElement) => el.click());
    await pages.newPage.locator('#playback_radio').evaluate((el: HTMLInputElement) => el.click());
  });
  test.afterEach(async () => { await pages.close(); });

  test('TC-15: Search Overlapped Id / Search Date match', async () => {
    await pages.oldPage.locator('#search_overlapped_id').click();
    await pages.newPage.locator('#search_overlapped_id').click();
    await pages.oldPage.waitForTimeout(500);
    await pages.newPage.waitForTimeout(500);
    await expectSameState(pages, '#overlapped_id_area', ['innerHTML']);

    await pages.oldPage.locator('#search_date').click();
    await pages.newPage.locator('#search_date').click();
    await pages.oldPage.waitForTimeout(500);
    await pages.newPage.waitForTimeout(500);
    await expectSameState(pages, '#start_date', ['value', 'min', 'max']);
    await expectSameState(pages, '#end_date', ['value', 'min', 'max']);
  });

  test('TC-16: 1 Day/3 Month toggle + Search Timeline match', async () => {
    // #search_timeline starts disabled -- only search_date()'s own
    // calendar-search response handler enables it (FR-7.2), matching the
    // real UI workflow (TC.md's TC-15 runs before TC-16).
    await pages.oldPage.locator('#search_date').click();
    await pages.newPage.locator('#search_date').click();
    await pages.oldPage.waitForFunction(() => !(document.getElementById('search_timeline') as HTMLButtonElement).disabled);
    await pages.newPage.waitForFunction(() => !(document.getElementById('search_timeline') as HTMLButtonElement).disabled);

    await pages.oldPage.locator('#search_timeline_range_threemonth').click();
    await pages.newPage.locator('#search_timeline_range_threemonth').click();
    await expectSameState(pages, '#search_timeline_range_oneday', ['ariaSelected']);
    await expectSameState(pages, '#search_timeline_range_threemonth', ['ariaSelected']);

    await pages.oldPage.locator('#search_timeline').click();
    await pages.newPage.locator('#search_timeline').click();
    await pages.oldPage.waitForTimeout(500);
    await pages.newPage.waitForTimeout(500);
    await expectSameState(pages, '#timeline', ['style']);
  });

  test('TC-18: timeline renders the same real item count on both pages at realistic (~150-item) volume', async () => {
    // This is the test that caught two real bugs live against the mock
    // server's ~150-item fixture (docs/window-ui/DESIGN.md's "Deviations
    // from legacy behavior", retracted entry): (1) src/shared-v2/'s
    // missing `.TimeLineSearchResults` envelope-unwrap, which rendered
    // nothing at all against real data; and (2) after fixing that, a
    // `fit()` call that "looked like" a fix against a 3-item fixture but
    // actively broke rendering at this volume. Neither page needs any
    // explicit window-fitting call -- vis.Timeline auto-fits to the real
    // item range on setItems() by itself.
    await pages.oldPage.locator('#search_date').click();
    await pages.newPage.locator('#search_date').click();
    await pages.oldPage.waitForFunction(() => !(document.getElementById('search_timeline') as HTMLButtonElement).disabled);
    await pages.newPage.waitForFunction(() => !(document.getElementById('search_timeline') as HTMLButtonElement).disabled);

    await pages.oldPage.locator('#search_timeline_range_threemonth').click();
    await pages.newPage.locator('#search_timeline_range_threemonth').click();
    await pages.oldPage.locator('#search_timeline').click();
    await pages.newPage.locator('#search_timeline').click();
    await pages.oldPage.waitForTimeout(500);
    await pages.newPage.waitForTimeout(500);

    const oldItemCount = await pages.oldPage.locator('#timeline .vis-item').count();
    const newItemCount = await pages.newPage.locator('#timeline .vis-item').count();
    expect(oldItemCount).toBeGreaterThan(0);
    expect(newItemCount).toBe(oldItemCount);
  });

  test('TC-17: #support_end_time toggle shows/hides #end_date identically', async () => {
    await expectSameState(pages, '#end_date', ['disabled']);
    await clickCheckboxBoth(pages, '#support_end_time');
    await expectSameState(pages, '#end_date', ['disabled']);
    const oldEndTime = await pages.oldPage.evaluate(() => (document.querySelector('rtsp-over-websocket') as any).endTime);
    const newEndTime = await pages.newPage.evaluate(() => (document.querySelector('rtsp-over-websocket') as any).endTime);
    expect(newEndTime).toBe(oldEndTime);
  });
});
