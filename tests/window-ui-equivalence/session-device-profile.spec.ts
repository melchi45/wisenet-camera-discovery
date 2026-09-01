// TC-7..TC-13 -- SRS FR-3 (Session), FR-4 (Device), FR-5 (Video Source/Profile List).
import { test, expect } from '@playwright/test';
import {
  openBothPages, startDiscoveryBoth, fillCredentialsBoth, clickCheckboxBoth,
  expectSameState, BothPages,
} from './support';

/** Common setup shared by TC-8 through TC-13: discover, select the camera
 *  row, fill credentials -- everything short of turning SUNAPI on. */
async function setupSelectedDevice(browser: any): Promise<BothPages> {
  const pages = await openBothPages(browser);
  await startDiscoveryBoth(pages);
  await pages.oldPage.locator('#datatable tbody tr').first().click();
  await pages.newPage.locator('#datatable tbody tr').first().click();
  await fillCredentialsBoth(pages, 'admin', 'admin1234');
  return pages;
}

test.describe('FR-3 Session', () => {
  let pages: BothPages;
  test.beforeEach(async ({ browser }) => {
    pages = await openBothPages(browser);
    await startDiscoveryBoth(pages);
  });
  test.afterEach(async () => { await pages.close(); });

  test('TC-7: #player_list has one option and change matches (docs/control-panel-data-binding.md §2)', async () => {
    await expectSameState(pages, '#player_list', ['value']);
    const oldOptions = await pages.oldPage.locator('#player_list option').count();
    const newOptions = await pages.newPage.locator('#player_list option').count();
    expect(newOptions).toBe(oldOptions);

    await pages.oldPage.locator('#player_list').dispatchEvent('change');
    await pages.newPage.locator('#player_list').dispatchEvent('change');
    await expectSameState(pages, '#user', ['style']);
    await expectSameState(pages, '#device', ['style']);
    await expectSameState(pages, '#play_button', ['disabled']);
    await expectSameState(pages, '#stop_button', ['disabled']);
  });

  test('TC-8: username/password/statistics writes match', async () => {
    await fillCredentialsBoth(pages, 'admin', 'admin1234');
    const oldUser = await pages.oldPage.evaluate(() => (document.querySelector('rtsp-over-websocket') as any).username);
    const newUser = await pages.newPage.evaluate(() => (document.querySelector('rtsp-over-websocket') as any).username);
    expect(newUser).toBe(oldUser);

    await pages.oldPage.locator('#statistics').evaluate((el: HTMLInputElement) => { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await pages.newPage.locator('#statistics').evaluate((el: HTMLInputElement) => { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); });
    const oldStats = await pages.oldPage.evaluate(() => (document.querySelector('rtsp-over-websocket') as any).statistics);
    const newStats = await pages.newPage.evaluate(() => (document.querySelector('rtsp-over-websocket') as any).statistics);
    expect(newStats).toBe(oldStats);
  });
});

test.describe('FR-4 Device (client-side only)', () => {
  let pages: BothPages;
  test.beforeEach(async ({ browser }) => {
    pages = await openBothPages(browser);
    await startDiscoveryBoth(pages);
    await pages.oldPage.locator('#datatable tbody tr').first().click();
    await pages.newPage.locator('#datatable tbody tr').first().click();
  });
  test.afterEach(async () => { await pages.close(); });

  test('TC-9: device type / hostname / port / profile writes match', async () => {
    await pages.oldPage.selectOption('#device_type', { index: 1 });
    await pages.newPage.selectOption('#device_type', { index: 1 });
    let oldDevice = await pages.oldPage.evaluate(() => (document.querySelector('rtsp-over-websocket') as any).device);
    let newDevice = await pages.newPage.evaluate(() => (document.querySelector('rtsp-over-websocket') as any).device);
    expect(newDevice).toBe(oldDevice);
    // Restore to camera for the rest of this file's tests.
    await pages.oldPage.selectOption('#device_type', { index: 0 });
    await pages.newPage.selectOption('#device_type', { index: 0 });

    await pages.oldPage.locator('#hostname').fill('10.0.0.9');
    await pages.newPage.locator('#hostname').fill('10.0.0.9');
    await pages.oldPage.locator('#hostname').dispatchEvent('change');
    await pages.newPage.locator('#hostname').dispatchEvent('change');
    const oldHost = await pages.oldPage.evaluate(() => (document.querySelector('rtsp-over-websocket') as any).hostname);
    const newHost = await pages.newPage.evaluate(() => (document.querySelector('rtsp-over-websocket') as any).hostname);
    expect(newHost).toBe(oldHost);
  });

  test('TC-12: HTTP/HTTPS switch sets #port default and player .https identically', async () => {
    await clickCheckboxBoth(pages, '#https_radio');
    await expectSameState(pages, '#port', ['value']);
    const oldHttps = await pages.oldPage.evaluate(() => (document.querySelector('rtsp-over-websocket') as any).https);
    const newHttps = await pages.newPage.evaluate(() => (document.querySelector('rtsp-over-websocket') as any).https);
    expect(newHttps).toBe(oldHttps);

    await clickCheckboxBoth(pages, '#http_radio');
    await expectSameState(pages, '#port', ['value']);
  });
});

test.describe('FR-4.5/FR-5 Device SUNAPI bootstrap + Video Profile List (mock SUNAPI)', () => {
  let pages: BothPages;
  test.beforeEach(async ({ browser }) => {
    pages = await setupSelectedDevice(browser);
  });
  test.afterEach(async () => { await pages.close(); });

  test('TC-10/TC-11: turning SUNAPI on drives the full bootstrap chain identically', async () => {
    await clickCheckboxBoth(pages, '#use_sunapi_client_checkbox');
    await pages.oldPage.waitForFunction(() => (document.getElementById('channel') as HTMLElement)?.tagName === 'SELECT');
    await pages.newPage.waitForFunction(() => (document.getElementById('channel') as HTMLElement)?.tagName === 'SELECT');

    await expectSameState(pages, '#use_sunapi_client_checkbox', ['checked']);
    await expectSameState(pages, '#is_android', ['checked']);
    await expectSameState(pages, '#channel', ['tagName', 'value']);
    await expectSameState(pages, '#channel option', ['textContent']);
    await expectSameState(pages, '#video_source_summary', ['textContent']);
    await expectSameState(pages, '#video_profile_list', ['innerHTML']);
    await expectSameState(pages, '#use_gmt', ['checked']);
    await expectSameState(pages, '#timezone', ['value', 'disabled']);
    await expectSameState(pages, '#play_button', ['disabled']);
  });

  test('TC-27: enabling "Use SUNAPI" does not start a second, redundant bootstrap chain (new page only, deviation)', async () => {
    // Deviation from legacy behavior -- reported by the user as a
    // real-device performance complaint (vis.Timeline display felt slow).
    // Profiling traced most of the wall-clock time to redundant SUNAPI
    // round trips, not to vis.Timeline's own rendering (confirmed
    // elsewhere to be <50ms and identical on both pages). Root cause
    // found live, via Playwright, not by reading source: clicking
    // #use_sunapi_client_checkbox right after filling #username/#password
    // moves focus away from #password, and the browser's own native
    // blur-triggered 'change' event fires there even though the value
    // never actually changed -- session.ts's password 'change' handler
    // (unconditionally, in the original) re-runs the whole ~6-7-round-trip
    // initSunapiManager() chain a second time for a field nobody edited.
    // Fixed with two independent guards (see state.ts's
    // sunapiInitInFlight comment and session.ts's username/password
    // handlers): a re-entrancy flag for genuinely-overlapping calls, and
    // a same-value check for this specific stale-blur case.
    //
    // Uses #hostname's own 'change' handler (unconditional re-init when
    // the SUNAPI checkbox is checked, same as the original -- only
    // #username/#password got the same-value fix, since that's the one
    // real-world trigger this was found from) as the second trigger,
    // deliberately NOT #playback_radio/#search_date -- FR-7.8 (added
    // after this test) hides #playback_control whenever SUNAPI is also
    // checked while in Playback mode, so those controls aren't a usable
    // trigger here anymore.
    let attributesRequests = 0;
    pages.newPage.on('request', (req) => {
      if (req.url().includes('attributes.cgi')) attributesRequests += 1;
    });

    await pages.newPage.locator('#use_sunapi_client_checkbox').evaluate((el: HTMLInputElement) => el.click());
    await pages.newPage.locator('#hostname').dispatchEvent('change');
    await pages.newPage.waitForTimeout(1000);

    expect(attributesRequests).toBe(1);
  });

  test('TC-13: clicking a profile row sets #profile without firing change (documented gap, reproduced identically)', async () => {
    await clickCheckboxBoth(pages, '#use_sunapi_client_checkbox');
    await pages.oldPage.waitForSelector('.profile-row');
    await pages.newPage.waitForSelector('.profile-row');

    await pages.oldPage.locator('.profile-row').first().click();
    await pages.newPage.locator('.profile-row').first().click();

    await expectSameState(pages, '#profile', ['value']);
    await expectSameState(pages, '.profile-row.selected', ['textContent']);
  });
});
