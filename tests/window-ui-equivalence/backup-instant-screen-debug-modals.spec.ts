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

// TC-54 -- SRS FR-12.7 / DESIGN.md v1.68 (DEVIATION, new page only): every
// log panel is bounded. The original grows `el.value` without limit (its
// `maxlength="5000"` only ever limited *typed* input), which is the real
// ~9GB-over-a-long-Live-session leak reported by the user; the new page caps
// each panel at LOG_PANEL_MAX_CHARS (100,000 chars), trimming whole lines
// from the front.
test.describe('FR-12.7 log panels are bounded (new page only)', () => {
  let pages: BothPages;
  test.beforeEach(async ({ browser }) => { pages = await openBothPages(browser); });
  test.afterEach(async () => { await pages.close(); });

  const MAX = 100_000;

  test('TC-54a: #onvif_info stays within LOG_PANEL_MAX_CHARS under a flood of meta events', async () => {
    test.setTimeout(60_000);
    // Beautify off so each frame is exactly one line -- the cap trims at a
    // line boundary, and with beautify on a "line" is one of the indented
    // XML lines, which makes "starts on a whole line" awkward to assert.
    await pages.newPage.locator('#onvif_beautify').evaluate((el: HTMLInputElement) => el.click());
    const result = await pages.newPage.evaluate((max) => {
      const el = document.querySelector('rtsp-over-websocket') as any;
      // ~1KB of raw XML per frame; 400 frames is ~4x the cap, i.e. a few
      // seconds of a per-video-frame metadata feed.
      const xml = '<tt:MetadataStream>' + '<tt:Frame UtcTime="2026-09-09T00:00:00Z"><tt:Object ObjectId="1"><tt:Appearance><tt:Shape><tt:BoundingBox left="0" top="0" right="1" bottom="1"/></tt:Shape></tt:Appearance></tt:Object></tt:Frame>'.repeat(4) + '</tt:MetadataStream>';
      for (let i = 0; i < 400; i++) {
        el.dispatchEvent(new CustomEvent('meta', { detail: { xml: xml.replace('ObjectId="1"', `ObjectId="${i}"`) } }));
      }
      const value = (document.getElementById('onvif_info') as HTMLTextAreaElement).value;
      return { length: value.length, startsWholeLine: value.startsWith('onmeta: '), endsWithLast: value.trimEnd().endsWith('</tt:MetadataStream>'), hasLastId: value.includes('ObjectId="399"'), hasFirstId: value.includes('ObjectId="0"') };
    }, MAX);
    expect(result.length).toBeLessThanOrEqual(MAX);
    expect(result.length).toBeGreaterThan(MAX / 2);
    expect(result.startsWholeLine).toBe(true);
    expect(result.endsWithLast).toBe(true);
    expect(result.hasLastId).toBe(true);
    expect(result.hasFirstId).toBe(false);
  });

  test('TC-54b: #debug stays within LOG_PANEL_MAX_CHARS under a flood of statechange events', async () => {
    // onstatechange() does real button-state DOM work per call, not just the
    // changedebug() append -- 2000 synchronous dispatches (well past the
    // ~1250 needed to exceed the cap at this line length) is comfortably
    // over it without risking the default test timeout on a slow runner.
    test.setTimeout(60_000);
    const COUNT = 2000;
    const result = await pages.newPage.evaluate(({ max, count }) => {
      const el = document.querySelector('rtsp-over-websocket') as any;
      const readyState = (window as any).RTSPOverWebSocketPlayState.PLAYING;
      for (let i = 0; i < count; i++) {
        el.dispatchEvent(new CustomEvent('statechange', { detail: { readyState, elementId: el.id, seq: i } }));
      }
      const value = (document.getElementById('debug') as HTMLTextAreaElement).value;
      return { length: value.length, startsWholeLine: value.startsWith('onstatechange: '), hasLast: value.includes(`"seq":${count - 1}`), hasFirst: value.includes('"seq":0}') };
    }, { max: MAX, count: COUNT });
    expect(result.length).toBeLessThanOrEqual(MAX);
    expect(result.startsWholeLine).toBe(true);
    expect(result.hasLast).toBe(true);
    expect(result.hasFirst).toBe(false);
  });
});
