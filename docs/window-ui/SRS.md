# SRS — Window UI Full Specification & Reimplementation

| | |
|---|---|
| Title | Window UI Full Specification & Reimplementation — Software Requirements Specification (SRS) |
| Abstract | Complete functional requirements for every control and behavior in `window.html`/`window.ts`, grouped by panel, plus the known-dead-controls list. |
| Status | Draft |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [PRD](PRD.md) · [MRD](MRD.md) · [DESIGN](DESIGN.md) · [TC](TC.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-28 | Youngho Kim | Initial SRS, derived from a full-file read of `window.html`/`window.ts`. |
| 1.1 | 2026-08-28 | Youngho Kim | FR-3.1: corrected to state `#player_list` (and its `<label>`/`change` listener) is *created* at setup, not pre-existing markup — found via Playwright equivalence testing (Phase 4): `src/shared-v2/window.html` has no `#player_list` element, so the first implementation crashed on load (`playerEvents.ts`'s option-append hit `null`) before `setupDiscovery()` ever ran. |
| 1.2 | 2026-08-28 | Youngho Kim | Added FR-15.4: an entire startup initial-state block (today's-date defaults for date fields, initial disabled/unchecked state for a dozen controls) was missing from the original SRS pass entirely — found via TC-17's `#end_date` mismatch during Playwright equivalence testing. |
| 1.3 | 2026-08-28 | Youngho Kim | FR-7.6: added the `fit()`-to-item-range requirement — reported by the user against a real device (Search Timeline returned valid data but rendered nothing, because the legacy hardcoded-to-"today" window doesn't contain non-today recordings). A deliberate divergence, not a spec-completeness fix. |
| 1.4 | 2026-08-28 | Youngho Kim | FR-7.3: documented the `{TimeLineSearchResults: [...]}` response envelope and the `display: "block"` detail — a real fidelity bug in `src/shared-v2/` (not a deviation): the first implementation passed the whole envelope to `updateTimeline()` instead of unwrapping it, silently rendering nothing against a real device. `tools/mock-sunapi-server/`'s fixture had the same unwrapped shape, so equivalence testing never caught it — only real-device testing did. |
| 1.5 | 2026-08-28 | Youngho Kim | FR-7.6: retracted v1.3's `fit()` requirement — a misdiagnosis, not a real bug (`vis.Timeline` already auto-fits on `setItems()`); the added `fit()` call broke rendering at real data volume instead of fixing anything. See DESIGN.md's retracted deviation entry. |
| 1.6 | 2026-08-28 | Youngho Kim | Added FR-15.5: `sunapiInitInFlight` guard + same-value check on username/password handlers, eliminating redundant `initSunapiManager()` chains — a real-device performance report traced to this via CPU profiling, not vis.Timeline rendering itself. |
| 1.7 | 2026-08-28 | Youngho Kim | Added FR-7.8: SUNAPI-driven Calendar search — a `src/shared-v2/`-only feature (no `src/shared/` equivalent), gated on Playback mode + SUNAPI On, requested directly by the user. Language/Rule pickers feed `eventrules.cgi`'s `getDynamicRulesOptions`/`getDynamicRules` (added to `rtsp-over-websocket`'s `SunapiManager.ts` earlier this session); the Calendar itself is a new reusable component, `docs/calendar-component/`. |
| 1.8 | 2026-08-28 | Youngho Kim | FR-7.8.2: corrected against a real device's `eventrules.cgi?msubmenu=dynamicrules` response — the Rule dropdown is `getDynamicRules()`'s own `Rules` array filtered by channel (value `Rule<N>`, label `RuleName`), not a `getDynamicRulesOptions()`/`getDynamicRules()` merge keyed by `EventSources[].Type`; the Timeline endpoint's `Type` param only accepts the former. Reported directly by the user with the real response JSON. |
| 1.9 | 2026-08-28 | Youngho Kim | FR-7.8.2: corrected the `Rule<N>` numbering — the Timeline endpoint's `Type=Rule<N>` is 1-based, one higher than `getDynamicRules()`'s own 0-based `Rule` field (`Rule: 0` → `Type=Rule1`, not `Type=Rule0`). Reported directly by the user immediately after v1.8 landed. |
| 1.10 | 2026-08-28 | Youngho Kim | FR-7.8.2: added an `"All"` option (value `"All"`) as the Rule dropdown's default, matching `getTimeline()`'s own default `type` — reported by the user with the exact expected query (`...&Type=All`). |
| 1.11 | 2026-08-28 | Youngho Kim | FR-7.8.4: added a first-call barrier so `getCalendarSearch()` waits for `getDeviceInfo()` to settle before firing, when the panel is freshly shown — mitigates a real, confirmed race in the vendored `@melchi45/rtsp-over-websocket` library's digest-auth retry counter, reported by the user as an intermittent 401 on a real device. See `MEMORY.md`. |
| 1.12 | 2026-08-28 | Youngho Kim | FR-7.8.5: `getOverlappedIdList()`/`getTimeline()` are now sequenced, not concurrent — the same digest-auth race as FR-7.8.4 v1.11, reported by the user again against `getTimeline()` specifically on a day click. See `MEMORY.md`. |
| 1.13 | 2026-08-28 | Youngho Kim | The Playback Calendar's own `#playback_calendar` container had `class="field"` — meant for label+input pairs, not this component's root — which forced `display:inline-flex`, laying its header/weekday-row/day-grid out horizontally instead of stacked. Removed the class; no other change. Reported by the user with a screenshot. |
| 1.14 | 2026-08-28 | Youngho Kim | FR-7.6: rewrote the vis.Timeline render — single `"All"` group with automatic stacking instead of fixed Normal/Event rows, dynamic per-`Type` coloring instead of a fixed detection-type enum, reduced `maxHeight`. Reported by the user (misalignment, too tall, wanted Normal+Event merged with Rule-based color-coding). Also surfaced a separate, unrelated, still-open bug — see the new note in FR-7.6 above and `MEMORY.md`. |
| 1.15 | 2026-08-31 | Youngho Kim | FR-7.6: v1.14's auto-stacked `"All"` group still grew too tall on genuine time-overlap (the exact case `stack: true` adds sub-rows for) and couldn't tell distinct Rules apart. Changed to `stack: false` (one literal line for `"All"`) + one added row per distinct Rule# found in the results, `height: 'auto'` (was fixed `maxHeight: '60px'`), and Rule#-keyed (not first-seen-order) color assignment. Reported by the user immediately after v1.14 shipped. |
| 1.16 | 2026-08-31 | Youngho Kim | FR-7.6: replaced `vis.Timeline` entirely with a new custom widget, `src/component/event-timeline/` (own MRD/PRD/SRS/DESIGN/TC set, `docs/event-timeline-component/`) — reported by the user with a reference screenshot of a different app's dark "ONVIF Timeline" view; `vis.Timeline` has no native overview/minimap concept to reskin that request onto, so a reskin (offered as an alternative) couldn't reach it. The v1.14/v1.15 "still-open positioning bug" note no longer applies to `src/shared-v2/` as of this change (still open in `src/shared/`'s own untouched original). |
| 1.17 | 2026-08-31 | Youngho Kim | FR-7.6: Timeline result items/rows now display each Rule's configured `RuleName` (e.g. `"MD 1"`) instead of the raw `Type` string (e.g. `"Rule3"`), resolved via a new `state.dynamicRuleEntries` cache (populated by FR-7.8.2's `getDynamicRules()` call) with the same `Type=Rule<N>` = entry's 0-based `Rule` + 1 offset used there; `"Normal"` items are untouched (not rule data, never looked up). Falls back to the raw `Type` string when no matching/named rule is cached. Reported directly by the user with a real device's `eventrules.cgi`/`recording.cgi` responses confirming `"Rule3"` should display as `Rule: 2`'s `RuleName`. |
| 1.18 | 2026-08-31 | Youngho Kim | FR-7.6: `onSelect` now sets and enables both Manual Start Time and Manual End Time for every clicked item, `"Normal"`-classed items included — DEVIATION from legacy behavior, which special-cased `"Normal"` to null `endTime` and disable the End Time fields with no documented reason, despite `recording.cgi` always returning a real `EndTime` for every result row. Requested directly by the user. See `docs/window-ui/DESIGN.md`'s "Deviations from legacy behavior". |
| 1.19 | 2026-08-31 | Youngho Kim | FR-7.6: `resolveEventLabel()`'s Rule→RuleName lookup now also requires the candidate rule's `EventSources[].Channel` to match the currently selected player's 0-based channel (the same value sent as the search's own `ChannelIDList`) — `getDynamicRules()` is device-wide, not channel-scoped, and `Rule` numbers aren't guaranteed unique across channels, so matching on `Rule` alone risked resolving to a different channel's same-numbered rule. Reported directly by the user, connecting `eventrules.cgi`'s `EventSources[].Channel` field to the exact `ChannelIDList` value already used elsewhere (FR-7.8.2/FR-7.8.5). |
| 1.20 | 2026-08-31 | Youngho Kim | FR-7.8: `updatePlaybackSunapiUIVisibility()` now also hides `#timeline` when Play Type switches to Live — previously only `#playback_control`/`#playback_control_calendar` were toggled, leaving a prior Playback search's timeline visibly stuck on screen after switching to Live. Reported directly by the user ("Date picker hides, timeline doesn't"). Also corrected this function's file reference (`playbackCalendar.ts`, not `playback.ts`). |
| 1.21 | 2026-08-31 | Youngho Kim | FR-7.8.4: `#channel` changes now also re-trigger `getCalendarSearch()` for the currently-displayed month via a new `refreshCalendarSearchForChannelChange()`, mirroring FR-7.8.2's `refreshRuleSelectForChannelChange()` — its channel-scoped highlighted-recorded-days data previously had no channel-change refresh at all, staying stuck on the previous channel's recordings until manual month navigation. Reported directly by the user, who also confirmed the precondition: this (like every FR-7.8 request) only fires when Play Type is Playback, enforced by the same "panel visible" guard `refreshRuleSelectForChannelChange()` already uses. |
| 1.22 | 2026-08-31 | Youngho Kim | Added FR-7.8.6: a complete 5-part "channel change during Playback" scenario, reported directly by the user — Calendar data refresh (superseding v1.21's narrower version), `#timeline` hide, Overlapped Id reset+hide, Manual Start/End Time reset+hide, and player `stop()`. Implemented as one new `resetPlaybackSearchStateForChannelChange()` replacing v1.21's `refreshCalendarSearchForChannelChange()`; `runMonthSearch()` gained a `revealSearchArea` parameter (default `true`) so this function's own re-fetch doesn't undo its own hiding of `#calendar_search_area`. See `docs/window-ui/DESIGN.md`'s new flow diagram and `MEMORY.md`. |
| 1.23 | 2026-08-31 | Youngho Kim | FR-7.8.2: `#event_rules_type` moved from its own field-row (next to Language) into `#calendar_search_area`, positioned immediately before Overlapped Id — it's a Timeline search filter like the fields after it, not a device-wide setting like Language, so it now shows/hides on the same timing (hidden until the month search first resolves, hidden again by FR-7.8.6's channel-change reset). Reported directly by the user. FR-7.8.5 updated to unconditionally re-show `#calendar_search_area` on day click, since a day stays clickable regardless of that container's own hidden state (surfaced by this move interacting with FR-7.8.6's channel-change reset — without it, a day click right after a channel change, with no month navigation in between, would populate fields into a still-hidden container). |
| 1.24 | 2026-08-31 | Youngho Kim | FR-7.8.2: `#event_rules_type` gained its own `change` listener — selecting a different Rule now immediately re-fetches `getTimeline()` with the new `Type` for the already-set date range/Overlapped Id and redraws `#timeline`, instead of only taking effect on the next day click. New `runCalendarTimelineSearch()` factored out of FR-7.8.5's `runOverlappedAndTimelineSearch()` (shared `buildCalendarSearchTimeRange()` helper) so a Rule change re-fetches only the Timeline query, not Overlapped Id too. Reported directly by the user with the real `recording.cgi?msubmenu=timeline` request that should reflect the newly-selected Rule. |
| 1.25 | 2026-08-31 | Youngho Kim | FR-7.6: `updateTimeline()` now filters `Results[]` by `eventAppliesToChannel()` before building any row/item — a real device's Timeline response has been observed including a different channel's Rule events (e.g. CH2's `Rule5`/`Rule6`/`Rule8`/`Rule9` while CH1 was queried), which previously rendered as extra, wrongly-scoped rows. Reported directly by the user with a screenshot of the live timeline. Kept, not filtered: `"Normal"` (always belongs to the queried channel) and any `Rule<N>` with no cached `state.dynamicRuleEntries` match at all (can't be judged either way). |
| 1.26 | 2026-09-01 | Youngho Kim | FR-6.9: the `statechange` handler's `STOPPED` branch now also nulls the player's `startTime`/`endTime` — previously only `PAUSED`/`STOPPED`'s custom-time marker (FR-14) was cleared, leaving the `rtsp-over-websocket` player's own start/end time fields stuck on whatever range the last playback used. Requested directly by the user. `src/shared-v2/` only, `videoControl.ts`'s `onstatechange()`. |
| 2.0 | 2026-08-31 | Youngho Kim | Major Playback search redesign, reported directly by the user via a 5-item request plus a follow-up clarification. FR-7.1-7.4 rewritten: the manual flow's typed-date-range search (`#search_overlapped_id`/`#search_date`/`#start_date`/`#end_date`/`#support_end_time`/1 Day-3 Month toggle/`#search_timeline`) is retired — search is now driven entirely by the shared Event Timeline widget's own 1H/6H/1D/1W/1M/1Y preset buttons (anchored to real "now"), with a default "1 day ending now" search auto-firing on entering Playback. Manual Start/End Time moved into that same widget as "Selected Time" (`docs/event-timeline-component/SRS.md` FR-13), used by both this manual flow and FR-7.8's Calendar panel — fixing a latent bug where `onSelect` always wrote to the manual flow's fields even while the Calendar flow was active. FR-7.8.2/7.8.4/7.8.5/7.8.6 updated: `#calendar_start_date`/etc. retired in favor of internal `currentCalendarSearchRange` state; a Calendar-side preset click re-runs the same Overlapped Id + Timeline sequence for `[now-preset, now]` instead of a clicked day's own range. See `docs/window-ui/DESIGN.md`'s corresponding rewrite and `MEMORY.md` for the full scope-discovery narrative. |
| 2.1 | 2026-08-31 | Youngho Kim | FR-7.1/FR-7.8: Control:/Seeking Date/Seeking Time/BestshotFilter (`#playback_video_controls`, new) split out of `#playback_control` into their own sibling, gated on Playback mode alone (`isPlayback`) rather than on `showManual` — these are video-playback controls, not manual-flow search UI, so `updatePlaybackSunapiUIVisibility()` hiding all of `#playback_control` whenever the Calendar/SUNAPI flow was active had been hiding Seeking Date/Time (and Forward/Backward/Speed) along with it too, for no reason tied to search mode. Reported directly by the user (Seeking Date/Time not visible while testing the FR-14 draggable marker below). See `docs/event-timeline-component/SRS.md` FR-14. |
| 2.2 | 2026-08-31 | Youngho Kim | FR-7.7: `playback` mode's separate `#seeking_date`/`#seeking_time` display (added v2.1's `#playback_video_controls`) retired — unified into the same `#timestamp_date`/`#timestamp_time` pair `live` mode already used (`updateTimestampReadout()`, shared by both cases), per the user's explicit request. `#playback_video_controls` no longer contains Seeking Date/Seeking Time fields at all (Control:/ISO checkbox/BestshotFilter remain). The Event Timeline's drag-seek handler (`onCustomTimeSeek`, `docs/event-timeline-component/SRS.md` FR-14) now also force-resets the player to forward speed (`playSpeed = '1'`) on every drag-seek, as a mitigation for a reported reverse-playback symptom (most likely cause: a stale negative `#speed` selection persisting across an unrelated seek) — not verified against real hardware. |
| 2.3 | 2026-08-31 | Youngho Kim | FR-7.7: `#timestamp_time` widened to `160px` — legacy's own sizing was too narrow to display the full `00:00:00.000`. Reported directly by the user. |
| 2.4 | 2026-08-31 | Youngho Kim | FR-7.7: `#timestamp_date` widened to `140px` — same underlying cause as v2.3, just for the date field: legacy's `100px` was too narrow to render the full `2026-09-01` in a disabled native date input, clipping the last digit and visually leaving a trailing `-`. Reported directly by the user. |
| 2.5 | 2026-08-31 | Youngho Kim | Added FR-4.10: `#http_type_toggle` locked to `document.location.protocol` outside the extension (`src/shared-v2/`-only — a `chrome-extension://` page has no such scheme to match). Requested directly by the user, who is planning further Chrome-Extension-vs-web-access differences beyond this one. |
| 2.6 | 2026-08-31 | Youngho Kim | FR-1.2: `#auto_discovery_toggle` now calls `socket.start()`/`socket.stop()` outside the extension, matching what disabling `#init`/`#disconnect` implied was already happening. Reported directly by the user as a Chrome-Extension-vs-web-access difference. |
| 2.7 | 2026-08-31 | Youngho Kim | FR-4.10: fixed `discovery.ts`'s device-selection handler silently overriding the http/https lock (a disabled radio can still be re-checked via script) whenever a discovered device was selected. Reported directly by the user as the lock appearing "reversed" — it was actually fine on load, only broken by the very next device click. |
| 2.8 | 2026-08-31 | Youngho Kim | FR-4.10: v2.7 was incomplete — the real trigger was `playerEvents.ts`'s `onchangeport()` unconditionally setting `player.https` from the selected device's port, one hop upstream of the `'changeprotocol'` event `onchangeprotocol()` reacts to. Guarded both. Reported directly by the user with an exact repro showing the bug still reproduced after v2.7. |
| 2.9 | 2026-08-31 | Youngho Kim | FR-4.10: `#port`/`player.port` now get the same lock as the http/https radios — outside the extension, device selection defaults the port to `80`/`443` matching the locked scheme instead of the selected device's own advertised port. Requested directly by the user. |
| 2.10 | 2026-08-31 | Youngho Kim | FR-7.6: `"Normal"` now also gets its own detail row (when present), same as any distinct Rule# — previously only ever shown merged into `"All"`. Requested directly by the user. |
| 2.11 | 2026-08-31 | Youngho Kim | FR-7.6: an empty (but valid) `Results[]` no longer skips mounting the timeline entirely; `updateTimeline()`'s own requested date range is threaded through as the widget's `dataRange` so 1H/6H/1D/1W/1M/1Y (and the initial default search) always show their full requested period, empty or not. Also: the overview row's own track now responds to mouse wheel zoom (`docs/event-timeline-component/SRS.md` FR-5 v2.7), matching the detail-rows area. Requested directly by the user. |
| 2.12 | 2026-09-01 | Youngho Kim | FR-7.6: `eventAppliesToChannel()` fixed to check *every* `state.dynamicRuleEntries` entry sharing a Rule number, not just the first one `.find()` happens to land on. Reported directly by the user comparing a real device's raw `recording.cgi` Timeline response against the rendered timeline: when the same numeric Rule is configured separately per channel (the same fact FR-7.6 v1.25's cross-channel-leak fix already relies on), a `.find()` keyed on Rule number alone could match a *different* channel's entry first and wrongly reject a legitimate same-channel event whose own entry sat elsewhere in the array — making the rendered timeline visibly sparser than the camera's actual data. `resolveEventLabel()` (v1.19) already matched Rule number AND channel together in one predicate; `eventAppliesToChannel()` now does the same. |
| 2.13 | 2026-09-01 | Youngho Kim | Added FR-3.4: `#password` is now `type="password"` (was `type="text"`, plaintext) with a show/hide eye-icon toggle button (`#password_toggle`). New-page-only — `src/shared/`'s own `#password` is untouched (still `type="text"`, no toggle); see DESIGN.md's Deviations list. Requested directly by the user. |
| 2.14 | 2026-09-01 | Youngho Kim | FR-7.1/FR-7.8.2/FR-7.8.4/FR-7.8.5/FR-7.8.6: Overlapped Id moves out of `#overlapped_id_area`/`#calendar_overlapped_id_area` into the shared Event Timeline widget's own toolbar (`docs/event-timeline-component/SRS.md` FR-15 v2.11), immediately left of the 1H/6H/1D/1W/1M/1Y preset buttons — the same single-canonical-control move v2.0 already did for Selected Time. `playbackCalendar.ts`'s `runCalendarTimelineSearch()` (the Rule-change handler, which doesn't re-fetch Overlapped Id) now reads the query's `overlappedId` from the widget's own live selection when it's still valid for the currently-cached list, falling back to that list's default otherwise, and threads it back into `updateTimeline()` so the remount doesn't silently reset it. Requested directly by the user. |
| 2.15 | 2026-09-01 | Youngho Kim | FR-7.8.2: `#event_rules_type` (Rule) moves out of `#calendar_search_area` into the shared Event Timeline widget's own toolbar (`docs/event-timeline-component/SRS.md` FR-16 v2.12), immediately left of Overlapped Id — same move as v2.14. `playbackCalendar.ts` mounts an empty-rows/items "shell" instance of the widget (`ensureEventTimelineShell()`) as soon as Rule data is ready so it's interactive before the first day/preset click, unlike Overlapped Id which stays absent until real search data exists; a real search later destroys and replaces the shell via `updateTimeline()` exactly like any other remount. `#playback_control_calendar` and `#timeline` are now laid out side by side (`.playback-calendar-timeline-row`, `src/shared/css/window.css`) instead of stacked, with `#playback_calendar`'s own `.field-row` flex-shrink bug (leaving a wide blank gap between the calendar grid and `#timeline`) fixed alongside it. Requested directly by the user. |
| 2.16 | 2026-09-01 | Youngho Kim | FR-7.8.1: `#event_rules_language` moves out of `#playback_control_calendar` into the Device panel's `#time_info` row, immediately left of `#is_android` — always visible regardless of Play Type, fetched (`getDeviceInfo()`) as soon as SUNAPI turns On (`device.ts`'s `on_change_use_sunapi_client()` → `playbackCalendar.ts`'s new `fetchDeviceLanguage()`) instead of waiting for this Calendar panel to first show. `initPlaybackCalendarPanel()` reuses that fetch's own settlement as `runMonthSearch()`'s first-call digest-auth-race barrier (see FR-7.8.4) in place of fetching `getDeviceInfo()` itself. FR-7.8.2's Rule fetch is unaffected — it still reads this same select's value once the Calendar panel shows, just a value that's normally already known by then. Requested directly by the user. |
| 2.17 | 2026-09-01 | Youngho Kim | Two visibility-toggle fixes in `updatePlaybackSunapiUIVisibility()`, both explicit `isPlayback`-driven `style.display` toggles matching `#playback_video_controls`'s existing pattern: (1) the v2.15 layout row (now `id="playback-calendar-timeline"`) is shown for Playback/hidden for Live as a whole, replacing the narrower `if (!isPlayback) { #timeline.style.display='none' }` special case, which only ever hid `#timeline` itself and left the row's own visibility merely implicit. (2) `#video_source_group` ("Video Source (selected channel)") now also hides during Playback and shows for Live — nothing gated it on Play Type before, so it stayed visible during Playback even though profile selection doesn't apply to an already-recorded segment; reported directly by the user with a screenshot. See `docs/window-ui/DESIGN.md` v1.32-v1.34. |
| 2.18 | 2026-09-01 | Youngho Kim | FR-7.7 fix, described in that section above. |
| 2.19 | 2026-09-01 | Youngho Kim | Added FR-7.7.1: `#iso_date_time_checkbox` wired to `player.useIsoTimeFormat`, fixing a real camera playback seek bug — removed from § Known dead controls accordingly. Reported directly by the user via a live console trace (`[RTSPOverWebSocket] seeking() rangeClock -> ...`, added at the user's request in `@melchi45/rtsp-over-websocket`'s `seeking()` to diagnose an Event Timeline drag-seek always landing on the same wrong position). See DESIGN.md's "Deviations from legacy behavior". |
| 2.20 | 2026-09-01 | Youngho Kim | FR-7.7: removed the `[FR-14] event_timeline_custom_time_hit -> ...` console log `updateTimestampReadout()` emitted on every move (added v2.18) — it did its job diagnosing FR-7.7.1's seek bug above; the underlying `@melchi45/rtsp-over-websocket` fix (see MEMORY.md) is what actually fixed the reported behavior, and the log firing many times a second during ordinary playback was pure noise once that landed. Removed directly at the user's request. |
| 2.21 | 2026-09-01 | Youngho Kim | FR-6.9 v1.27: Stop during Playback no longer silently fails to tear down the `<video>`/MSE state (real regression, `player.startTime = null` throwing and aborting the RTSP client's own connection callback before it reached the video-cleanup step) — `startTime`/`endTime` reset now gated on `playType === PLAYBACK` and wrapped in `try`/`catch`. Root-caused via a live console trace the user asked to have added across the whole RTSP-close call chain in `@melchi45/rtsp-over-websocket`. See DESIGN.md and MEMORY.md. |
| 2.22 | 2026-09-01 | Youngho Kim | FR-6.9 v1.28: Stop during Playback now resumes-from-stop-point on the next Play — `startTime` is set from `#timestamp_date`/`#timestamp_time`'s last value (the actual last-played position) instead of unconditionally `null`, read before those elements are removed. `endTime` stays always-`null`. Requested directly by the user. |
| 2.23 | 2026-09-01 | Youngho Kim | FR-7.5: `#speed` now also updates in the reverse direction — a device-corrected RTSP `Scale` (the device rejects/clamps the requested speed and reports back what it actually applied) is reflected in the dropdown via a new `changespeed` player event, `onchangespeed()`. Root cause and fix live entirely in `@melchi45/rtsp-over-websocket` (`Scale` response-header parsing plus a `resolvePlaySpeedEntry()`-based self-correction, no re-send); this repo only adds the listener. Reported directly by the user with a real RTSP transcript. See MEMORY.md. |
| 2.24 | 2026-09-01 | Youngho Kim | FR-7.6: `onDoubleClick` (line 368) now prefers the double-clicked item's own real `start`/`end` over the pixel-derived `time` whenever the double-click actually landed on an item — extracted the shared `applyItemToSelectedTime()` from `onSelect`'s body so `onDoubleClick` can also apply it (bypassing `onSelect`'s own `readyState === PLAYING` skip, which otherwise left Selected Time/`startTime`/`endTime` on a stale range during a double-click seek). Root cause was two-fold: `docs/event-timeline-component/SRS.md` FR-8 v2.14's pixel-ratio bug in the widget itself (fixed there), and this module's `onSelect`/`onDoubleClick` never coordinating when a double-click landed directly on an item. Reported directly by the user with a console trace: double-clicking a 4-minute event during active playback left `startTime`/`endTime` unchanged and seeked to neither the old range nor the double-clicked event. See `docs/event-timeline-component/DESIGN.md` v2.10/SRS.md v2.14. |
| 2.25 | 2026-09-01 | Youngho Kim | Added FR-6.11: `#forward`/`#backward` wired to the player's already-implemented `.forward()`/`.backward()` frame-stepping — removed from § Known dead controls accordingly. Reported directly by the user (Pause worked, but Forward/Backward never did anything); code review found the real methods already existed in `@melchi45/rtsp-over-websocket`, just never called from either `src/shared/` or `src/shared-v2/`. Per the user's explicit request, works independent of Pause/Resume, and Play after a subsequent Stop resumes from the stepped-to position via FR-6.9's existing v1.28 logic. See DESIGN.md's "Deviations from legacy behavior". |
| 2.26 | 2026-09-02 | Youngho Kim | FR-4.5/FR-7.8.1: `fetchDeviceLanguage()` no longer fires directly from `on_change_use_sunapi_client()`, synchronously alongside `initSunapiManager()` — moved into `initSunapiManager()`'s own `attributes.cgi` success handler instead, so `getDeviceInfo()`'s `system.cgi` request only fires once `attributes.cgi` has actually settled. Firing both concurrently hit the same vendored `@melchi45/rtsp-over-websocket` digest-auth race already documented at FR-7.8.4 (shared, unscoped `authCount` — whichever 401 is processed second gives up instead of retrying with credentials), reported directly by the user against a real device as both `attributes.cgi` and `system.cgi?msubmenu=deviceinfo` coming back `401` together. See DESIGN.md v1.43. |
| 2.27 | 2026-09-02 | Youngho Kim | FR-7.5: `#speed`'s `<option value="1">1x</option>` now carries `selected` — with none marked `selected`, the native `<select>` defaulted to `0.25x` (first in DOM order), silently disagreeing with `RTSPOverWebSocket.ts`'s own internal `_playSpeed` default (`1`). Since v2.23's self-correction only updates `#speed` on a mismatch between the device's echoed `Scale` and `_playSpeed`, a fresh page load or new playback open (device echoes `Scale: 1`, matching `_playSpeed`'s already-`1` default) never triggered it, leaving `#speed` stuck on `0.25x` indefinitely despite `1x` actually playing. Reported directly by the user with a real RTSP transcript, after the v2.23 path was traced end-to-end and confirmed working — isolating the bug to this HTML default. See DESIGN.md v1.44. |
| 2.28 | 2026-09-02 | Youngho Kim | FR-7.8.6: `resetPlaybackSearchStateForChannelChange()`'s `state.getSelectedPlayer().stop()` call is now individually `try`/`catch`-guarded — it throws 0x1000 ("player object is not exist") whenever Play was never clicked yet for the current device, which this function's own outer `try`/`catch` previously caught, silently skipping every step after it, including the Calendar's `getCalendarSearch()` re-fetch for the new channel. Reported directly by the user: `recording.cgi`'s `msubmenu=calendarsearch` request never fired after a channel change. |
| 2.29 | 2026-09-02 | Youngho Kim | FR-7.7.1 retired: `#iso_date_time_checkbox`, `onchangeisodatetime()`, and the underlying `player.useIsoTimeFormat` property are removed — a review requested by the user of every `_useIso`-gated branch in `@melchi45/rtsp-over-websocket` found checking the box could produce a camera URL with no start/end embedded (a dead `TODO: camera iso time style generate` stub), and its only real nvr-side effect (millisecond-fraction inclusion) had no known reason to be configurable. That package now always behaves the way `useIsoTimeFormat: true` used to. See DESIGN.md's closing entry and `@melchi45/rtsp-over-websocket`'s own `MEMORY.md`. |
| 2.30 | 2026-09-02 | Youngho Kim | FR-4.6.1/FR-4.6 retired/updated: `#universaltime_checkbox` ("Coordinate UTC Time"), `set_use_universal_time()`, and the underlying player `.coordinatedUniversalTime` property are removed — directly requested by the user as a follow-up to v2.29's `_useIso` removal. `@melchi45/rtsp-over-websocket`'s `startTime`/`endTime`/`seekingTime` setters now normalize any input to true UTC unconditionally, so `playback.ts`'s camera/nvr write branches collapse to always `.toISOString()`, `onSelectedTimeChange` writes a naive (no `'Z'`) string instead of a wrongly-UTC-labeled one, and Selected Time's UI display fields are computed independently from the source `item.start`/`item.end` rather than read back from the player. `updateTimestampReadout()` (FR-7.7 v2.18) takes an explicit `isUtcDigits` parameter per caller instead of reading the removed checkbox. See DESIGN.md's closing entry and both repos' own `MEMORY.md`. |
| 2.31 | 2026-09-02 | Youngho Kim | FR-6.11/FR-6.10: fixed `#forward`/`#backward` crashing (`Cannot read properties of null (reading 'forward')`) when a step click landed while `@melchi45/rtsp-over-websocket`'s `MediaRouter.player` was momentarily `null` from an independent RTP-packet-loss teardown (`onWaiting()`, gated on `supportCovertAndOff`) — root-caused in that package (see its own `MEMORY.md`/`docs/player/03-mediaSession-core-video.md`), fixed there with a `player !== null` guard plus a new `playerClosed` field on the `0x0107` error/`'waiting'` event. FR-6.10's `onWaiting()` (`videoControl.ts`, previously debug-log-only) now disables `#forward`/`#backward` when `waiting.detail.media === 'video' && waiting.detail.playerClosed === true`; no matching re-enable needed since the next `'statechange'` PLAYING event (FR-6.9) already does that. Reported directly by the user with a live console trace, which also surfaced (and was traced to a separate, unrelated cause) Pause/Resume buttons flipping mid-crash. See MEMORY.md. |
| 2.32 | 2026-09-02 | Youngho Kim | FR-6.11/FR-6.10 follow-up: `#forward`/`#backward` are now disabled immediately after a successful click and re-enabled on the next `'statechange'` STEP event (this step actually completed) or PLAYING event (covers v2.31's stalled-step/player-teardown path) — found live via a console trace showing dozens of overlapping `forward()` calls per second (a focused button's held-key auto-repeat, or rapid re-clicking), which `MediaRouter.ts`'s single shared step state machine (not per-direction) doesn't queue, so an overlapping click can stomp which direction an in-flight step resolves as. Disable only happens after a successful call (not a thrown error, e.g. wrong `playType`) so a rejected click never leaves the buttons stuck disabled with nothing to re-enable them. Reported directly by the user with a live console trace showing the resulting request flood. See MEMORY.md. |
| 2.33 | 2026-09-02 | Youngho Kim | FR-6.11/FR-6.10 follow-up to v2.31/v2.32: fixed a second, distinct null-player crash the prior two fixes didn't fully close — a step's own auto-pause ack (PAUSED `'statechange'`) can arrive and re-enable `#forward`/`#backward` (needed for the legitimate manual-pause-then-step case) *while* a separate, still-in-flight buffer-refill re-seek (triggered by an *earlier* step exhausting its local frame buffer) has `MediaRouter.player` still `null` — a race no amount of `'statechange'`-only gating can close, since there's no ordering guarantee between the two. `@melchi45/rtsp-over-websocket` now sources a dedicated `'playerstatechange'` DOM event (`{ available: boolean }`) directly from `MediaRouter.ts`'s `player` getter/setter itself, covering every null <-> non-null transition uniformly (not just `onWaiting()`'s covert-mode teardown, which is all v2.31's `playerClosed` field covered). `videoControl.ts` now tracks this as `playerAvailable` and routes every place that would enable the step buttons (`onstatechange()`'s PLAYING/PAUSED/STEP cases, via a new shared `updateStepButtonsEnabled()`) through it, so none of them can re-enable while a player-unavailable window is still open. Reported directly by the user with a fresh live console trace (a `backward()` crash) after v2.32 shipped, who also asked directly whether the null window could be eliminated entirely — answered as: not eliminable at the object level (a new decoder can only be constructed once new stream data confirms its parameters), but now made fully race-free at the UI level. See MEMORY.md and `@melchi45/rtsp-over-websocket`'s own `MEMORY.md`. |
| 2.34 | 2026-09-02 | Youngho Kim | FR-6.11/FR-6.10 follow-up to v2.33: `#forward`/`#backward` could still get stuck `disabled` after v2.33's fix — reported directly by the user: "video is visibly playing again but the buttons never re-enabled." `ontimestamp()`'s (`playback.ts`) `'playback'` case now calls a new `onPlayerFrameRendered(playType)` (`videoControl.ts`) on every rendered frame, which forces `playerAvailable` back to `true` and re-runs `updateStepButtonsEnabled()` — a frame actually being rendered is direct proof a live player exists, independent of whether `'playerstatechange'`/`'statechange'` fired and were processed in the expected order. This is a self-correcting fallback layered on top of v2.33's mechanism, not a replacement for it — `onPlayerStateChange()` still does the prompt disabling. |
| 2.35 | 2026-09-02 | Youngho Kim | FR-7.6/FR-7.8.2: reverted v1.19/v1.25/v2.12's channel filtering — `resolveEventLabel()` now matches purely by Rule number (no `EventSources[].Channel` check), `updateTimeline()` no longer filters `Results[]` by channel at all (the `eventAppliesToChannel()` helper is removed), and FR-7.8.2's Rule dropdown (`populateRuleSelect()`) lists every configured Rule regardless of channel. Reported directly by the user with a real device's `eventrules.cgi?msubmenu=dynamicrules` response (9 Rules across CH1/CH2) and a live screenshot: Channel 2's `Rule5`/`Rule6`/`Rule8`/`Rule9` (TD/Diff/MD) appearing while Channel 1 was selected/queried is not a cross-channel leak to hide — it's real Timeline data for a dual-sensor camera whose channels share one physical recording timeline, and both the Rule dropdown and the rendered results should show it. See MEMORY.md for the full reversal narrative. |
| 2.36 | 2026-09-03 | Youngho Kim | Added NFR-1 (Mobile layout) below, requested directly by the user. CSS-only (`css/window.css`/`css/table.css`, `src/component/event-timeline/event-timeline.css`) — no control, id, or module behavior changed, so no other FR needed updating. See `docs/window-ui/DESIGN.md`'s new "Mobile layout" section for the full rule list. |
| 2.37 | 2026-09-03 | Youngho Kim | FR-5.3 updated: the click-vs-`change`-event gap is now fixed here (no longer "preserved as-is") — reported directly by the user (a profile picked in Video Source wasn't taking effect on the player). See `docs/window-ui/DESIGN.md`'s new "Deviations from legacy behavior" entry (v1.57) for the full rationale; `docs/control-panel-data-binding.md` §4 is unchanged and still describes `src/shared/`'s own untouched gap. |
| 2.38 | 2026-09-03 | Youngho Kim | FR-5.1/FR-5.3 updated: `#profile` becomes a real `<select>` of the channel's profile Names once any exist, mirroring `#channel`'s own input-vs-select swap — requested directly by the user. See `docs/window-ui/DESIGN.md`'s new "Deviations from legacy behavior" entry (v1.58). |

## Conventions

- `FR-<section>.<n>` numbering, one section per panel/behavior group (matches `window.html`'s own
  structure).
- "Player" means `getSelectedPlayer()` — the currently-selected `<rtsp-over-websocket>` element.
- Unless stated otherwise, every listed handler is synchronous DOM state; SUNAPI-dependent steps say
  so explicitly.

## FR-1: Toolbar

- **FR-1.1**: `#init`/`#disconnect` start/stop discovery (`socket.start()`/`socket.stop()`),
  mutually toggling each other's `disabled` state.
- **FR-1.2**: `#auto_discovery_toggle` persists to `chrome.storage.local` (extension) or `POST
  /settings` (nodejs); on load, its state is read back the same way and, if on, disables
  `#init`/`#disconnect` (automatic mode owns discovery, per `docs/architecture.md`). **v2.6**: outside
  the extension, turning this on/reading it back as on also calls `socket.start()` (off calls
  `socket.stop()`) — in the extension, `background.ts`'s service worker independently keeps
  discovery running regardless of `window.html`, so disabling Start/Stop there is purely cosmetic;
  outside it, nothing else opens this page's own `/discover` WebSocket, so disabling Start/Stop
  without also calling `socket.start()` left the toggle's "on" state showing nothing and blocking the
  only control that could fix that. `server.ts`'s own background UDP loop was already running
  correctly the whole time — this was purely a client-side gap. Reported directly by the user
  (works in the extension, not via the nodejs server).
- **FR-1.3**: The dark-mode switch (`#toggle`, mounted via `mountSwitch` as `theme_switch`) sets
  `document.documentElement`'s `data-theme` attribute and swaps the toolbar icon image/label between
  "Dark Mode"/"Light Mode".
- **FR-1.4**: `#web` "Show Web Area" toggles `#webdiv` visibility; starts disabled and is enabled
  only once a device is selected (FR-2.5).

## FR-2: Discovery result panel

- **FR-2.1**: `#datatable_search` filters `dataSet` case-insensitively (substring match against any
  cell) and re-renders the active view (table and/or topology per FR-2.3).
- **FR-2.2**: Table column headers sort `dataSet` ascending/descending (toggling on repeat clicks of
  the same column); `#datatable_info` reports "Showing X to Y of Z entries (filtered from N)".
- **FR-2.3**: `#discovery_view_type` toggles between the table and the Star Topology view (full
  grouping/search-drilldown spec: `docs/star-topology/`).
- **FR-2.4**: `addDiscoveredDeviceRow()` dedupes by IP and appends to `dataSet`; called from the
  `discover` window `CustomEvent`, and (extension-only) `chrome.runtime.onMessage`
  `wisenet-discover-result` plus a one-time known-devices catch-up on load.
- **FR-2.5**: Selecting a device (table row click or topology leaf click) calls
  `applyDiscoveredDeviceSelection(row)` — full existing spec:
  [`docs/control-panel-data-binding.md`](../control-panel-data-binding.md) §1. Not re-specified here.
- **FR-2.6**: `#drag` lets the user resize `#left_panel`/`#right_panel` by dragging, clamped to the
  container's bounds.

## FR-3: Control panel — Session

- **FR-3.1**: `#player_list_div` (empty in the markup) gets a `<label for="player_list">`
  ("Plyaer List: " — typo preserved, user-visible legacy text) and a `<select id="player_list">`
  appended to it once at setup, *before* anything else touches `#player_list` — its `change`
  listener (`on_player_select()`) is attached at this same creation step, not separately. One
  `<option>` per `<rtsp-over-websocket>` element found on the page is appended after this; selecting
  a different one calls `on_player_select()` — full existing spec:
  [`docs/control-panel-data-binding.md`](../control-panel-data-binding.md) §2.
- **FR-3.2**: `#username`/`#password` write the player's `.username`/`.password`; each re-runs
  `initSunapiManager()` if SUNAPI is already on.
- **FR-3.3**: `#statistics` (default checked) writes the player's `.statistics`.
- **FR-3.4**: `#password` is masked (`type="password"`) by default. `#password_toggle` (an
  eye-icon button next to it) flips it to `type="text"`/back on each click, swapping its icon
  and `aria-pressed`/`aria-label` to match; it does not touch `player.password` or trigger
  `initSunapiManager()` — display-only. New-page-only, no `src/shared/` equivalent.

## FR-4: Control panel — Device

- **FR-4.1**: `#device_type` writes player `.device` ("camera"/"nvr").
- **FR-4.2**: `#hostname`/`#port` write player `.hostname`/`.port`; each re-runs SUNAPI init if on.
- **FR-4.3**: `#channel` (plain input, swapped for a `<select>` once SUNAPI populates channels —
  FR-5.1) writes player `.channel`, re-renders the video profile panel from cache immediately
  (FR-5.2), then re-runs SUNAPI init if on.
- **FR-4.4**: `#profile` writes player `.profile_number` if its value parses as an integer,
  otherwise `.profile` (nulling the other field either way).
- **FR-4.5**: The SUNAPI switch (`#use_sunapi_client_checkbox`, `sunapi_toggle`) and the full
  `initSunapiManager()` request chain (attributes → capability gating → video source/profile/policy
  → channel populate → timezone/date info → final player-state sync) — full existing spec:
  [`docs/control-panel-data-binding.md`](../control-panel-data-binding.md) §3. Not re-specified here.
- **FR-4.6**: Timezone: `#use_gmt` enables/disables `#timezone` and sets/clears player `.GMT`;
  `#timezone` writes player `.GMT` directly; the player's own `changetimezone` event syncs `#timezone`
  and force-unchecks `#use_gmt`. `#universaltime_checkbox` ("Coordinate UTC Time") and player
  `.coordinatedUniversalTime` are **removed** (v2.30) — `startTime`/`endTime`/`seekingTime` now
  normalize unconditionally to true UTC at the player's own setter (see
  `@melchi45/rtsp-over-websocket`'s `MEMORY.md`), making the checkbox's manual toggle obsolete.
- **FR-4.7**: The HTTP/HTTPS switch (`#http_type_toggle`) has **two independent** `change` handlers
  on the same radios: one defaults `#port` to 80/443 and re-runs SUNAPI init if on, the other writes
  player `.https`. The player's own `changeprotocol` event syncs the radio `.checked` directly
  (bypassing both handlers, same pattern as device selection).
- **FR-4.8**: `#native_tls_proxy_field` is hidden entirely outside the extension target; full spec:
  `docs/native-https-proxy/`. Not re-specified here.
- **FR-4.9**: `#is_android` writes player `.android`.
- **FR-4.10 (`src/shared-v2/`-only, v2.5)**: outside the extension, `#http_type_toggle` is locked to
  match `document.location.protocol` (both radios `.disabled = true`, `.checked` set to the matching
  option, `changehttptype()`/`onchangehttptype()` invoked once to sync `#port`/player `.https`/`.port`
  to match) — a page served over `https://` cannot issue `http://` requests at all (mixed-content
  blocking) and there's no reason to deliberately downgrade an `http://` page either, so this isn't
  actually a free choice outside the extension the way FR-4.7 treats it inside one (a
  `chrome-extension://` page has no such scheme to inherit/conflict with). `docs/switch-component/SRS.md`
  FR-12 covers the underlying disabled-radio styling this relies on. Requested directly by the user.
  **v2.7**: `discovery.ts`'s device-selection handler (`applyDiscoveredDeviceSelection()`, FR-2.5)
  was found to silently override this lock — `disabled` only blocks user clicks, not a scripted
  `.checked` assignment, so selecting any discovered device re-synced the radios to *that device's*
  own advertised protocol regardless. Guarded with `if (IS_EXTENSION)` around just the radio-sync
  lines (the native-TLS-proxy checkbox sync on the same lines is unaffected, extension-only anyway).
  Reported directly by the user as the toggle appearing to "reverse" itself. **v2.8**: v2.7 turned out
  incomplete — the real, deeper trigger was one level further down: `applyDiscoveredDeviceSelection()`
  sets `player.port` to the selected device's own port, the player custom element's own "port"
  attribute setter dispatches `'changeport'` as a side effect (regardless of extension/web),
  `playerEvents.ts`'s `onchangeport()` handled that by writing `player.https = (port === 443)`
  unconditionally, and *that* write is what triggers the player's own `'changeprotocol'` event that
  flips the radios via `onchangeprotocol()` (device.ts) — one hop removed from anything v2.7 touched.
  Fixed by also guarding `onchangeport()`'s `.https =` write with `IS_EXTENSION` (this is the real fix
  — it keeps the *actual* connection scheme consistent with the lock, not just the radios' visual
  state) and, as defense-in-depth, `onchangeprotocol()` itself. Reported directly by the user with an
  exact repro (`http://localhost:8080`, selecting a discovered `https://.../index.htm` camera on port
  443 flipped the toggle to HTTPS despite v2.7). **v2.9**: `#port`/`player.port` extended the same
  lock — in the extension, selecting a device still defaults `#port` to that device's own advertised
  port (`row_data[3]`, unchanged); outside it, `applyDiscoveredDeviceSelection()` now defaults it to
  `'80'`/`'443'` matching the locked scheme instead, so a device on a non-standard port never leaves
  `player.port` inconsistent with the locked HTTP/HTTPS choice. Requested directly by the user.

## FR-5: Video Source / Profile List

- **FR-5.1**: `setChannelWidgetMode(useSelect)` swaps `#channel` between a plain `<input>` and a
  `<select>` in place, preserving its current value and re-binding the `change` listener.
  `setProfileWidgetMode(useSelect)` (v2.38, `src/shared-v2/`-only — see DESIGN.md's "Deviations from
  legacy behavior" v1.58) mirrors this exactly for `#profile`: swaps it between the original typed
  `<input>` and a `<select>` of the selected channel's profile Names, re-binding `change` to
  `onProfileFieldChange`/`changeprofile` as appropriate. Called from `renderVideoProfileInfo()` (below)
  with `useSelect = profiles.length > 0` for the selected channel, and with `false` from
  `on_change_use_sunapi_client()`'s SUNAPI-Off branch alongside its existing
  `setChannelWidgetMode(false)` call. Unlike `setChannelWidgetMode()`'s own input→select swap (whose
  captured pre-swap value is never re-applied — dead on that path, since a brand-new `<select>` starts
  with no options to match it against), `renderVideoProfileInfo()` captures `#profile`'s pre-swap value
  and re-applies it once the new `<option>`s exist, so a value already there (typed manually, or
  restored from `player.profile`/`.profile_number` by session.ts's `on_player_select()`) carries over
  instead of being silently discarded. A native `<select>` always has *some* option selected, so with
  no prior value to restore, `#profile` silently defaults to the channel's first profile (highlighting
  its row) without firing `change` — same precedent `#channel`'s own select already set.
- **FR-5.2**: `renderVideoProfileInfo()` is a pure render from `deviceInformation.channels` (no
  network call): populates `#video_source_summary` and one `.profile-row` per profile in
  `#video_profile_list`, each showing Default/Event/Record badges (compared against the channel's
  `ProfilePolicy.DefaultProfile`/`EventProfile`/`RecordProfile` — non-exclusive, a profile can carry
  multiple badges) and an encoding-summary line; the row matching `#profile`'s current value gets
  `.selected`. Full badge-meaning spec: [`docs/control-panel-data-binding.md`](../control-panel-data-binding.md) §4.
  Also rebuilds `#profile`'s own `<option>`s when it's in `<select>` mode (FR-5.1), so the row list and
  the compact `#profile` field always reflect the same profile set.
- **FR-5.3**: Picking a profile — via `#profile`'s own `<select>` (FR-5.1, v2.38) or by clicking a
  profile row — applies to the player through one shared `applyProfileSelection()` helper: it calls
  `changeprofile()` (FR-4.4), then, if a Live stream is already playing, restarts it
  (`player.stop(); player.play();`) so the new profile takes effect immediately instead of only on the
  next explicit Play; not applicable to Playback, where `#video_source_group` is already hidden
  (v1.34). Clicking a profile row still sets `#profile`'s value via direct `.value =` assignment
  first (works whether `#profile` is currently an `<input>` or `<select>`) — since that never fires
  the native `change` event, the row-click handler calls `applyProfileSelection()` directly instead of
  depending on one. `#profile`'s own `<select>` mode doesn't have this gap (a real user selection
  always fires a genuine `change`, wired to `onProfileFieldChange()`, which calls
  `applyProfileSelection()` then re-renders the row list to keep its `.selected` highlight in sync).
  This is a fixed deviation from `src/shared/`'s own gap, documented in
  [`docs/control-panel-data-binding.md`](../control-panel-data-binding.md) §4 (that doc still
  describes `src/shared/`'s untouched original, where `#profile` also never becomes a `<select>`) —
  see `docs/window-ui/DESIGN.md`'s "Deviations from legacy behavior" (v1.57/v1.58).

## FR-6: Video Control

- **FR-6.1**: `#play_button`/`#stop_button`/`#pause_button`/`#resume_button` call the player's
  `.play()`/`.stop()`/`.pause()`/`.resume()`; `play()` only calls through when player `.device ===
  'camera'`.
- **FR-6.2**: `#capture_button` sets player `.filename` (from `#backup_filename`, or an ISO-timestamp
  fallback) then `.capture(filename)`; `#capture2_button` nulls `.filename` then calls `.capture()`
  with no argument (in-memory capture). The player's `capture` event populates `#capture`'s `<img>`
  via `URL.createObjectURL` and opens the capture modal (FR-13).
- **FR-6.3**: The Live/Playback switch (`play_type_toggle`) shows/hides `#playback_control`, sets
  player `.playType`, and resets player `.overlappedId = 0` when switching to Playback.
- **FR-6.4**: `#framedrop` and `#iframe` share one handler, writing player `.framedrop` — a second,
  `#iframe`-specific function exists in source but is never wired to anything (dead, see § Known
  dead controls).
- **FR-6.5**: `#reconnect` has no listener of its own; it is only *read* inside the player's
  `statechange` handler's `STOPPED` branch — if checked, playback restarts immediately.
- **FR-6.6**: `#minimap` writes player `.minimap`; starts disabled, enabled only while playing.
- **FR-6.7**: `#bestshot` writes player `.bestshot`.
- **FR-6.8**: `#renderer_type` writes player `.type` ("null"/"video"/"canvas"), defaulted to
  `'video'` at setup to match the HTML's pre-selected option.
- **FR-6.9**: The player's `statechange` event is the master button-state machine: `PLAYING` enables
  Stop/Pause/capture, disables Play/Resume, conditionally enables Unmute/Forward/Backward/Speed;
  `STOPPED` removes any injected live-clock fields, resets all button states, disables audio
  controls, honors `#reconnect` (FR-6.5), and clears the player's own `startTime`/`endTime` back to
  `null` (v1.26, `src/shared-v2/` only) so a later plain Play doesn't silently reuse a stale prior
  playback range; `PAUSED` swaps Pause↔Resume; `STEP` enables Resume/capture. **v1.27**: the
  `startTime`/`endTime` reset now only runs when the stopped player's own `playType` is
  `PLAYBACK` (Live never sets these fields, so there is nothing to reset), and is wrapped in its own
  `try`/`catch` — matching this same branch's documented `#timestamp_date`/`#timestamp_time`
  `.remove()` guard above, since a real regression hit the exact same failure class: clicking Stop
  during Playback sent a real RTSP `TEARDOWN` and got a real response, but the `<video>` element
  never actually stopped (kept looping its last ~2s of buffered MSE data) — `player.startTime =
  null` threw (`@melchi45/rtsp-over-websocket`'s `startTime` setter never accepted `null`, unlike
  `endTime`'s, fixed there too — see that package's `MEMORY.md`), and since that throw happened
  synchronously inside a `dispatchEvent` chain invoked from deep within the RTSP client's own
  connection callback, it unwound all the way back up and aborted the callback *before* it ever
  fired the one responsible for tearing down the local video/MSE state. Found live via a console
  trace the user asked to have added across that whole chain. Reported directly by the user.
  **v1.28**: `startTime` is no longer unconditionally nulled — read (before the `#timestamp_date`/
  `#timestamp_time` elements are removed a few lines above) from those fields' own last value (the
  last actually-played position, kept live by `updateTimestampReadout()`) and, when present, used to
  build `startTime` (`${date}T${time}Z`) instead of `null`, so a later plain Play resumes from where
  Stop was clicked rather than requiring a fresh Selected Time/timeline pick. Falls back to `null`
  when no timestamp was ever received this session (e.g. stopped immediately after Play, before the
  first `timestamp` event). `endTime` is still always cleared — resuming plays forward indefinitely
  from the stop point rather than staying bound to whatever range was originally searched for.
  Requested directly by the user.
- **FR-6.10**: The player's `error`/`close`/`meta`/`resize`/`waiting`/`statistics` events: `error`
  appends to `#debug` directly (own `_useDebug` gate, independent of `changedebug()`); `resize`
  additionally applies the reported width/height to the named element; the rest are debug-log-only
  or no-ops (`statistics`'s body is fully commented out). **v2.31**: `waiting` is no longer purely a
  no-op — when its detail reports `media === 'video' && playerClosed === true` (a new field
  `@melchi45/rtsp-over-websocket` added to the `'waiting'` event, signaling that this particular
  RTP-packet-loss notice also tore down the player's internal decoder — see FR-6.11 v2.31 below),
  `onWaiting()` (`videoControl.ts`) additionally disables `#forward`/`#backward` for that window.
  **v2.33**: this `onWaiting()`-based disable was removed again (not a revert of v2.31 — a
  simplification) — `playerClosed` and the new `'playerstatechange'` event (FR-6.11 v2.33 below)
  are both sourced from the exact same `MediaRouter.player` setter call, so the new event already
  covers this case, and does so more correctly (it also keeps the buttons disabled through any
  later PAUSED/PLAYING/STEP statechange that arrives before the player actually comes back, which
  this narrower special-case didn't).
- **FR-6.11 (v2.25, real behavior — no longer a "Known dead control")**: `#forward`/`#backward`
  call the player's `.forward()`/`.backward()` — real frame-level stepping already implemented in
  `@melchi45/rtsp-over-websocket` (`RTSPOverWebSocket.ts`, backed by the canvas renderer's
  `StepBufferList`), just never wired to these buttons in either `src/shared/` or `src/shared-v2/`.
  Both methods only require the player's `playType` to be `PLAYBACK` (checked internally, throws
  otherwise) — not a particular `readyState` — so stepping works independent of Pause/Resume, per
  the user's explicit request. Each step's resulting `timestamp` event flows through the existing
  `ontimestamp()`/`updateTimestampReadout()` pipeline (FR-7.7) exactly like ordinary playback does,
  keeping `#timestamp_date`/`#timestamp_time` current at the stepped-to position — which is what
  FR-6.9's v1.28 resume-from-stop-point logic already reads on the next Stop → Play, so no
  additional plumbing was needed for "Play resumes from where Forward/Backward left off."
  Frame-accurate stepping itself only works with `#renderer_type` set to `"canvas"` —
  `VideoTagPlayer.forward()`/`backward()` (the `"video"` renderer, the default) are no-ops in the
  library, a pre-existing constraint of `@melchi45/rtsp-over-websocket`, not something this app
  controls. **v2.31 (fixed, found live)**: clicking `#forward`/`#backward` while
  `MediaRouter.player` (an internal, lower-level object than the `RTSPOverWebSocket` element itself)
  was momentarily `null` — torn down independently by `onWaiting()`'s covert-mode/packet-loss
  teardown — used to throw `Cannot read properties of null (reading 'forward')` inside
  `@melchi45/rtsp-over-websocket`, caught by `videoControl.ts`'s own `try`/`catch` (so the page never
  crashed, but the step silently failed). Root-caused and fixed in that package (`player !== null`
  guard, replacing a non-null assertion — see its own `MEMORY.md`); this repo's complementary fix is
  FR-6.10 v2.31 above, which proactively disables the buttons for the teardown window instead of
  relying solely on the library-side guard's silent no-op.
  **v2.32 (fixed, found live)**: `forward()`/`backward()` (`videoControl.ts`) now disable both
  `#forward`/`#backward` immediately after a successful call, only re-enabled by the next
  `'statechange'` STEP event (this step actually completed) or PLAYING event (covers the v2.31
  stalled-step path) — a console trace showed a focused button's held-key auto-repeat (or rapid
  re-clicking) firing dozens of overlapping `forward()` calls per second, and `MediaRouter.ts`'s
  step state (`stepFlag`/`stepCmd`/`stepStatus`) is one shared machine, not per-direction, so an
  overlapping click doesn't queue — it can stomp which direction the in-flight step resolves as.
  The disable is placed after the call succeeds, not before/on-error, so a click rejected for
  wrong `playType` (still throws, per above) never leaves the buttons stuck disabled with no event
  left to re-enable them.
  **v2.33 (fixed, found live)**: v2.31/v2.32 still left a real race — a step's own auto-pause ack
  (PAUSED `'statechange'`) can arrive and re-enable `#forward`/`#backward` (needed for the
  legitimate "manually paused, now want to step" case) *while* a separate, still-in-flight
  buffer-refill re-seek (triggered by an *earlier* step exhausting its local frame buffer — see
  `@melchi45/rtsp-over-websocket`'s corrected `onRTSPOverWebSocketStep` doc entry, which previously
  undersold this to "first click only") has `MediaRouter.player` still `null`; there is no ordering
  guarantee between that unrelated ack and the re-seek's own completion, so gating solely on
  `'statechange'` readyState can never close this. `@melchi45/rtsp-over-websocket` now exposes a
  dedicated `'playerstatechange'` event (`{ available: boolean }`) sourced directly from
  `MediaRouter.ts`'s `player` getter/setter — the one signal that's ground truth for "does a live
  decoder exist right now," independent of readyState. `videoControl.ts` tracks this as a module
  flag, `playerAvailable`, and every place that would enable the step buttons (`onstatechange()`'s
  PLAYING/PAUSED/STEP cases) now goes through a shared `updateStepButtonsEnabled(playType)` that
  checks it, instead of setting `.disabled = false` directly — so none of them can re-enable while
  the flag says the player is momentarily gone. As a side effect, this also fixed a narrower
  pre-existing gap: those same three cases previously only ever *set* `#forward`/`#backward`
  inside their own `playType === PLAYBACK` check and never *cleared* it otherwise, so switching to
  `LIVE` mid-PLAYBACK-session could leave them stale-enabled until some other case happened to
  reset them; `updateStepButtonsEnabled()` now unconditionally disables them for any non-`PLAYBACK`
  `playType` too.
  **v2.34 (fixed, found live)**: reported directly by the user as a follow-up to v2.33 — the
  buttons could still end up stuck `disabled` even after video had visibly resumed, if the
  `'playerstatechange'`/`'statechange'` events driving `playerAvailable`/`updateStepButtonsEnabled()`
  happened to be processed in an order that left `playerAvailable` at `false` past the point the
  player was actually usable again. `ontimestamp()` (FR-7.7, `playback.ts`) now calls a new
  `onPlayerFrameRendered(playType)` on every rendered `'playback'`-mode frame, forcing
  `playerAvailable` back to `true` and re-running `updateStepButtonsEnabled()` — a frame being
  rendered at all is direct, unambiguous proof a live player exists, so this is a safe
  self-correcting fallback layered on top of v2.33's event-driven mechanism, not a replacement for
  the prompt disabling `onPlayerStateChange()` still does.

## FR-7: Playback

- **FR-7.1 (v2.0, `src/shared-v2/` only)**: search is driven entirely by the shared Event Timeline
  widget's own 1H/6H/1D/1W/1M/1Y preset buttons (`docs/event-timeline-component/SRS.md` FR-5),
  anchored to real wall-clock **now** — there is no typed date-range input in this panel any more.
  `updateManualPlaybackPanelVisibility(isVisible)` (`playback.ts`), called from
  `updatePlaybackSunapiUIVisibility()` (`playbackCalendar.ts`, FR-7.8) whenever `#playback_control`'s
  own visibility is decided, fires a default "1 day ending now" search (`runManualTimelineSearch()`)
  the first time this panel becomes visible each time Playback mode is (re-)entered (mirroring
  FR-7.8.3's Calendar auto-firing its first month search) — self-initializing a SUNAPI session if
  needed, exactly as the retired `search_overlapped_id()` used to. **As of FR-15
  (`docs/event-timeline-component/SRS.md` v2.11)**, the resulting Overlapped Id select renders
  inside the shared Event Timeline widget's own toolbar (`#overlapped_id`, immediately left of the
  1H/6H/1D/1W/1M/1Y buttons), not a standalone `#overlapped_id_area` any more. A preset click
  re-fires the same sequence for `[now - preset, now]` instead. DEVIATION from legacy behavior
  (`#search_overlapped_id`/`#search_date`/`#start_date`/`#end_date`/`#support_end_time`/the 1 Day-3
  Month toggle/`#search_timeline` are all retired) — reported directly by the user: "start_time isn't
  a search feature ... search should default to 1 day, using the timeline's own preset buttons."
  `src/shared/`'s own original manual flow is untouched and keeps its legacy behavior.
- **FR-7.2**: retired (v2.0) — `search_date()`'s own recorded-day-range-clamping feature had no
  remaining date-range input to clamp once FR-7.1 above removed `#start_date`/`#end_date`.
  `parseRecordedDaysFromCalendarSearch()` (the shared per-day-bitmask parser it introduced) is kept,
  still used by FR-7.8.4's Calendar month search.
- **FR-7.3**: getOverlappedIdList()/getTimeline() are now issued by `runManualTimelineSearch()`
  (FR-7.1 above) instead of the retired `search_oneday_timeline()`/`search_three_month_timeline()`/
  shared `runTimelineSearch()` dispatch — sequenced (Overlapped Id, then Timeline), same digest-auth-
  race rationale as FR-7.8.5's Calendar equivalent (see `MEMORY.md`). **`getTimeline()` resolves with
  `{TimeLineSearchResults: [{Channel, Results: [...]}]}` — the array `updateTimeline()` needs is
  `timeline.TimeLineSearchResults`, not the resolved value itself** (the vendored SDK's
  `getTimeline()` has no `extract` option, so it returns the device's response envelope as-is). If
  `timeline` itself is falsy, throw `timeline.Error.Details` (matches the original; not defensively
  guarded). `#timeline`'s `display` is set to `"block"` on success, not `"inline"` (its own static
  HTML default, easy to mistake for what code should set it back to).
- **FR-7.4 (v2.0)**: Manual Start/End Time moved into the shared Event Timeline widget as "Selected
  Time" (`docs/event-timeline-component/SRS.md` FR-13) — see FR-7.6 below for the full behavior.
  `#start_date`/`#start_time`/`#end_date`/`#end_time`/`#support_end_time`/`#manual_end_time_group`
  no longer exist in `src/shared-v2/`; `docs/architecture.md`'s "Playback controls" section documents
  the legacy (pre-v2.0) design these replaced, still accurate for `src/shared/`'s own untouched
  original.
- **FR-7.5**: `#speed` writes player `.playSpeed`; starts disabled until playback begins. **v2.23**:
  the reverse direction also exists now — the player's own `changespeed` event (dispatched by
  `RTSPOverWebSocket.ts` when a device rejects/clamps a requested RTSP `Scale` and reports back the
  one it actually applied instead) updates `#speed`'s displayed value to match
  (`onchangespeed()`, `playback.ts`, wired in `playerEvents.ts`). Without this, `#speed` kept
  showing the requested speed even when the device was actually playing at a different one — reported
  directly by the user with a real RTSP transcript (`Scale: 0.75` requested, `Scale: 1` echoed back
  in the `200 OK`). A corrected value with no matching `<option>` is a normal native `<select>`
  no-op. **v2.27**: `<option value="1">1x</option>` now carries `selected` — with no `<option>`
  marked `selected`, a native `<select>` defaults to whichever is first in DOM order, which for
  `#speed` is `0.25x`, not `1x`. That default silently disagreed with
  `RTSPOverWebSocket.ts`'s own internal `_playSpeed` default (`speed_1x`, value `1`), so on a fresh
  page load or a brand-new playback open, the device's `Scale: 1` response matched `_playSpeed`
  exactly — no mismatch for v2.23's self-correction to detect — and `#speed` was left showing
  `0.25x` indefinitely even though playback was actually running at `1x`. Reported directly by the
  user with a real RTSP transcript (`Scale: 1.000000` requested and echoed back) after the v2.23
  self-correction path was traced end-to-end and found to be working correctly, isolating the bug
  to this HTML default instead. `src/shared/window.html`'s equivalent `#speed` markup has the
  identical missing-`selected` issue, left as-is since that tree is untouched by this reimplementation.
- **FR-7.6**: `updateTimeline(results)` builds and mounts a custom event-timeline widget
  (`src/component/event-timeline/`'s `mountEventTimeline()`) — **not** `vis.Timeline` as of v1.16;
  see [`docs/event-timeline-component/`](../event-timeline-component/) (MRD/PRD/SRS/DESIGN/TC) for
  the widget's own full spec, this is only a pointer. `updateTimeline()` still builds the same
  `"All"` (every Normal + Rule# event on one row) + one-row-per-distinct-Rule# data shape as v1.15
  did (`assignEventColorClass()`'s Rule#-keyed coloring, unique second `id` for each Rule#'s
  duplicated row copy — unchanged), just reshaped into the new component's `rows`/`items` options
  instead of a `vis.DataSet`/groups pair. **v2.10**: `"Normal"` additionally gets its own detail row
  too (only when at least one Normal-classed item is present, same as any Rule# row), instead of
  only ever appearing merged into `"All"` — requested directly by the user. **v2.11**:
  `updateTimeline()` used to skip mounting anything at all (just a "Result is empty" popup) whenever
  a search's `Results[]` came back empty — relaxed to only treat the *outer envelope* being empty
  (`results.length === 0`) as that error case; a valid response with zero matching events for the
  requested period (an ordinary outcome for a short preset like 1H) now still mounts an empty
  timeline, with `updateTimeline()`'s own requested `[fromDate, toDate]`/`[strSearchStartTime,
  strSearchEndTime]` threaded through as the widget's new `dataRange` (`docs/event-timeline-component/SRS.md`
  FR-2 v2.7) so the full requested period is what's actually shown, not a collapsed
  wherever-the-data-happens-to-be range. Requested directly by the user. As of v1.17, each item's/
  row's *displayed* `label` (not
  its `id`/`rowId`, which stay the raw `Type` string for grouping/coloring) resolves a `"Rule<N>"`
  `Type` to that rule's configured `RuleName` via `resolveEventLabel()`, looked up in
  `state.dynamicRuleEntries` (the same `getDynamicRules()` entries FR-7.8.2's Rule dropdown uses,
  cached there by `refreshEventRules()`) with the same `Type=Rule<N>` = entry's 0-based `Rule` + 1
  offset documented under FR-7.8.2 — falling back to the raw `Type` string if no matching/named
  rule is cached (e.g. the calendar panel hasn't fetched rules yet this session). v1.19 through
  v2.12 additionally required the candidate entry's `EventSources` to include the currently
  selected player's own channel, and v1.25/v2.12 filtered `Results[]` itself the same way before it
  ever reached `updateTimeline()`'s rows/items — both reverted as of **v2.35**: a real device's
  Timeline response for one channel legitimately includes another channel's configured Rules (e.g.
  a dual-sensor camera whose optical/thermal channels share one physical recording timeline), so
  the earlier channel check was hiding/mislabeling real data rather than filtering out a leak.
  Reported directly by the user with a real device's `eventrules.cgi?msubmenu=dynamicrules`
  response and a live screenshot: Channel 2's `Rule5`/`Rule6`/`Rule8`/`Rule9` (TD/Diff/MD) showing
  while Channel 1 was selected/queried are real Timeline results that belong on the rendered
  timeline, not a cross-channel leak. `resolveEventLabel()` now matches purely by Rule number, and
  `updateTimeline()` no longer filters `Results[]` by channel at all (the `eventAppliesToChannel()`
  helper is removed). `"Normal"` items are returned unchanged, never looked up, since they're not
  rule-triggered data. `onSelect` syncs
  Selected Time (GMT-aware) from the clicked item — **as of v2.0, this lives inside the Event
  Timeline widget itself** (`docs/event-timeline-component/SRS.md` FR-13:
  `#selected_start_date`/`#selected_start_time`/`#selected_has_end_time`/`#selected_end_date`/
  `#selected_end_time`, via `setSelectedTime()`), not the previous `#start_date`/`#end_date`
  (FR-7.4, retired) — the single "what will play" state shared by both this manual flow and FR-7.8's
  Calendar panel; a user directly editing those inputs raises `onSelectedTimeChange`, applying the
  same GMT-aware `player.startTime`/`endTime` update. As of v1.18 (preserved through the v2.0 move)
  this sets and enables **both** Start and End Time for every item, `"Normal"`-classed items
  included — a DEVIATION from `src/shared/`'s legacy behavior, which nulled `endTime` and disabled
  End Time specifically for `"Normal"`-classed items, with no documented rationale, even though
  `recording.cgi`'s Timeline response always carries a real `EndTime` for every result row
  regardless of `Type`. Reported directly by the user as unwanted; see `docs/window-ui/DESIGN.md`'s
  "Deviations from legacy behavior". A remount (every search) would otherwise reset Selected Time to
  the widget's own "now, no end" default — `playback.ts`'s `lastSelectedTime` persists and
  re-applies the last selection across each remount, and `clearSelectedTime()` (called by FR-7.8.6's
  channel-change reset) resets both it and the player's `startTime`/`endTime` back to that default.
  `updateTimeline()` also takes an optional second parameter, `onRangePresetSelect`, forwarded
  straight into `mountEventTimeline()` — supplied differently per caller (this module's own
  `onManualRangePresetSelect`, or `playbackCalendar.ts`'s Calendar-flow equivalent) so a preset click
  re-fetches through whichever flow's own search mechanism actually rendered the timeline being
  viewed, without `playback.ts` importing from `playbackCalendar.ts` (kept one-directional).
  `onDoubleClick` seeks the player, and
  `state.eventTimeline.setCustomTime()` (renamed from
  `state.visTimeline`) replaces the previous `addCustomTime()`/`setCustomTime()` calls — see
  `ontimestamp()` (FR-7.7). Reported directly by the user, who attached a reference screenshot of a
  different application's dark "ONVIF Timeline" view (a collapsible "ALL EVENTS" overview/zoom-
  scrubber row, per-type named detail rows, zoom controls) and, given a choice between reskinning
  `vis.Timeline`'s colors or a full custom rebuild, chose the full rebuild — `vis.Timeline` has no
  native overview/minimap concept to reskin that specific request onto (see
  `docs/event-timeline-component/MRD.md`). **The separate, unrelated `vis.Timeline` item-positioning
  bug** documented for v1.14/v1.15 (every item collapsing to the same pixel position in this app's
  real `#right_panel` layout, root cause never found — see `MEMORY.md`) **no longer applies to
  `src/shared-v2/`** as of this change, since it no longer uses `vis.Timeline` for this feature at
  all; the bug still lives on in `src/shared/`'s own untouched original, which is unaffected by this
  change and still uses `vis.Timeline`.
- **FR-7.7**: The player's `timestamp` event: both `live` and `playback` mode share one lazily-
  injected, read-only `#timestamp_date`/`#timestamp_time` pair (`updateTimestampReadout()`) kept in
  sync with the current position; `playback` mode additionally moves the timeline's custom-time
  marker, from that exact same `dateStr`/`timeStr` (**v2.18**, see below), while actually PLAYING —
  otherwise clears it (`updateTimestampReadout()`'s own `moveTimelineMarker` parameter, default
  `true`). **v2.2**: `playback` mode used to sync a separate, static `#seeking_date`/`#seeking_time`
  pair instead — unified into the same fields `live` mode uses, per the user's explicit request,
  since both were the same concept (a read-only current-position readout) under two different
  names/mechanisms for no functional reason. **v2.3**: `#timestamp_time`'s inline width widened to
  `160px` (legacy's own `min-width: 130px;width: 100px !important;` was too narrow to render the
  full `00:00:00.000` the `step="0.001"` millisecond field needs room for) — a deliberate deviation
  from legacy's sizing, not a port, requested directly by the user. **v2.4**: `#timestamp_date`
  likewise widened to `140px` (legacy's `100px` clipped the last digit of `2026-09-01`, visually
  leaving a trailing `-`). **v2.18**: the timeline marker's own Date used to be computed separately
  from this readout, via a parallel GMT-aware `moment` calculation (branching on `#use_gmt`/device
  type) in `ontimestamp()`'s own `'playback'` case — that computation could drift from what this
  readout itself displayed, leaving the marker positioned far from the actually-playing instant
  `#timestamp_date`/`#timestamp_time` correctly showed at the same moment. Reported directly by the
  user with a screenshot. Now sourced from `updateTimestampReadout()`'s own `dateStr`/`timeStr`
  instead — the same value already proven correct by the readout, moved inside
  `updateTimestampReadout()` itself per the user's explicit instruction, guarded by a new
  `moveTimelineMarker` parameter so the pre-existing "only while actually PLAYING" clearing
  behavior is preserved. Whether the reconstruction appends a trailing `'Z'` now depends on
  `#universaltime_checkbox` (`player.coordinatedUniversalTime`) — checked means this device's own
  timestamps are being treated as true UTC (append `'Z'`, matching `dateStr`/`timeStr`'s own origin:
  every caller splits a `'Z'`-suffixed `toISOString()` string), unchecked means local-styled digits
  instead, matching how the Event Timeline's own items already parse SUNAPI's bare, timezone-less
  `"YYYY-MM-DD HH:mm:ss"` wire format (`updateTimeline()`'s `new Date(timeline_element.StartTime)`,
  parsed as LOCAL time per standard JS Date parsing of an unsuffixed string — see
  `tools/mock-sunapi-server/server.js`'s `formatLocalSunapiTime()` comment, confirmed against a real
  device). An initial version of this fix always appended `'Z'` regardless of this checkbox, which
  the user caught live and had corrected to check `#universaltime_checkbox` explicitly — getting
  this wrong in either direction shifts the reconstructed instant by this machine's own UTC offset
  relative to how the surrounding items are positioned. **v2.20**: the `[FR-14]
  event_timeline_custom_time_hit -> ...` console log this used to emit on every move (added v2.18,
  per the user's own request to check the resolved marker Date live against the checkbox's state)
  is removed — it served its purpose diagnosing the FR-7.7.1 seek bug below and firing on every
  timestamp update (many times a second during playback) was pure noise once that diagnosis was
  done. Removed directly at the user's request. **v2.34**: `ontimestamp()`'s `'playback'` case now
  also calls `onPlayerFrameRendered()` (`videoControl.ts`) on every rendered frame — see FR-6.11
  v2.34 below; a step-button-availability fallback, not part of the timestamp-readout behavior
  documented above.
- **FR-7.7.1 — retired (v2.29).** `#iso_date_time_checkbox`/`onchangeisodatetime()` (`videoControl.ts`)
  and the underlying `player.useIsoTimeFormat`/`_useIso` property it wrote have both been removed.
  This requirement originally existed (v2.19) to work around a real camera seek bug in
  `@melchi45/rtsp-over-websocket`'s `seeking()`, but DESIGN.md v1.37 already established the actual
  fix landed entirely in that package and the checkbox's own wiring was "no longer load-bearing."
  A further review of every `_useIso`-gated branch in that package (requested by the user) found the
  flag's `true` state was a literal `// TODO: camera iso time style generate (legacy: unimplemented)`
  no-op for camera devices in `generateRTSPURL()` — checking the box could produce a URL with no
  start/end embedded in the path at all — and its only real effect for nvr devices (whether a
  millisecond fraction was included in the outgoing `rangeClock`) had no known reason to be
  configurable. `@melchi45/rtsp-over-websocket` now always behaves the way `useIsoTimeFormat: true`
  used to (drop the fraction; for camera, always the real implementation, never the TODO stub) — see
  that package's own `MEMORY.md` and `docs/player/01-elements-interface-exceptions.md`. See DESIGN.md's
  "Deviations from legacy behavior" for the closing entry.
- **FR-4.6.1 — retired (v2.30).** `#universaltime_checkbox` ("Coordinate UTC Time") and the
  underlying player `.coordinatedUniversalTime` property it wrote have both been removed, directly
  requested by the user as a follow-up to FR-7.7.1's `_useIso` removal above. Player
  `startTime`/`endTime`/`seekingTime` now normalize unconditionally to true UTC at the setter
  (`@melchi45/rtsp-over-websocket`'s `normalizeTimeInputToUtcIso()`, see that repo's `MEMORY.md`),
  making the checkbox's manual "is this already UTC?" toggle obsolete — every write site in
  `playback.ts` that used to branch on `player.device === 'camera'` when building `startTime`/
  `endTime`/`seekingTime` (`applyItemToSelectedTime()`, `onDoubleClick`, `onCustomTimeSeek`) now
  always writes `.toISOString()` unconditionally, and `onSelectedTimeChange` (manual date/time input
  edits) now writes a naive (no trailing `'Z'`) string instead of a `'Z'`-suffixed one, letting the
  player's own setter GMT-convert it correctly rather than having it wrongly trusted as literal UTC.
  UI display fields (Selected Time's date/time inputs) are no longer read back from the player after
  writing — that would now show UTC digits instead of local ones — they're computed independently
  from the original `item.start`/`item.end` via `moment(...).utcOffset(state.localGmtOffset)`
  instead. `updateTimestampReadout()`'s FR-7.7 marker-reconstruction logic (v2.18 above) no longer
  reads the removed checkbox either — it now takes an explicit `isUtcDigits` parameter each caller
  declares directly, since a single global toggle could never correctly describe both of
  `ontimestamp()`'s own branches (`timestamp.detail.local`, local digits, vs.
  `timestamp.detail.timestamp`, true UTC) in the first place. See DESIGN.md's "Deviations from legacy
  behavior" and `MEMORY.md` for the full rationale.
- **FR-7.8 (new, `src/shared-v2/` only — no equivalent in `src/shared/`): SUNAPI-driven Calendar
  search.** When both `#playback_radio` is selected **and** SUNAPI is On, `#playback_control_calendar`
  replaces `#playback_control` entirely (FR-7.1–FR-7.4's manual buttons/fields); every other state
  (Live mode, or Playback with SUNAPI Off) shows `#playback_control` exactly as FR-7.1–FR-7.7
  describe, unchanged. `updatePlaybackSunapiUIVisibility()` (`playbackCalendar.ts`) does this
  toggle, called from both `on_change_use_sunapi_client()`'s success path (`device.ts`) and
  `onchangeplaytype()` (`videoControl.ts`) — the two places that can flip either half of the
  "Playback AND SUNAPI-On" condition. As of v1.20, this function also hides `#timeline` (FR-7.6)
  whenever Play Type is switched to Live — `#timeline` is a deliberate sibling of both
  `#playback_control`/`#playback_control_calendar` (see its own HTML comment) so switching *between*
  the manual/calendar sub-panels while still in Playback mode never touches it, but nothing
  previously hid it when leaving Playback mode entirely, so a Playback search's results stayed
  visible under the Live controls. Reported directly by the user, who noticed the Date fields hide
  correctly on switching to Live but the timeline didn't. Gated specifically on `!isPlayback`, not
  the general "else" branches above, so the manual/calendar sub-panel toggle keeps its existing
  documented behavior.
  - **FR-7.8.1 — Language**: `#event_rules_language` itself lives in the Device panel (next to
    `#is_android`), not inside `#playback_control_calendar` — `getDeviceInfo()` is called and its
    selection set to the response's `Language` field as soon as SUNAPI turns On
    (`device.ts`'s `on_change_use_sunapi_client()` → `initSunapiManager()`'s own `attributes.cgi`
    success handler → `playbackCalendar.ts`'s `fetchDeviceLanguage()`, **as of v2.21** — not fired
    directly from `on_change_use_sunapi_client()` itself, see that version's row below),
    regardless of Play Type, rather than waiting for this Calendar panel to first become visible —
    moved directly per the user's explicit request. FR-7.8.2's Rule fetch (below) still reads this
    same select's value once the Calendar panel does show; `initPlaybackCalendarPanel()` reuses
    `fetchDeviceLanguage()`'s own settlement as `runMonthSearch()`'s first-call barrier in place of
    fetching `getDeviceInfo()` itself (see that function's comment). The dropdown's *options* are a
    static 16-entry list (English, Korean, Chinese, French, Italian, Spanish, German, Japanese,
    Russian, Portuguese, Czech, Polish, Turkish, Dutch, Hungarian, Greek) — SUNAPI's own documented
    `attributes.cgi` `Language` parameter enum, not server-fetched (no endpoint returns "which
    languages does this device support" as a list).
  - **FR-7.8.2 — Rule**: `#event_rules_type`'s first, default option is always `"All"` (value
    `"All"`) — `getTimeline()`'s own `type` parameter already defaults to `"All"` when omitted
    (`SunapiManager.ts`'s `buildTimelineUri()`), so this is offered explicitly rather than requiring
    a specific rule to be chosen before searching. `getDynamicRules(language)`
    (`eventrules.cgi?msubmenu=dynamicrules`) is called and its `Rules` array populates the remaining
    options — **as of v2.35**, one option per configured Rule regardless of channel (an earlier
    design filtered to entries whose `EventSources[]` include the currently-selected channel,
    reverted after the user confirmed a real device's Timeline response for one channel legitimately
    includes another channel's configured Rules, e.g. a dual-sensor camera whose optical/thermal
    channels share one physical recording timeline — see FR-7.6's own v2.35 entry and MEMORY.md).
    Each option's `value` is `'Rule' + (Rule + 1)` — the
    Timeline endpoint's `Type=Rule<N>` numbering is 1-based, one higher than `getDynamicRules()`'s
    own 0-based `Rule` field (e.g. `Rule: 0` → `Type=Rule1`) — this is exactly what `getTimeline()`'s
    `type` parameter expects (confirmed against a real device's
    `recording.cgi?msubmenu=timeline...&Type=Rule1` request — see `MEMORY.md`) — and its *label* is
    the rule's own `RuleName` (the user-configured display name, e.g. `"움직임 감지 (CH1)"`), falling
    back to `"Rule " + (Rule + 1)` only if `RuleName` is absent. Changing
    `#event_rules_language` re-fetches with the new language and repopulates this dropdown; changing
    the channel selector (`#channel`) also re-fetches (`refreshRuleSelectForChannelChange()`) to stay
    in sync with `resetPlaybackSearchStateForChannelChange()`'s own channel-change reset, even though
    the resulting option list is no longer channel-scoped as of v2.35. (An earlier design built this list from
    `getDynamicRulesOptions()`+`getDynamicRules()` merged by `EventSources[].Type` instead — real
    device testing showed the Timeline endpoint doesn't accept that `Type` value at all, only
    `Rule<N>`, so that design was retracted in favor of the one described here.)
    **As of v1.23**, `#event_rules_type`'s field lives inside `#calendar_search_area`, not in its own
    field-row next to `#event_rules_language` — it's a Timeline search filter, not a device-wide
    setting like Language. It shows/hides together with that container: hidden until FR-7.8.4's month
    search first resolves (same as every field after it), and hidden again by FR-7.8.6's channel-
    change reset — populating its *options* (`getDynamicRules()`) is unaffected either way, since that
    never depended on visibility. Reported directly by the user. (**As of FR-15**,
    `docs/event-timeline-component/SRS.md` v2.11, Overlapped Id itself is no longer a sibling field in
    `#calendar_search_area` — it moved into the shared Event Timeline widget's own toolbar, populated
    independently of this container's visibility; see FR-7.8.4 above.)
    **As of v1.24**, `#event_rules_type` also has its own `change` listener: selecting a different
    Rule immediately re-runs `getTimeline(from, to, channel, overlappedId, newRuleType)` for whatever
    date range is already set, with `overlappedId` read from the shared widget's own current selection
    (**as of FR-15**, `state.eventTimeline?.getOverlappedId()` when it's still a member of the last-
    fetched list, else that list's own default — see `docs/event-timeline-component/DESIGN.md`; was a
    direct `#calendar_overlapped_id` DOM read before that move). This runs via a new
    `runCalendarTimelineSearch()`, factored out of FR-7.8.5's `runOverlappedAndTimelineSearch()` so a
    Rule change doesn't also redundantly re-fetch Overlapped Id, which doesn't depend on `Type`, and
    redraws `#timeline`
    (FR-7.6) from the response — previously the Rule dropdown only took effect on the *next* day
    click, leaving whatever was already on screen stale until then. No-ops silently if nothing has
    been searched yet this panel-visible session — **as of v2.0**, tracked as
    `playbackCalendar.ts`'s own internal `currentCalendarSearchRange` module state (`null` until the
    first day/preset click) rather than reading back from `#calendar_start_date`/`#calendar_end_date`
    (retired along with FR-7.4's manual-flow equivalent, see FR-7.4/FR-7.8.4/FR-7.8.5/FR-7.8.6 below).
    Reported directly by the user with the real `recording.cgi?msubmenu=timeline...&Type=All`
    request that should have reflected the newly-selected Rule instead.
  - **FR-7.8.3 — Calendar**: `mountCalendar()` (`src/component/calendar/` — see
    `docs/calendar-component/`) mounts on the current year/month into `#playback_calendar`,
    immediately followed by a month search (FR-7.8.4) for that month. The component's own prev/next
    navigation re-triggers a month search for the newly-shown month.
  - **FR-7.8.4 — Month search**: `getCalendarSearch(YYYY-MM, channel)` is called for whichever month
    the Calendar is showing. The very first call each time the panel is (re-)shown waits for
    `getDeviceInfo()` (FR-7.8.1) to settle first, rather than firing concurrently — see
    `runMonthSearch()`'s own comment and `MEMORY.md` for why: a real, confirmed race in the vendored
    `@melchi45/rtsp-over-websocket` library's digest-auth retry counter otherwise intermittently
    401s whichever of the two "cold" requests loses the race, reported directly by the user against
    a real device. Subsequent month navigation isn't delayed, since the digest challenge is cached
    by then. Its `CalenderSearchResults` bitmask is parsed by
    `parseRecordedDaysFromCalendarSearch()` (exported from `playback.ts` — the exact per-day-bitmask
    logic FR-7.2's `search_date()` already has, factored out so both stay byte-identical in
    behavior) into a list of days-of-month with recordings, passed to the Calendar controller's
    `setHighlightedDays()` (`search_date()` itself is retired as of v2.0, FR-7.2 above — its
    per-day-bitmask parser lives on as this shared export). Once this resolves (regardless of
    whether any day has recordings), the Rule control becomes visible —
    `#calendar_search_area`, containing `#event_rules_type` (its own id, separate from FR-7.1's
    manual panel, so the two panels' own ids/behavior stay untouched of each other). **As of FR-15**
    (`docs/event-timeline-component/SRS.md` v2.11), Overlapped Id itself is no longer part of
    `#calendar_search_area` at all — it moved into the shared Event Timeline widget's own toolbar
    (`#overlapped_id`), the same single-canonical-control move FR-7.6/FR-7.4 already did for Selected
    Time, so it's populated once a day/preset search actually resolves (`#timeline` mounts), not
    alongside the Rule dropdown's own reveal. **As of v2.0**, Manual Start/End Time is no longer part
    of this reveal at all — it moved into the shared Event Timeline widget as Selected Time (FR-7.6/FR-7.4),
    populated only by clicking a rendered item, not by this month search or a day click.
    As of v1.21, `channel` selector changes (`#channel`, `device.ts`'s `changechannel()`) also
    re-trigger this month search for whichever month/year the Calendar is currently showing —
    `getCalendarSearch()`'s highlighted-recorded-days data is channel-scoped, so without this,
    switching channels while this panel is visible left the highlighted days stuck showing the
    *previous* channel's recordings until the user manually navigated the month.
    **As of v1.22**, this was folded into a broader `resetPlaybackSearchStateForChannelChange()`
    (`playbackCalendar.ts`, replacing v1.21's narrower `refreshCalendarSearchForChannelChange()`),
    since a channel change invalidates more than just the highlighted days — see the new "Channel
    change during Playback" subsection below for the complete 5-part scenario, reported directly by
    the user. This month re-search itself now passes `revealSearchArea: false` to `runMonthSearch()`
    (a new parameter, default `true` for every pre-existing caller/behavior) so the re-fetch doesn't
    undo that same reset's hiding of `#calendar_search_area` — there's nothing yet to reveal for the
    new channel until a day is clicked again.
  - **FR-7.8.6 — Channel change during Playback (new, v1.22).** Reported directly by the user as a
    complete 5-part scenario for whenever `#channel` changes while Play Type is Playback:
    1. This Calendar's highlighted-recorded-days data refreshes for the new channel (FR-7.8.4 above).
    2. `#timeline` (FR-7.6) hides, regardless of which Playback search UI populated it.
    3. Overlapped Id resets to empty and its UI hides.
    4. Selected Time (FR-7.6/FR-7.4; Manual Start/End Time at the time this was originally written)
       resets to its "now, no end" default and its UI hides.
    5. The player (`state.getSelectedPlayer()`) stops — it may still be playing/paused on the
       *previous* channel's recording.

    All five are handled by one new function, `resetPlaybackSearchStateForChannelChange()`
    (`playbackCalendar.ts`), called unconditionally from `device.ts`'s `changechannel()` (it gates
    itself internally, matching this file's existing convention). It first checks Play Type is
    Playback (no-op otherwise); if so, items 2 and 5 run regardless of SUNAPI state — `#timeline`
    and the player are shared by both Playback search UIs (this Calendar panel and FR-7.1's manual
    flow) — then items 1/3/4 run only if this Calendar panel is actually visible (SUNAPI On):
    `playbackCalendar.ts`'s own cached `currentOverlappedIds` list resets to `[]` and the shared
    Event Timeline widget's Overlapped Id select is cleared (`state.eventTimeline?.setOverlappedIds([])`,
    **as of FR-15**, `docs/event-timeline-component/SRS.md` v2.11 — was
    `#calendar_overlapped_id`/`#calendar_overlapped_id_span` removal before that move),
    `currentCalendarSearchRange` clears (v2.0 — was `#calendar_start_date`/etc. before FR-7.4's move
    into Selected Time), `#calendar_search_area` hides, the Calendar's selected-day highlight clears
    (`setSelectedDay(null)`), the player's `overlappedId` resets (`0`), `clearSelectedTime()`
    (`playback.ts`, v2.0) resets Selected Time and the player's `startTime`/`endTime`, and finally
    FR-7.8.4's month search re-runs (`revealSearchArea: false`) for the new channel. Since Overlapped
    Id is now the shared widget's own single control (FR-15), this same reset also covers FR-7.1's
    manual flow — there's no longer a separate manual-flow Overlapped Id state to reset independently.
    **v2.28 real bug fix**: item 5's `state.getSelectedPlayer().stop()` call is now individually
    `try`/`catch`-guarded — `stop()` throws `RTSPOverWebSocketError` 0x1000 ("player object is not
    exist") whenever Play was never clicked yet for the current device (the element's internal player
    instance is only created lazily inside `play()`), and that throw was previously caught by this
    whole function's own outer `try`/`catch`, silently skipping every step *after* it — including
    item 1's `getCalendarSearch()` re-fetch, so the Calendar's highlighted days never actually
    refreshed for the new channel. Reported directly by the user: `recording.cgi`'s
    `msubmenu=calendarsearch` request never fired after a channel change.
  - **FR-7.8.5 — Day click**: only reachable for a highlighted (has-recordings) day. As of v1.23,
    unconditionally re-shows `#calendar_search_area` first (`display: ''`) — defensive, since a day
    stays clickable independently of that container's own visibility, and FR-7.8.6's channel-change
    reset deliberately leaves it hidden until the next month navigation; without this, a day click
    right after a channel change (no month nav in between) would populate Rule into a still-hidden
    container, invisible to the user (Overlapped Id itself, as of FR-15, populates into the shared
    `#timeline` widget's own toolbar instead, independent of `#calendar_search_area`'s visibility).
    **As of v2.0**, computes the clicked day's
    `00:00:00`-`23:59:59` range and passes it directly into `runOverlappedAndTimelineSearch(from,
    to)` (no longer written into `#calendar_start_date`/etc., retired — see FR-7.4) — the function
    also tracks it as `currentCalendarSearchRange` (FR-7.8.2's own no-op guard reads this) and, once
    it settles, calls `getOverlappedIdList(from, to, channel)`, and once *that* settles,
    `getTimeline(from, to, channel, overlappedId, ruleDropdownValue)` — sequenced, not fired
    concurrently the way FR-7.1/FR-7.3's own equivalent pattern does; see `MEMORY.md` for why
    (a real, confirmed digest-auth race in the vendored `@melchi45/rtsp-over-websocket` library,
    reported by the user against a real device). Caches the fetched `OverlappedIDList` (as of FR-15,
    `docs/event-timeline-component/SRS.md` v2.11, in the module-level `currentOverlappedIds`, no
    longer DOM-built into `#calendar_overlapped_id_area`) and passes it straight through to FR-7.6's
    existing `updateTimeline()` (its `overlappedIds` parameter), which renders into the *same shared*
    `#timeline` widget's own toolbar Overlapped Id select, passing `onCalendarRangePresetSelect` as its
    `onRangePresetSelect` — **v2.0**: a subsequent 1H/6H/1D/1W/1M/1Y click on that timeline re-runs
    this same Overlapped Id + Timeline sequence for `[now-preset, now]` instead of the clicked day's
    own range, via that same `runOverlappedAndTimelineSearch()`.

## FR-8: Audio

- **FR-8.1**: `#unmute`/`#mute` call the player's `.unmute()`/`.mute()`, only when currently in the
  opposite state and playing.
- **FR-8.2**: `#volume` writes player `.volume`, only while unmuted and playing.
- **FR-8.3**: `#audio_shift` writes player `.audioshift`.
- **FR-8.4**: The player's `changemute` event toggles Unmute/Mute/Volume/GetAudioVolume/Talk disabled
  state per `event.detail.status` and re-syncs `#volume`/`#getaudiovolume`; `changevolume` syncs
  `#getaudiovolume`/`#volume` from `event.detail.volume`.
- **FR-8.5**: All audio controls start disabled and are only enabled by the `PLAYING` branch of
  FR-6.9 / by FR-8.4.

## FR-9: Backup

- **FR-9.1**: `#backup_checkbox`: validates `#backup_filename` isn't blank (unless in Playback mode,
  which alerts and force-unchecks otherwise); in Playback mode also enables `#speed` and sets player
  `.playType = BACKUP`; checked → sets `.filename` and calls `.backup(true)`; unchecked → `.backup(false)`.
- **FR-9.2**: `#backup_filename` is read by FR-9.1/FR-6.2; has no listener of its own.

## FR-10: Instant playback

- **FR-10.1**: `#instantplayback_checkbox` sets player `.playType` to `INSTANTPLAYBACK`/`LIVE`.

## FR-11: Screen

- **FR-11.1**: `#fullscreen`'s `click` (not `change`) unconditionally flips player `.fullscreen`
  (does not read the checkbox's own `.checked`). The player's own `changefullscreen` event calls the
  identical toggle function again — see § Known dead controls / behavioral note for the resulting
  double-toggle risk this preserves as-is.

## FR-12: Debug/Discovery/RTSP disclosure panels

- **FR-12.1**: The three panels (`#debug_disclosure`/`#discovery_disclosure`/`#rtsp_disclosure`) —
  full existing spec: `docs/disclosure-component/`. Not re-specified here.
- **FR-12.2**: `#use_debug` (default checked) gates whether `changedebug()`/the player's `error`
  handler append to `#debug`; `#clear_debug` clears it; `#debug`'s own `input` listener truncates to
  `maxlength` client-side.
- **FR-12.3**: `changedebug(data)` is the single choke point most handlers funnel through: appends
  `data + "\r\n"` (gated by FR-12.2) and scrolls to bottom.
- **FR-12.4**: The player's `rtsp` event appends `"RTSP: " + message` to `#rtsp` and scrolls to
  bottom.

## FR-13: Modals

- **FR-13.1**: `initModal()` binds every `.close-popup` element's `click` to hide **both**
  `#myModal` and `#myCapture` (one shared handler, not modal-specific). `window.popup(message)`
  shows `#myModal` with the given message; `window.capture()` shows `#myCapture` (content populated
  by FR-6.2's `capture` event). No click-outside or Escape-key handling.

## FR-14: Player custom-element event wiring

- **FR-14.1**: Every event in FR-6/FR-7/FR-8/FR-11/FR-12/FR-13 above that's described as "the
  player's own event" is registered once per `<rtsp-over-websocket>` element found by
  `document.querySelectorAll("rtsp-over-websocket")` at setup — window.html has exactly one today,
  but the mechanism supports more (matches `docs/control-panel-data-binding.md` §2's Player List
  note).
- **FR-14.2**: At the same setup point, each element also gets non-listener defaults applied
  directly: `.loading = true`, `.framedrop = false`, `.GMT = null`, `.type = 'video'`.

## FR-15: Module state & helpers (behavioral contracts, not UI controls)

- **FR-15.1**: `getSelectedPlayer()` resolves `document.getElementById(selected_player_id)`.
  `on_player_select()` (FR-3.1) is called both on `#player_list`'s `change` event **and once,
  unconditionally, at setup** (after `#player_list`'s options already exist, since the two
  `DOMContentLoaded` listeners involved fire in registration order) — so `selected_player_id` is
  seeded from the first `<rtsp-over-websocket>` element's id immediately, and `getSelectedPlayer()`
  is not actually `null` after load given window.html always ships with at least one such element.
  The `!== null` guards several call sites still carry remain correct defensive code for a
  (currently unreached) zero-player page, not dead code — see
  [`docs/control-panel-data-binding.md`](../control-panel-data-binding.md) §2, corrected to match.
- **FR-15.2**: `getSunapiManager()` is a single lazily-constructed instance shared across whichever
  player is selected — not per-player.
- **FR-15.3**: `dataSet: string[][]` (`[Name, IPAddress, MACAddress, Port, URL, Protocol]`) is the
  single source of truth for both the table and topology views — see FR-2.
- **FR-15.4**: A startup block runs once, independent of any control's own `change`/`click` handler,
  setting initial state that HTML alone doesn't express (found via Playwright equivalence testing —
  TC-17's `#end_date` mismatch traced back to this block being missing entirely from the first
  implementation, not just one field):
  - `#start_date`, `#end_date`, `#seeking_date` default to **today's date** (`YYYY-MM-DD`),
    overriding the static placeholder values baked into their HTML (`"2019-09-07"`/`"2018-07-22"`).
  - Disabled at setup, before any `statechange`/SUNAPI response has run: `#timezone`,
    `#unmute`/`#mute`/`#volume`/`#getaudiovolume`/`#talk` (FR-8), `#capture_button`/
    `#capture2_button`/`#minimap` (FR-6), `#bestshotfileter`/`#search_aitimeline`/`#search_timeline`/
    `#forward`/`#backward`/`#speed` (dead or SUNAPI-gated controls, FR-6/FR-7).
  - `#minimap`/`#reconnect`/`#bestshot` also start unchecked (`checked = false`).
  - This is spread across each control's owning module's own `setup*()` function (matching
    `src/shared-v2/`'s per-FR-section split), not one dedicated function — window.ts's original has
    it as one contiguous block (~L380-414) purely because that file is unsplit.
- **FR-15.5**: `initSunapiManager()` (FR-4.5) is guarded against redundant chains by
  `state.sunapiInitInFlight` — **a deliberate divergence from the original, which has no such
  guard at any of its ~12 call sites.** Additionally, `#username`/`#password`'s `change` handlers
  (FR-3.2) only re-init when the field's value actually differs from what's already stored, not on
  every `change` event unconditionally — a native, browser-fired `change` (e.g. blur, moving focus
  to `#use_sunapi_client_checkbox` right after typing credentials) fires even when nothing was
  edited. See [DESIGN.md](DESIGN.md)'s "Deviations from legacy behavior" for the full reasoning
  (found via CPU profiling + live request counting after a real-device performance report, not by
  reading source) and `docs/window-ui/TC.md`'s TC-27.

## NFR-1: Mobile layout

Requested directly by the user ("모바일에 맞게 레이아웃을 수정해야 합니다 ... 더 공간을 효율적으로
사용하는 레이아웃"). Below a `768px` viewport width, the page must lay out usably instead of squeezing
the desktop 30/70 side-by-side split (`#left_panel`/`#right_panel`) and every fixed-min-width panel
inside it into a phone-width screen. CSS-only (`css/window.css`, `css/table.css`, `src/component/
event-timeline/event-timeline.css`); no control's id, behavior, or FR above changes. Since
`css/window.css`/`css/table.css` are re-exported unmodified from `src/shared/css/`, this also applies
to `src/shared/`'s own `window.html`, not just `src/shared-v2/`. Full rule list:
[DESIGN.md](DESIGN.md)'s "Mobile layout" section.

## Known dead controls (preserved, not fixed)

Every one of these exists in `window.html`, is sometimes still `disabled`-managed by other code, but
has **no working handler** in the current implementation. The reimplementation (`src/shared-v2/`)
must keep every one of these inert (no listener), not wire them up and not literally reproduce the
`ReferenceError`-throwing `onclick` attributes — see [DESIGN.md](DESIGN.md) for the reasoning.

| Control(s) | Current behavior |
|---|---|
| `#search_aitimeline`, `#search_three_month_aitimeline` | No click handler at all. |
| `#use_bestshotfilter`, `#bestshotfileter` | No listeners; the select stays disabled forever. |
| `#timestamp_date`, `#timestamp_time` | Written to (FR-7.7, both `live` and `playback` modes as of v2.2), never read back — no action exists to use them. (Formerly two separate pairs — `live` mode's own `#timestamp_date`/`#timestamp_time` plus a `playback`-only `#seeking_date`/`#seeking_time` — unified into this one pair.) |
| `#talk` | No listener; `.checked` never read. |
| `#getaudiovolume` | Display-only; written to (FR-8.4), never read despite being editable. |
| `#backup_time` | Completely unreferenced. |
| `#media_record_start` | No handler of any kind. |
| `#media_record_stop`, `#media_record_show` | `onclick="mediaRecordStop()"`/`"mediaRecordShow()"` — neither function exists anywhere in the repo; throws `ReferenceError` in the original. |
| `#instantplayback_start`, `#instantplayback_end`, `#instantplayback_seek_time` | Never read by any code. |
| Instant playback Play/Pause/Seek buttons | `onclick="instantplayback_play()"`/`"instantplayback_pause()"`/`"instantplayback_seek()"` — none of these functions exist; throws `ReferenceError` in the original. |
| `#use_waiting_icon` | `onclick="useWaitIcon()"` — function doesn't exist; throws `ReferenceError` in the original. |
| `#displayVideo` | Never referenced by any script. |
| `onchangeiframeonly` | Defined but never wired — `#iframe` uses FR-6.4's shared handler instead. |
| `searchTree()`/`searchObject`, `popupWindow()` | Fully implemented, never called from anywhere. |
