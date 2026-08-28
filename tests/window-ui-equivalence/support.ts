// Shared helpers for the window-ui-equivalence suite -- see
// docs/window-ui/TC.md's "Method" section for the pattern every spec file
// here follows: perform the identical action on both the original page and
// the new one, then assert identical resulting DOM state.

import { Browser, Page, expect } from '@playwright/test';
import { NEW_URL, OLD_URL } from '../../playwright.config';

export interface BothPages {
  oldPage: Page;
  newPage: Page;
  close(): Promise<void>;
}

/** Opens both pages in separate browser contexts (so WS/discovery state,
 *  chosen because each page keeps independent socket.ts/discovery state,
 *  never shares cookies/storage). */
export async function openBothPages(browser: Browser): Promise<BothPages> {
  const oldContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const newContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const oldPage = await oldContext.newPage();
  const newPage = await newContext.newPage();

  // Both dark-mode icon URLs point at img.icons8.com, which this sandbox
  // can't reach with a trusted cert (net::ERR_CERT_AUTHORITY_INVALID) --
  // expected on both pages identically, not a functional divergence to
  // chase. Block the requests so it doesn't spam each test's console.
  await oldPage.route('https://img.icons8.com/**', (route) => route.abort());
  await newPage.route('https://img.icons8.com/**', (route) => route.abort());

  await oldPage.goto(OLD_URL);
  await newPage.goto(NEW_URL);

  return {
    oldPage,
    newPage,
    close: async () => {
      await oldContext.close();
      await newContext.close();
    },
  };
}

/** Clicks #init on both pages and waits for the fixture WS devices to land. */
export async function startDiscoveryBoth(pages: BothPages): Promise<void> {
  await pages.oldPage.locator('#init').click();
  await pages.newPage.locator('#init').click();
  await expect(pages.oldPage.locator('#datatable tbody tr')).toHaveCount(2);
  await expect(pages.newPage.locator('#datatable tbody tr')).toHaveCount(2);
}

/** Fills #username/#password on both pages and dispatches 'change' (matches
 *  a real blur-after-typing interaction -- the listeners are on 'change',
 *  not 'input'). */
export async function fillCredentialsBoth(pages: BothPages, username: string, password: string): Promise<void> {
  for (const page of [pages.oldPage, pages.newPage]) {
    await page.locator('#username').fill(username);
    await page.locator('#username').dispatchEvent('change');
    await page.locator('#password').fill(password);
    await page.locator('#password').dispatchEvent('change');
  }
}

/** Native .click() on a checkbox -- required over Playwright's own .check()
 *  for controls mounted via src/component/switch/ (mountSwitch() visually
 *  hides the underlying <input>, which Playwright's actionability checks
 *  then refuse to act on even with force:true). */
export async function clickCheckboxBoth(pages: BothPages, selector: string): Promise<void> {
  await pages.oldPage.locator(selector).evaluate((el: HTMLElement) => (el as HTMLInputElement).click());
  await pages.newPage.locator(selector).evaluate((el: HTMLElement) => (el as HTMLInputElement).click());
}

/** Reads a small set of DOM properties from one element, on one page --
 *  used to build "does old's state match new's state" assertions. */
export async function readState(page: Page, selector: string, props: string[]): Promise<Record<string, unknown>> {
  return page.locator(selector).evaluate((el: any, props: string[]) => {
    const out: Record<string, unknown> = {};
    for (const p of props) out[p] = el[p];
    return out;
  }, props);
}

/** Asserts readState(oldPage, ...) === readState(newPage, ...) for the same selector/props. */
export async function expectSameState(pages: BothPages, selector: string, props: string[]): Promise<void> {
  const oldState = await readState(pages.oldPage, selector, props);
  const newState = await readState(pages.newPage, selector, props);
  expect(newState, `#${selector} ${props.join('/')}`).toEqual(oldState);
}
