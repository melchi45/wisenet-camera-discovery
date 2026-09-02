// TC-28..TC-32 -- SRS FR-7.8 (SUNAPI-driven Calendar search), src/shared-v2/
// only. Unlike every other spec file in this suite, these drive ONLY the
// new page (NEW_URL) -- there is no old-page equivalent to compare against
// (docs/window-ui/TC.md's own note on this). Backed by
// tools/mock-sunapi-server/'s deviceinfo/dynamicrules fixtures (the exact
// JSON the feature was requested with, confirmed against a real device's
// eventrules.cgi?msubmenu=dynamicrules response -- see MEMORY.md) and the
// existing ~150-item timeline/calendarsearch/overlapped fixtures already
// used elsewhere in this suite.

import { test, expect, Page } from '@playwright/test';
import { NEW_URL, MOCK_SUNAPI_PORT } from '../../playwright.config';

async function openNewPageInPlaybackSunapiMode(browser: any): Promise<Page> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
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
  // test relies on (getDeviceInfo/getDynamicRules/getCalendarSearch/...)
  // would otherwise target a port nothing is listening on. Same fix as
  // event-timeline.spec.ts's openNewPageWithTimeline() -- fill + dispatch
  // 'change' (not a raw .value= assignment) so changeport() actually runs
  // and updates the player's real .port, not just the input's own display.
  await page.locator('#port').fill(String(MOCK_SUNAPI_PORT));
  await page.locator('#port').dispatchEvent('change');
  await page.locator('#username').fill('admin');
  await page.locator('#username').dispatchEvent('change');
  await page.locator('#password').fill('admin1234');
  await page.locator('#password').dispatchEvent('change');

  await page.locator('#playback_radio').evaluate((el: HTMLInputElement) => el.click());
  await page.locator('#use_sunapi_client_checkbox').evaluate((el: HTMLInputElement) => el.click());
  // FR-16: `#event_rules_type` no longer exists in the static page at all --
  // it's built on demand inside `#timeline` once populateRuleSelect()'s own
  // getDynamicRules() fetch resolves (event-timeline.ts's renderRuleTypes(),
  // via playbackCalendar.ts's ensureEventTimelineShell()). `?.` is required,
  // not just style: page.waitForFunction() rejects immediately (does not
  // keep polling) the first time its predicate *throws* rather than
  // returning falsy, and the element is genuinely null on the very first
  // poll, right after the checkbox click, before that fetch has resolved.
  await page.waitForFunction(() => ((document.getElementById('event_rules_type') as HTMLSelectElement | null)?.options.length ?? 0) > 0);

  return page;
}

test.describe('FR-7.8 SUNAPI-driven Calendar search (new page only)', () => {
  test('TC-28: panel switch -- Playback+SUNAPI-On shows the calendar panel, Playback+SUNAPI-Off keeps the old one', async ({ browser }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.route('https://img.icons8.com/**', (route) => route.abort());
    await page.goto(NEW_URL);
    await page.waitForTimeout(200);

    // Live mode (default): both panels hidden.
    await expect(page.locator('#playback_control')).toHaveCSS('display', 'none');
    await expect(page.locator('#playback_control_calendar')).toHaveCSS('display', 'none');

    // Playback + SUNAPI Off: old panel only.
    await page.locator('#playback_radio').evaluate((el: HTMLInputElement) => el.click());
    await expect(page.locator('#playback_control')).not.toHaveCSS('display', 'none');
    await expect(page.locator('#playback_control_calendar')).toHaveCSS('display', 'none');
    // #search_overlapped_id no longer exists (v2.0 Playback search
    // redesign, docs/window-ui/SRS.md FR-7.1) -- #search_aitimeline is
    // this manual panel's own remaining, always-rendered control.
    // Overlapped Id (FR-15, event-timeline-component's SRS) no longer lives
    // in this panel's own markup at all any more -- moved into the shared
    // Event Timeline widget's own toolbar (#timeline).
    await expect(page.locator('#search_aitimeline')).toBeVisible();

    // Playback + SUNAPI On: new panel only.
    await page.locator('#init').click();
    await page.waitForSelector('#datatable tbody tr:nth-child(1)');
    await page.locator('#datatable tbody tr').first().click();
    // See openNewPageInPlaybackSunapiMode()'s own comment on this step.
    await page.locator('#port').fill(String(MOCK_SUNAPI_PORT));
    await page.locator('#port').dispatchEvent('change');
    await page.locator('#username').fill('admin');
    await page.locator('#username').dispatchEvent('change');
    await page.locator('#password').fill('admin1234');
    await page.locator('#password').dispatchEvent('change');
    await page.locator('#use_sunapi_client_checkbox').evaluate((el: HTMLInputElement) => el.click());
    await page.waitForFunction(() => ((document.getElementById('event_rules_type') as HTMLSelectElement | null)?.options.length ?? 0) > 0);
    await expect(page.locator('#playback_control')).toHaveCSS('display', 'none');
    await expect(page.locator('#playback_control_calendar')).not.toHaveCSS('display', 'none');

    // Back to SUNAPI Off: old panel returns, with its own ids/state
    // untouched by any of the above.
    await page.locator('#use_sunapi_client_checkbox').evaluate((el: HTMLInputElement) => el.click());
    await expect(page.locator('#playback_control')).not.toHaveCSS('display', 'none');
    await expect(page.locator('#playback_control_calendar')).toHaveCSS('display', 'none');
    // #search_overlapped_id no longer exists (v2.0 Playback search
    // redesign, docs/window-ui/SRS.md FR-7.1) -- #search_aitimeline is
    // this manual panel's own remaining, always-rendered control.
    // Overlapped Id (FR-15, event-timeline-component's SRS) no longer lives
    // in this panel's own markup at all any more -- moved into the shared
    // Event Timeline widget's own toolbar (#timeline).
    await expect(page.locator('#search_aitimeline')).toBeVisible();

    await context.close();
  });

  test('TC-29: Language dropdown has all 16 static options, defaulted to getDeviceInfo()\'s Language', async ({ browser }) => {
    const page = await openNewPageInPlaybackSunapiMode(browser);
    const optionCount = await page.locator('#event_rules_language option').count();
    expect(optionCount).toBe(16);
    // tools/mock-sunapi-server/server.js's DEVICE_INFO.Language is "English".
    expect(await page.locator('#event_rules_language').inputValue()).toBe('English');
    await page.context().close();
  });

  test('TC-30: Rule dropdown lists every getDynamicRules() entry regardless of channel (value Rule<Rule+1>, label RuleName), and stays unchanged across a channel switch', async ({ browser }) => {
    const page = await openNewPageInPlaybackSunapiMode(browser);

    // tools/mock-sunapi-server's DYNAMIC_RULES fixture: Rule 0/1 target
    // Channel 0 (CH1), Rule 2/3/4 target Channel 1 (CH2). As of SRS.md
    // FR-7.8.2 v2.35, the dropdown is NOT filtered to the selected channel
    // -- a real device's Timeline response for one channel legitimately
    // includes another channel's configured Rules (e.g. a dual-sensor
    // camera whose channels share one physical recording timeline), so
    // every configured Rule is offered regardless of `#channel`.
    // recording.cgi's Timeline `Type=Rule<N>` numbering is 1-based (one
    // higher than getDynamicRules()'s own 0-based `Rule` field), so the
    // dropdown values are Rule1..Rule5, not Rule0-based.
    // getTimeline()'s own default `type` ('All', SunapiManager.ts's
    // buildTimelineUri()) is always offered first.
    const expectedOptions = [
      { value: 'All', label: 'All' },
      { value: 'Rule1', label: '움직임 감지 (CH1)' },
      { value: 'Rule2', label: '화재 조기 감지 (CH1)' },
      { value: 'Rule3', label: '온도감지 (CH2)' },
      { value: 'Rule4', label: '움직임 감지 (CH2)' },
      { value: 'Rule5', label: '온도 차이 (CH2)' },
    ];
    const initialOptions = await page.locator('#event_rules_type option').evaluateAll(
      (opts) => opts.map((o) => ({ value: (o as HTMLOptionElement).value, label: o.textContent })),
    );
    expect(initialOptions).toEqual(expectedOptions);

    let dynamicRulesRequests = 0;
    page.on('request', (req) => {
      if (req.url().includes('msubmenu=dynamicrules')) dynamicRulesRequests += 1;
    });

    // Switch to channel 2 (index 1) -- still re-fetches (kept for parity
    // with resetPlaybackSearchStateForChannelChange()'s existing reset
    // ordering, see refreshRuleSelectForChannelChange()'s own doc comment)
    // but the resulting option list is identical, since it's no longer
    // channel-scoped. tools/mock-sunapi-server's device only reports 1 real
    // channel (VIDEO_SOURCES/MaxChannel), so #channel (a <select> here --
    // videoProfile.ts's populateChannelSelect() swaps it from <input> once
    // SUNAPI reports channel info) only has a "1" option; add a "2" option
    // here, test-side only, so this test can exercise the channel-change
    // codepath without widening the mock fixture (and every other test that
    // assumes a single channel) just for this one case.
    await page.locator('#channel').evaluate((el: HTMLSelectElement) => {
      const option = document.createElement('option');
      option.value = '2';
      option.textContent = 'Channel 2';
      el.append(option);
    });
    await page.selectOption('#channel', '2');
    await page.waitForFunction(() => (document.getElementById('event_rules_type') as HTMLSelectElement | null)?.options.length === 6);
    expect(dynamicRulesRequests).toBeGreaterThan(0);

    const ch2Options = await page.locator('#event_rules_type option').evaluateAll(
      (opts) => opts.map((o) => ({ value: (o as HTMLOptionElement).value, label: o.textContent })),
    );
    expect(ch2Options).toEqual(expectedOptions);

    await page.context().close();
  });

  test('TC-31: Calendar mounts, month search highlights recorded days, and reveals #timeline (with the Rule shell already inside it)', async ({ browser }) => {
    const page = await openNewPageInPlaybackSunapiMode(browser);
    await page.waitForFunction(() => (document.getElementById('timeline') as HTMLElement).style.display !== 'none');

    await expect(page.locator('#playback_calendar .calendar-grid')).toBeVisible();
    const highlighted = await page.locator('#playback_calendar .calendar-day-has-recording').count();
    expect(highlighted).toBeGreaterThan(0);
    // FR-16: Rule renders inside #timeline's own toolbar as soon as the
    // month search reveals it (an empty-data "shell" mount --
    // ensureEventTimelineShell()), independently of any day click -- unlike
    // Overlapped Id (FR-15), which stays absent (no <select> at all, see
    // event-timeline.ts's renderOverlappedIds()) until a day/preset search
    // actually returns overlapped sessions (TC-32's job, not this test's).
    await expect(page.locator('#timeline')).toBeVisible();
    await expect(page.locator('#event_rules_type')).toBeVisible();

    await page.context().close();
  });

  test('TC-32: clicking a highlighted day fires Overlapped Id + Timeline searches and renders into #timeline', async ({ browser }) => {
    const page = await openNewPageInPlaybackSunapiMode(browser);
    await page.waitForFunction(() => (document.getElementById('timeline') as HTMLElement).style.display !== 'none');

    // #event_rules_type defaults to 'All' (TC-30) -- explicitly select a
    // specific Rule here so this test's own Type=Rule<N> assertion below
    // stays meaningful; TC-33 covers the 'All' default's own Type=All.
    await page.selectOption('#event_rules_type', 'Rule1');

    const requestedUrls: string[] = [];
    page.on('request', (req) => requestedUrls.push(req.url()));

    await page.locator('#playback_calendar .calendar-day-has-recording').first().click();
    await page.waitForFunction(() => document.querySelectorAll('#timeline .event-timeline-item').length > 0, { timeout: 10000 });

    expect(requestedUrls.some((u) => u.includes('msubmenu=overlapped'))).toBe(true);
    // Confirms the Timeline request's Type param is 'Rule<N>' (e.g.
    // 'Rule1', matching the Rule dropdown's own selected value) -- not the
    // raw EventSources[].Type string (e.g. 'MotionDetection') the earlier,
    // real-device-unverified design used, and not the un-offset
    // getDynamicRules() 'Rule' field either. See MEMORY.md.
    expect(requestedUrls.some((u) => u.includes('msubmenu=timeline') && /[?&]Type=Rule\d+/.test(u))).toBe(true);
    // FR-15: Overlapped Id renders inside the Event Timeline widget's own
    // toolbar now, not #calendar_overlapped_id_area (moved directly per the
    // user's request).
    expect(await page.locator('#timeline .event-timeline-overlapped-id').innerHTML()).toContain('select');
    expect(await page.locator('#timeline .event-timeline-item').count()).toBeGreaterThan(0);

    await page.context().close();
  });

  test('TC-33: Rule dropdown defaults to "All", and clicking a day with it selected sends Type=All', async ({ browser }) => {
    const page = await openNewPageInPlaybackSunapiMode(browser);
    await page.waitForFunction(() => (document.getElementById('timeline') as HTMLElement).style.display !== 'none');

    expect(await page.locator('#event_rules_type').inputValue()).toBe('All');

    const requestedUrls: string[] = [];
    page.on('request', (req) => requestedUrls.push(req.url()));

    await page.locator('#playback_calendar .calendar-day-has-recording').first().click();
    await page.waitForFunction(() => document.querySelectorAll('#timeline .event-timeline-item').length > 0, { timeout: 10000 });

    // Matches the exact query the user specified:
    // recording.cgi?msubmenu=timeline&action=view&FromDate=...&ToDate=...&ChannelIDList=0&Type=All
    expect(requestedUrls.some((u) => u.includes('msubmenu=timeline') && /[?&]Type=All(&|$)/.test(u))).toBe(true);

    await page.context().close();
  });
});
