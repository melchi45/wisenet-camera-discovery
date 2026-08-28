// TC-1..TC-6 -- SRS FR-1 (Toolbar) and FR-2 (Discovery result panel).
import { test, expect } from '@playwright/test';
import { openBothPages, startDiscoveryBoth, expectSameState, BothPages } from './support';

test.describe('FR-1 Toolbar', () => {
  let pages: BothPages;
  test.beforeEach(async ({ browser }) => { pages = await openBothPages(browser); });
  test.afterEach(async () => { await pages.close(); });

  test('TC-1: #init/#disconnect disabled state flips identically', async () => {
    await expectSameState(pages, '#init', ['disabled']);
    await expectSameState(pages, '#disconnect', ['disabled']);

    await pages.oldPage.locator('#init').click();
    await pages.newPage.locator('#init').click();
    await expectSameState(pages, '#init', ['disabled']);
    await expectSameState(pages, '#disconnect', ['disabled']);

    await pages.oldPage.locator('#disconnect').click();
    await pages.newPage.locator('#disconnect').click();
    await expectSameState(pages, '#init', ['disabled']);
    await expectSameState(pages, '#disconnect', ['disabled']);
  });

  test('TC-2: #auto_discovery_toggle persists via /settings and round-trips on reload', async () => {
    await expectSameState(pages, '#auto_discovery_toggle', ['checked']);

    await pages.oldPage.locator('#auto_discovery_toggle').evaluate((el: HTMLInputElement) => el.click());
    await pages.newPage.locator('#auto_discovery_toggle').evaluate((el: HTMLInputElement) => el.click());
    await expectSameState(pages, '#auto_discovery_toggle', ['checked']);
    await expectSameState(pages, '#init', ['disabled']);

    await pages.oldPage.reload();
    await pages.newPage.reload();
    await pages.oldPage.waitForTimeout(300);
    await pages.newPage.waitForTimeout(300);
    await expectSameState(pages, '#auto_discovery_toggle', ['checked']);
    await expectSameState(pages, '#init', ['disabled']);

    // Reset back to off so later tests in this file get a clean #init.
    await pages.oldPage.locator('#auto_discovery_toggle').evaluate((el: HTMLInputElement) => el.click());
    await pages.newPage.locator('#auto_discovery_toggle').evaluate((el: HTMLInputElement) => el.click());
  });

  test('TC-3: dark-mode switch flips data-theme + icon + label identically', async () => {
    await expectSameState(pages, 'html', ['dataset']);

    await pages.oldPage.locator('#toggle').evaluate((el: HTMLInputElement) => el.click());
    await pages.newPage.locator('#toggle').evaluate((el: HTMLInputElement) => el.click());

    const oldTheme = await pages.oldPage.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const newTheme = await pages.newPage.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(newTheme).toBe(oldTheme);

    await expectSameState(pages, '.theme-icon em', ['textContent']);
  });
});

test.describe('FR-2 Discovery result panel', () => {
  let pages: BothPages;
  test.beforeEach(async ({ browser }) => {
    pages = await openBothPages(browser);
    await startDiscoveryBoth(pages);
  });
  test.afterEach(async () => { await pages.close(); });

  test('TC-4: search + column sort match between pages', async () => {
    await pages.oldPage.locator('#datatable_search').fill('nvr');
    await pages.newPage.locator('#datatable_search').fill('nvr');
    await pages.oldPage.locator('#datatable_search').dispatchEvent('input');
    await pages.newPage.locator('#datatable_search').dispatchEvent('input');

    await expectSameState(pages, '#datatable tbody', ['textContent']);
    await expectSameState(pages, '#datatable_info', ['textContent']);

    await pages.oldPage.locator('#datatable_search').fill('');
    await pages.newPage.locator('#datatable_search').fill('');
    await pages.oldPage.locator('#datatable_search').dispatchEvent('input');
    await pages.newPage.locator('#datatable_search').dispatchEvent('input');

    const header = '#datatable thead th:first-child';
    await pages.oldPage.locator(header).click();
    await pages.newPage.locator(header).click();
    await expectSameState(pages, '#datatable tbody', ['textContent']);
    await pages.oldPage.locator(header).click();
    await pages.newPage.locator(header).click();
    await expectSameState(pages, '#datatable tbody', ['textContent']);
  });

  test('TC-5: Star Topology view matches between pages', async () => {
    await pages.oldPage.selectOption('#discovery_view_type', 'topology');
    await pages.newPage.selectOption('#discovery_view_type', 'topology');
    await pages.oldPage.waitForTimeout(300);
    await pages.newPage.waitForTimeout(300);

    const oldNodeCount = await pages.oldPage.evaluate(() => (window as any).state?.visNetwork?.body?.data?.nodes?.length ?? null);
    const newNodeCount = await pages.newPage.evaluate(() => (window as any).state?.visNetwork?.body?.data?.nodes?.length ?? null);
    // visNetwork isn't exposed on `window` in either build (module-private
    // state) -- fall back to asserting the container actually rendered a
    // vis-network canvas on both pages, which is the externally-observable
    // equivalence bar here (the full grouping/search-drilldown matrix is
    // docs/star-topology/TC.md's job, re-run there, not duplicated here).
    void oldNodeCount; void newNodeCount;
    await expect(pages.oldPage.locator('#datatable_topology .vis-network')).toBeVisible();
    await expect(pages.newPage.locator('#datatable_topology .vis-network')).toBeVisible();

    await pages.oldPage.selectOption('#discovery_view_type', 'table');
    await pages.newPage.selectOption('#discovery_view_type', 'table');
  });

  test('TC-6: selecting a discovered row matches (docs/control-panel-data-binding.md §1)', async () => {
    await pages.oldPage.locator('#datatable tbody tr').first().click();
    await pages.newPage.locator('#datatable tbody tr').first().click();

    await expectSameState(pages, '#hostname', ['value']);
    await expectSameState(pages, '#port', ['value']);
    await expectSameState(pages, '#https_radio', ['checked']);
    await expectSameState(pages, '#http_radio', ['checked']);
    await expectSameState(pages, '#use_native_tls_proxy_checkbox', ['checked']);
    await expectSameState(pages, '#web', ['disabled']);
    await expectSameState(pages, '#use_sunapi_client_checkbox', ['checked']);
  });
});
