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
  `#init`/`#disconnect` (automatic mode owns discovery, per `docs/architecture.md`).
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
  and force-unchecks `#use_gmt`; `#universaltime_checkbox` writes player `.coordinatedUniversalTime`.
- **FR-4.7**: The HTTP/HTTPS switch (`#http_type_toggle`) has **two independent** `change` handlers
  on the same radios: one defaults `#port` to 80/443 and re-runs SUNAPI init if on, the other writes
  player `.https`. The player's own `changeprotocol` event syncs the radio `.checked` directly
  (bypassing both handlers, same pattern as device selection).
- **FR-4.8**: `#native_tls_proxy_field` is hidden entirely outside the extension target; full spec:
  `docs/native-https-proxy/`. Not re-specified here.
- **FR-4.9**: `#is_android` writes player `.android`.

## FR-5: Video Source / Profile List

- **FR-5.1**: `setChannelWidgetMode(useSelect)` swaps `#channel` between a plain `<input>` and a
  `<select>` in place, preserving its current value and re-binding the `change` listener.
- **FR-5.2**: `renderVideoProfileInfo()` is a pure render from `deviceInformation.channels` (no
  network call): populates `#video_source_summary` and one `.profile-row` per profile in
  `#video_profile_list`, each showing Default/Event/Record badges (compared against the channel's
  `ProfilePolicy.DefaultProfile`/`EventProfile`/`RecordProfile` — non-exclusive, a profile can carry
  multiple badges) and an encoding-summary line; the row matching `#profile`'s current value gets
  `.selected`. Full badge-meaning spec: [`docs/control-panel-data-binding.md`](../control-panel-data-binding.md) §4.
- **FR-5.3**: Clicking a profile row sets `#profile`'s value via direct `.value =` assignment (does
  **not** fire `change`, so `changeprofile()`/FR-4.4 does not run as a side effect of the click — a
  known, documented gap, preserved as-is per [`docs/control-panel-data-binding.md`](../control-panel-data-binding.md) §4).

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
  controls, honors `#reconnect` (FR-6.5); `PAUSED` swaps Pause↔Resume; `STEP` enables Resume/capture.
- **FR-6.10**: The player's `error`/`close`/`meta`/`resize`/`waiting`/`statistics` events: `error`
  appends to `#debug` directly (own `_useDebug` gate, independent of `changedebug()`); `resize`
  additionally applies the reported width/height to the named element; the rest are debug-log-only
  or no-ops (`statistics`'s body is fully commented out).

## FR-7: Playback

- **FR-7.1**: `#search_overlapped_id` ensures a SUNAPI session, calls `getOverlappedIdList(start,
  end[, channel])` (GMT-aware), and on success builds a dynamic `<select id="overlapped_id">` inside
  `#overlapped_id_area`, sets player `.overlappedId`, and enables `#search_aitimeline`.
- **FR-7.2**: `#search_date` calls `getCalendarSearch(...)`, parses the returned per-day bitmask, and
  rewrites `#start_date`/`#end_date`'s values **and** `min`/`max` attributes to the recorded range;
  enables `#search_timeline`.
- **FR-7.3**: The 1 Day/3 Month switch (`search_timeline_range_toggle`) plus `#search_timeline` —
  full existing spec: `docs/switch-component/` (the switch itself) and `docs/architecture.md`'s
  "Playback controls" section (the search dispatch: `search_timeline_by_range()` →
  `search_oneday_timeline()`/`search_three_month_timeline()` → shared `runTimelineSearch()` →
  `getTimeline()` → `updateTimeline()`). Not re-specified here. **`getTimeline()` resolves with
  `{TimeLineSearchResults: [{Channel, Results: [...]}]}` — the array `updateTimeline()` needs is
  `timeline.TimeLineSearchResults`, not the resolved value itself** (the vendored SDK's
  `getTimeline()` has no `extract` option, so it returns the device's response envelope as-is). If
  `timeline` itself is falsy, throw `timeline.Error.Details` (matches the original; not defensively
  guarded). `#timeline`'s `display` is set to `"block"` on success, not `"inline"` (its own static
  HTML default, easy to mistake for what code should set it back to).
- **FR-7.4**: Manual Start/End Time (`#start_date`/`#start_time`/`#end_date`/`#end_time`,
  `#support_end_time`) — full existing spec: `docs/architecture.md`'s "Playback controls" section.
  Not re-specified here.
- **FR-7.5**: `#speed` writes player `.playSpeed`; starts disabled until playback begins.
- **FR-7.6**: `updateTimeline(results)` builds a `vis.Timeline` with Normal/Event groups (Event
  further subgrouped by detection type via `checkEventSubGroup`/`checkAIEventSubGroup`); `select`
  syncs the Manual Start/End Time fields (GMT-aware) from the clicked item, disabling End Time for
  "Normal" items (no real end); `doubleClick` seeks the player; group rows have a "Hide" button.
  Custom "moment" formatting respects `#use_gmt`/`#timezone`. `options.start`/`options.end` are set
  to "today"'s bounds, but **no explicit `fit()`/`setWindow()` call is needed or wanted** —
  `vis.Timeline` auto-fits its visible window to the real item range the first time `setItems()`
  runs with actual data, so the "today" options only matter before any items exist. An earlier draft
  of this spec called this a bug and required an explicit `fit()` call to "fix" it; that call
  actively broke rendering at realistic (~150-item) data volume and was removed — see
  [DESIGN.md](DESIGN.md)'s "Deviations from legacy behavior" (retracted entry) for the full story.
- **FR-7.7**: The player's `timestamp` event: in `live` mode, lazily injects read-only
  `#timestamp_date`/`#timestamp_time` fields kept in sync with the live clock; in `playback` mode,
  syncs `#seeking_date`/`#seeking_time` and moves the timeline's custom-time marker (GMT-aware).

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

## Known dead controls (preserved, not fixed)

Every one of these exists in `window.html`, is sometimes still `disabled`-managed by other code, but
has **no working handler** in the current implementation. The reimplementation (`src/shared-v2/`)
must keep every one of these inert (no listener), not wire them up and not literally reproduce the
`ReferenceError`-throwing `onclick` attributes — see [DESIGN.md](DESIGN.md) for the reasoning.

| Control(s) | Current behavior |
|---|---|
| `#search_aitimeline`, `#search_three_month_aitimeline` | No click handler at all. |
| `#forward`, `#backward` | No click handler at all. |
| `#iso_date_time_checkbox` | No listener. |
| `#use_bestshotfilter`, `#bestshotfileter` | No listeners; the select stays disabled forever. |
| `#seeking_date`, `#seeking_time` | Written to (FR-7.7), never read back — no action exists to use them. |
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
