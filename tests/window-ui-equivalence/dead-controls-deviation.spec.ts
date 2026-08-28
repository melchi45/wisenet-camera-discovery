// TC-25 (Known dead controls stay inert) and TC-26 (the one documented,
// intentionally-not-reproduced deviation) -- see docs/window-ui/SRS.md's
// "Known dead controls" table and docs/window-ui/DESIGN.md's "Deviations
// from legacy behavior" section.
import { test, expect } from '@playwright/test';
import {
  openBothPages, startDiscoveryBoth, fillCredentialsBoth, clickCheckboxBoth, BothPages,
} from './support';

// Controls with a stable id on BOTH pages (old page's onclick="..."
// attribute still throws ReferenceError there -- expected/accepted per
// TC.md; new page has no listener at all). Buttons with no id at all on
// the old page (instantplayback_play/pause/seek -- onclick-only there) are
// not included here; see this file's own note below.
const DEAD_CONTROL_IDS = [
  'forward', 'backward', 'talk',
  'media_record_stop', 'media_record_show',
  'use_waiting_icon',
];

test.describe('Known dead controls', () => {
  let pages: BothPages;
  test.beforeEach(async ({ browser }) => { pages = await openBothPages(browser); });
  test.afterEach(async () => { await pages.close(); });

  test('TC-25: clicking every dead control leaves both pages responsive, no user-visible error', async () => {
    const oldPageErrors: string[] = [];
    const newPageErrors: string[] = [];
    pages.oldPage.on('pageerror', (e) => oldPageErrors.push(e.message));
    pages.newPage.on('pageerror', (e) => newPageErrors.push(e.message));
    // No dialog listener registered on purpose: a dead control must not
    // pop an alert/confirm on EITHER page -- if one appears, Playwright's
    // default (auto-dismiss with a warning) still lets the test proceed,
    // but we assert none fired at all, below.
    let dialogFired = false;
    pages.oldPage.on('dialog', (d) => { dialogFired = true; d.dismiss(); });
    pages.newPage.on('dialog', (d) => { dialogFired = true; d.dismiss(); });

    for (const id of DEAD_CONTROL_IDS) {
      const oldEl = pages.oldPage.locator('#' + id);
      const newEl = pages.newPage.locator('#' + id);
      if (await oldEl.count() > 0) await oldEl.evaluate((el: HTMLElement) => el.click());
      if (await newEl.count() > 0) await newEl.evaluate((el: HTMLElement) => el.click());
    }

    expect(dialogFired).toBe(false);
    // Old page's onclick="undefinedFn()" attributes are EXPECTED to throw
    // ReferenceError (accepted per TC.md) -- assert only that the new page
    // stayed completely silent (no listener == nothing can throw).
    expect(newPageErrors).toEqual([]);

    // Page must still be fully responsive after all of the above -- the
    // real equivalence bar (PRD.md's Non-Goals): "nothing happens" on
    // both, not "the page breaks" on either.
    await expect(pages.oldPage.locator('#hostname')).toBeVisible();
    await expect(pages.newPage.locator('#hostname')).toBeVisible();
    await pages.newPage.locator('#hostname').fill('still-alive');
    await expect(pages.newPage.locator('#hostname')).toHaveValue('still-alive');
  });
});

test.describe('Documented deviation: NVR dateInfo branch', () => {
  let pages: BothPages;
  test.beforeEach(async ({ browser }) => { pages = await openBothPages(browser); });
  test.afterEach(async () => { await pages.close(); });

  test('TC-26: NVR device type + SUNAPI on -- NOT cross-page equal, by design (documented deviation)', async () => {
    // Confirmed via direct probing (not assumed): the original's `element`
    // reference at window.ts:2087 resolves to an outer-scope variable that
    // is actually `undefined` at call time (not a stale-but-valid element
    // reference) -- `element.device` throws a real TypeError, which the
    // outer .catch() converts into an unconditional
    // `use_sunapi_client_checkbox.checked = false`. So the original
    // genuinely fails NVR + SUNAPI-on, every time, regardless of player
    // count -- this is a real bug in the shipped product, not a dormant
    // one. src/shared-v2/device.ts's getSelectedPlayer().device-based fix
    // avoids it, per DESIGN.md's documented deviation. This test asserts
    // that exact asymmetry, not equality.
    await startDiscoveryBoth(pages);
    await pages.oldPage.locator('#datatable tbody tr').nth(1).click(); // MOCK-NVR-01
    await pages.newPage.locator('#datatable tbody tr').nth(1).click();
    await pages.oldPage.selectOption('#device_type', { index: 1 }); // nvr
    await pages.newPage.selectOption('#device_type', { index: 1 });
    await fillCredentialsBoth(pages, 'admin', 'admin1234');

    const oldPageErrors: string[] = [];
    pages.oldPage.on('pageerror', (e) => oldPageErrors.push(e.message));
    await clickCheckboxBoth(pages, '#use_sunapi_client_checkbox');

    await pages.oldPage.waitForFunction(() => (document.getElementById('use_sunapi_client_checkbox') as HTMLInputElement).checked === false);
    await pages.newPage.waitForFunction(() => (document.getElementById('channel') as HTMLElement)?.tagName === 'SELECT');

    const oldChecked = await pages.oldPage.locator('#use_sunapi_client_checkbox').evaluate((el: HTMLInputElement) => el.checked);
    const newChecked = await pages.newPage.locator('#use_sunapi_client_checkbox').evaluate((el: HTMLInputElement) => el.checked);
    expect(oldChecked).toBe(false); // original: reproducibly fails
    expect(newChecked).toBe(true); // new: reproducibly succeeds
  });
});
