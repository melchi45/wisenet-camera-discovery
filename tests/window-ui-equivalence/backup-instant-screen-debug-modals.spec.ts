// TC-20..TC-24 -- SRS FR-9 (Backup), FR-10 (Instant playback), FR-11
// (Screen), FR-12 (Debug/Discovery/RTSP panels), FR-13 (Modals). All
// client-side-only (no discovery/SUNAPI needed) except where noted.
import { test, expect } from '@playwright/test';
import { openBothPages, expectSameState, BothPages } from './support';

test.describe('FR-9 Backup / FR-10 Instant playback / FR-11 Screen', () => {
  let pages: BothPages;
  test.beforeEach(async ({ browser }) => { pages = await openBothPages(browser); });
  test.afterEach(async () => { await pages.close(); });

  test('TC-20: empty-filename Backup toggle shows the identical alert and reverts', async () => {
    const oldMessages: string[] = [];
    const newMessages: string[] = [];
    pages.oldPage.on('dialog', (d) => { oldMessages.push(d.message()); d.accept(); });
    pages.newPage.on('dialog', (d) => { newMessages.push(d.message()); d.accept(); });

    await pages.oldPage.locator('#backup_checkbox').evaluate((el: HTMLInputElement) => el.click());
    await pages.newPage.locator('#backup_checkbox').evaluate((el: HTMLInputElement) => el.click());

    expect(newMessages).toEqual(oldMessages);
    await expectSameState(pages, '#backup_checkbox', ['checked']);
  });

  test('TC-21: #instantplayback_checkbox writes player .playType identically', async () => {
    await pages.oldPage.locator('#instantplayback_checkbox').evaluate((el: HTMLInputElement) => el.click());
    await pages.newPage.locator('#instantplayback_checkbox').evaluate((el: HTMLInputElement) => el.click());
    const oldType = await pages.oldPage.evaluate(() => (document.querySelector('rtsp-over-websocket') as any).playType);
    const newType = await pages.newPage.evaluate(() => (document.querySelector('rtsp-over-websocket') as any).playType);
    expect(newType).toBe(oldType);
  });

  test('TC-22: #fullscreen click flips player .fullscreen identically', async () => {
    // The player's .fullscreen setter kicks off the real (async)
    // Fullscreen API -- the property only settles once the browser's own
    // 'fullscreenchange' event fires, on both pages identically. Reading
    // it synchronously right after the click is inherently racy (a
    // timing artifact, not a functional divergence) -- wait for
    // document.fullscreenElement to settle on each page first.
    await pages.oldPage.locator('#fullscreen').evaluate((el: HTMLInputElement) => el.click());
    await pages.newPage.locator('#fullscreen').evaluate((el: HTMLInputElement) => el.click());
    await pages.oldPage.waitForFunction(() => !!document.fullscreenElement);
    await pages.newPage.waitForFunction(() => !!document.fullscreenElement);
    const oldFs = await pages.oldPage.evaluate(() => (document.querySelector('rtsp-over-websocket') as any).fullscreen);
    const newFs = await pages.newPage.evaluate(() => (document.querySelector('rtsp-over-websocket') as any).fullscreen);
    expect(newFs).toBe(oldFs);
  });
});

test.describe('FR-12 Debug/Discovery/RTSP panels', () => {
  let pages: BothPages;
  test.beforeEach(async ({ browser }) => { pages = await openBothPages(browser); });
  test.afterEach(async () => { await pages.close(); });

  test('TC-23: Use Debug toggle, a log line, Clear, and panel collapse/expand all match', async () => {
    await expectSameState(pages, '#use_debug', ['checked']);
    await pages.oldPage.locator('#use_debug').evaluate((el: HTMLInputElement) => el.click());
    await pages.newPage.locator('#use_debug').evaluate((el: HTMLInputElement) => el.click());
    await expectSameState(pages, '#use_debug', ['checked']);

    // Re-enable, trigger a real debug line via the fullscreen click from
    // FR-11 (onchangefullscreen doesn't log, so use a control that does:
    // #instantplayback_checkbox's own state.getSelectedPlayer() access is
    // silent too -- statechange is the simplest reliable debug-log source).
    await pages.oldPage.locator('#use_debug').evaluate((el: HTMLInputElement) => el.click());
    await pages.newPage.locator('#use_debug').evaluate((el: HTMLInputElement) => el.click());
    for (const page of [pages.oldPage, pages.newPage]) {
      await page.evaluate(() => {
        const el = document.querySelector('rtsp-over-websocket') as any;
        const readyState = (window as any).RTSPOverWebSocketPlayState.PLAYING;
        el.dispatchEvent(new CustomEvent('statechange', { detail: { readyState, elementId: el.id } }));
      });
    }
    await expectSameState(pages, '#debug', ['value']);

    await pages.oldPage.locator('#clear_debug').click();
    await pages.newPage.locator('#clear_debug').click();
    await expectSameState(pages, '#debug', ['value']);

    await pages.oldPage.locator('#debug_disclosure summary').click();
    await pages.newPage.locator('#debug_disclosure summary').click();
    await expectSameState(pages, '#debug_disclosure', ['open']);
  });
});

test.describe('FR-13 Modals', () => {
  let pages: BothPages;
  test.beforeEach(async ({ browser }) => { pages = await openBothPages(browser); });
  test.afterEach(async () => { await pages.close(); });

  test('TC-24: popup() shows #myModal, close button hides both modals', async () => {
    for (const page of [pages.oldPage, pages.newPage]) {
      await page.evaluate(() => (window as any).popup('<div>test</div>'));
    }
    await expectSameState(pages, '#myModal', ['style']);

    await pages.oldPage.locator('#myModal .close-popup').click();
    await pages.newPage.locator('#myModal .close-popup').click();
    await expectSameState(pages, '#myModal', ['style']);
    await expectSameState(pages, '#myCapture', ['style']);
  });
});
