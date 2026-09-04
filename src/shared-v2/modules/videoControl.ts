// Video Control -- SRS FR-6.

import { mountSwitch } from '../../component/switch/switch';
import { state } from './state';
import { beautifyXml, changedebug, changeonvif, fastJsonStringfy, scrollbottom } from './helpers';
import { updatePlaybackSunapiUIVisibility } from './playbackCalendar';

declare var AuthError: any;
declare var RTSPOverWebSocketBaseError: any;
declare var RTSPOverWebSocketPlayState: any;
declare var RTSPOverWebSocketPlayType: any;

/** FR-6.10/FR-6.11 v2.33: ground truth for whether the selected player's
 *  underlying `MediaRouter.player` (its canvas/video decoder instance)
 *  currently exists, sourced from the `'playerstatechange'` event
 *  (`onPlayerStateChange()` below) -- the one signal `@melchi45/rtsp-over-
 *  websocket` reports directly off that field going null <-> non-null,
 *  independent of readyState/statechange semantics. Defaults `true`
 *  because `#forward`/`#backward` start globally disabled (setupPlayback(),
 *  playback.ts) until the first real PLAYING/PAUSED/STEP statechange, by
 *  which point a genuine `play()` call has already created a player -- so
 *  there's no real window before the first `'playerstatechange'` event
 *  where this default could incorrectly permit a click through.
 *
 *  Every place that would enable `#forward`/`#backward` (the PLAYING/
 *  PAUSED/STEP cases in `onstatechange()` below) now goes through
 *  `updateStepButtonsEnabled()` instead of setting `.disabled` directly, so
 *  none of them can re-enable the buttons while this flag says the player
 *  is momentarily gone -- closing a race the click-time debounce in
 *  `forward()`/`backward()` alone couldn't: a step's own auto-`pause()` ack
 *  (PAUSED statechange) can arrive, and previously re-enabled the buttons,
 *  *while* an unrelated buffer-refill re-seek (triggered by an *earlier*
 *  step exhausting the local frame buffer) is still in flight and
 *  `MediaRouter.player` is still null -- a click landing in that specific
 *  window is exactly the `Cannot read properties of null (reading
 *  'backward')` crash reported live by the user, with a trace showing the
 *  disable/re-enable racing exactly as described. See MEMORY.md. */
let playerAvailable = true;

/** Shared by every `onstatechange()` case that would enable `#forward`/
 *  `#backward` -- see `playerAvailable`'s own comment above for why this
 *  needs to be the single choke point rather than each case setting
 *  `.disabled = false` directly. */
function updateStepButtonsEnabled(playType: unknown): void {
  const enabled = playerAvailable && playType === RTSPOverWebSocketPlayType.PLAYBACK;
  (document.getElementById('forward') as HTMLButtonElement).disabled = !enabled;
  (document.getElementById('backward') as HTMLButtonElement).disabled = !enabled;
}

/** FR-6.10/FR-6.11 v2.34: called from `ontimestamp()`'s `'playback'` case
 *  (playback.ts) on every rendered frame -- a frame actually being rendered
 *  is direct proof a live player instance exists, independent of whether
 *  the `'playerstatechange'` event that *should* say so has arrived/been
 *  processed yet. Added because a real player-teardown/recreate cycle
 *  (buffer-refill re-seek, resume-from-step, etc.) can hop through more
 *  than one `MediaRouter.player` reassignment in quick succession, and any
 *  ordering hiccup between those and the `'statechange'` events that also
 *  drive `updateStepButtonsEnabled()` could leave `#forward`/`#backward`
 *  stuck disabled even once video is visibly playing again. This is a
 *  correcting fallback, not the primary mechanism -- `onPlayerStateChange()`
 *  below still does the real work of disabling promptly; this only ever
 *  forces `playerAvailable` *back* to `true` when frames prove it should
 *  be. Reported directly by the user: buttons stayed disabled after video
 *  resumed. See MEMORY.md. */
export function onPlayerFrameRendered(playType: unknown): void {
  // Temporary diagnostic (2026-09-02): investigating a live report of
  // #forward/#backward staying disabled forever after a step. changedebug()
  // only writes to the #debug textarea (invisible unless that panel's
  // open), so this adds a real console.log to see the actual sequence.
  // console.log('[videoControl] onPlayerFrameRendered:', { playType, playerAvailable: true });
  playerAvailable = true;
  updateStepButtonsEnabled(playType);
}

/** FR-6.10/FR-6.11 v2.33, see `playerAvailable` above. */
export function onPlayerStateChange(evt: any): void {
  changedebug('onplayerstatechange: ' + fastJsonStringfy(evt.detail));
  console.log('[videoControl] onPlayerStateChange:', evt.detail);
  playerAvailable = evt.detail.available === true;
  if (!playerAvailable) {
    (document.getElementById('forward') as HTMLButtonElement).disabled = true;
    (document.getElementById('backward') as HTMLButtonElement).disabled = true;
  } else {
    try {
      const playType = (document.getElementById(evt.detail.elementId) as any).playType;
      updateStepButtonsEnabled(playType);
    } catch (error) {
      console.error(error);
    }
  }
}

export function play(): void {
  try {
    if (state.getSelectedPlayer().device === 'camera') {
      state.getSelectedPlayer().play();
    }
    // NVR path is fully commented out in the original -- no-op here too.
  } catch (error: any) {
    changedebug('play error: ' + fastJsonStringfy(error));
    if (error instanceof AuthError) {
      (window as any).popup('<div><h4>Error Code: ' + (window as any).toHex(error.errorCode) + '<br>Error: ' + error.message + '</h4></div>');
    } else if (error instanceof RTSPOverWebSocketBaseError) {
      (window as any).popup('<div><h4>Error Code: ' + (window as any).toHex(error.errorCode) + '<br>Error: ' + error.message + '</h4></div>');
    }
  }
}

export function onStopClick(): void {
  try {
    state.getSelectedPlayer().stop();
  } catch (error) {
    console.error('stop error:', error);
  }
}

export function pause(): void {
  try {
    state.getSelectedPlayer().pause();
  } catch (error) {
    console.error('pause error:', error);
  }
}

export function resume(): void {
  try {
    state.getSelectedPlayer().resume();
  } catch (error) {
    console.error('resume error:', error);
  }
}

/** FR-6.11: previously a "Known dead control" (no listener at all, see
 *  docs/window-ui/SRS.md) -- `@melchi45/rtsp-over-websocket` already
 *  implements real frame-level stepping (`RTSPOverWebSocket.ts`'s
 *  `forward()`/`backward()`, backed by the canvas renderer's
 *  `StepBufferList`), it was just never wired to these buttons. Works
 *  independent of Pause/Resume -- both methods only require `playType ===
 *  PLAYBACK` (checked internally), not a particular `readyState` -- and each
 *  step's resulting `timestamp` event updates `#timestamp_date`/
 *  `#timestamp_time` via the existing `ontimestamp()` pipeline
 *  (playback.ts), which is what FR-6.9's resume-from-stop-point logic reads
 *  on the next Stop -> Play. Requested directly by the user.
 *
 *  v2.32: both buttons are now disabled immediately after a successful call
 *  (not on a thrown error -- that means no request was actually sent, e.g.
 *  wrong playType, and nothing would ever come back to re-enable them) --
 *  found live via a console trace showing a focused button's held-key
 *  auto-repeat (or rapid re-clicking) firing dozens of overlapping
 *  `forward()`/`backward()` calls per second. `MediaRouter.ts`'s step state
 *  (`stepFlag`/`stepCmd`/`stepStatus`) is a single shared machine, not
 *  per-direction, so a `backward()` landing mid-`forward()`-step doesn't
 *  queue -- it stomps `stepCmd`, corrupting which direction the in-flight
 *  step resolves as; either button is disabled by either click. Re-enabled
 *  by `onstatechange()`'s STEP case (this step actually completed) and its
 *  existing PLAYING case (covers the FR-6.10 v2.31 player-teardown path,
 *  where no STEP ever fires for the stalled step -- the next PLAYING once a
 *  new decoder is recreated is what recovers there too). */
export function forward(): void {
  try {
    state.getSelectedPlayer().forward();
    (document.getElementById('forward') as HTMLButtonElement).disabled = true;
    (document.getElementById('backward') as HTMLButtonElement).disabled = true;
  } catch (error) {
    console.error('forward error:', error);
  }
}

/** FR-6.11, see forward() above. */
export function backward(): void {
  try {
    state.getSelectedPlayer().backward();
    (document.getElementById('forward') as HTMLButtonElement).disabled = true;
    (document.getElementById('backward') as HTMLButtonElement).disabled = true;
  } catch (error) {
    console.error('backward error:', error);
  }
}

/** FR-6.2. */
export function capture(): void {
  try {
    let filename = (document.getElementById('backup_filename') as HTMLInputElement).value;
    if (!filename || /^\s*$/.test(filename)) {
      filename = new Date().toISOString().replace(/-/g, '');
    }
    state.getSelectedPlayer().filename = filename;
    state.getSelectedPlayer().capture(filename);
  } catch (error) {
    console.error(error);
  }
}

export function capture2(): void {
  try {
    state.getSelectedPlayer().filename = null;
    state.getSelectedPlayer().capture();
  } catch (error) {
    console.error(error);
  }
}

export function oncapture(captureEvt: any): void {
  changedebug('onresize: ' + fastJsonStringfy(captureEvt.detail));
  const image = document.getElementById('capture') as HTMLImageElement;
  image.src = URL.createObjectURL(captureEvt.detail.blob);
  (window as any).capture();
}

/** FR-6.3. */
export function onchangeplaytype(): void {
  try {
    const checkedPlayType = document.querySelector('input[type="radio"][name="play_type"]:checked') as HTMLInputElement | null;
    const playtype = checkedPlayType ? checkedPlayType.value : undefined;

    if (playtype && playtype === 'playback') {
      state.getSelectedPlayer().playType = RTSPOverWebSocketPlayType.PLAYBACK;
      state.getSelectedPlayer().overlappedId = 0;
    } else {
      state.getSelectedPlayer().playType = RTSPOverWebSocketPlayType.LIVE;
    }
    // FR-7.8 (src/shared-v2/-only): #playback_control's own show/hide is
    // now owned by this, since it also decides between that panel and
    // #playback_control_calendar based on SUNAPI state.
    updatePlaybackSunapiUIVisibility();
  } catch (error) {
    console.error(error);
  }
}

/** FR-6.4: shared by #framedrop and #iframe (matches the original -- a
 *  separate onchangeiframeonly() exists but is never wired to anything;
 *  see SRS "Known dead controls"). */
export function onchangeframedrop(): void {
  try {
    state.getSelectedPlayer().framedrop = (document.getElementById('framedrop') as HTMLInputElement).checked;
  } catch (error) {
    console.error(error);
  }
}

export function onchangeminimap(): void {
  try {
    state.getSelectedPlayer().minimap = (document.getElementById('minimap') as HTMLInputElement).checked;
  } catch (error) {
    console.error(error);
  }
}

export function onchangebestshot(): void {
  try {
    state.getSelectedPlayer().bestshot = (document.getElementById('bestshot') as HTMLInputElement).checked;
  } catch (error) {
    console.error(error);
  }
}

export function setrenderertype(): void {
  try {
    state.getSelectedPlayer().type = (document.getElementById('renderer_type') as HTMLSelectElement).value;
  } catch (error) {
    console.error(error);
  }
}

/** FR-6.9: the master button-state machine.
 *
 *  Deviation from the original (documented, not reproduced -- see
 *  docs/window-ui/DESIGN.md): the STOPPED branch's #timestamp_date/
 *  #timestamp_time .remove() calls are guarded here for existence first.
 *  The original calls .remove() unconditionally, which throws
 *  (`Cannot read properties of null`) and aborts the rest of the STOPPED
 *  branch -- including every button-state reset after it -- on any stop
 *  that happens before a 'live'-mode timestamp was ever injected (see
 *  playback.ts's ontimestamp). That's a real, high-impact bug (it can
 *  leave Play/Stop/Pause/Resume stuck disabled), not a narrow edge case
 *  like the NVR dateInfo deviation, so it is not reproduced here. */
export function onstatechange(evt: any): void {
  changedebug('onstatechange: ' + fastJsonStringfy(evt.detail));

  switch (evt.detail.readyState) {
    case RTSPOverWebSocketPlayState.PLAYING: {
      (document.getElementById('play_button') as HTMLButtonElement).disabled = true;
      (document.getElementById('stop_button') as HTMLButtonElement).disabled = false;
      (document.getElementById('pause_button') as HTMLButtonElement).disabled = false;
      (document.getElementById('resume_button') as HTMLButtonElement).disabled = true;
      (document.getElementById('capture_button') as HTMLButtonElement).disabled = false;
      (document.getElementById('capture2_button') as HTMLButtonElement).disabled = false;
      (document.getElementById('minimap') as HTMLInputElement).disabled = false;

      try {
        const el = document.getElementById(evt.detail.elementId) as any;
        if (el.playType !== RTSPOverWebSocketPlayType.BACKUP && el.ismute) {
          (document.getElementById('unmute') as HTMLButtonElement).disabled = false;
        }
      } catch (error) {
        console.error(error);
      }

      const playTypePlaying = (document.getElementById(evt.detail.elementId) as any).playType;
      updateStepButtonsEnabled(playTypePlaying);
      if (playTypePlaying === RTSPOverWebSocketPlayType.PLAYBACK) {
        (document.getElementById('speed') as HTMLSelectElement).disabled = false;
      }
      break;
    }
    case RTSPOverWebSocketPlayState.STOPPED: {
      // Read before removing below -- #timestamp_date/#timestamp_time hold
      // the last actually-played position (updateTimestampReadout(),
      // playback.ts), which is what a subsequent plain Play should resume
      // from instead of restarting at the original Selected Time/timeline
      // pick's own start. Requested directly by the user.
      const lastTimestampDate = (document.getElementById('timestamp_date') as HTMLInputElement | null)?.value;
      const lastTimestampTime = (document.getElementById('timestamp_time') as HTMLInputElement | null)?.value;
      document.getElementById('timestamp_date')?.remove();
      document.getElementById('timestamp_time')?.remove();
      // FR-14: ontimestamp() (playback.ts) stops firing once playback
      // isn't PLAYING, so nothing else would ever clear its timeline
      // marker on stop -- without this it stays frozen at the last
      // position shown before the stop.
      state.eventTimeline?.setCustomTime(null);
      // FR-6.9: a stopped player's startTime/endTime are stale once
      // playback has actually ended. `endTime` is always cleared --
      // resuming should play forward from the stop point rather than stay
      // bound to whatever range was originally searched for. `startTime`
      // resumes from the last actually-played position
      // (lastTimestampDate/lastTimestampTime above) when one exists,
      // falling back to `null` (a fresh Play requires a new Selected
      // Time/timeline pick) otherwise -- e.g. stopped before any timestamp
      // event ever arrived. Requested directly by the user.
      //
      // Only meaningful for Playback -- Live never sets these fields in the
      // first place, so there is nothing stale to reset. Guarded (both the
      // playType check and the try/catch) for the same reason this
      // function's own doc comment above already guards the
      // #timestamp_date/#timestamp_time .remove() calls: any throw here
      // would abort every button-state reset below it, same class of bug
      // (found live, real regression -- `player.startTime = null` used to
      // throw unconditionally in `@melchi45/rtsp-over-websocket`, since
      // fixed there to accept `null` like `endTime` already did, but this
      // is cheap, correct insurance against the next one).
      if ((document.getElementById(evt.detail.elementId) as any)?.playType === RTSPOverWebSocketPlayType.PLAYBACK) {
        try {
          // Naive (no trailing 'Z') -- #timestamp_date/#timestamp_time hold
          // local-wall-clock digits (updateTimestampReadout() populates them
          // from the player's GMT-shifted `local` timestamp field, see
          // playback.ts), not UTC. rtsp-over-websocket's setter now
          // GMT-converts a naive string itself (see that repo's MEMORY.md);
          // appending 'Z' here would instead have it wrongly trusted as
          // literal UTC.
          state.getSelectedPlayer().startTime = lastTimestampDate && lastTimestampTime ? `${lastTimestampDate}T${lastTimestampTime}` : null;
          state.getSelectedPlayer().endTime = null;
        } catch (error) {
          console.error('onstatechange STOPPED: resetting startTime/endTime failed:', error);
        }
      }

      (document.getElementById('play_button') as HTMLButtonElement).disabled = false;
      (document.getElementById('stop_button') as HTMLButtonElement).disabled = true;
      (document.getElementById('pause_button') as HTMLButtonElement).disabled = true;
      (document.getElementById('resume_button') as HTMLButtonElement).disabled = true;
      (document.getElementById('capture_button') as HTMLButtonElement).disabled = true;
      (document.getElementById('capture2_button') as HTMLButtonElement).disabled = true;

      (document.getElementById('unmute') as HTMLButtonElement).disabled = true;
      (document.getElementById('mute') as HTMLButtonElement).disabled = true;
      (document.getElementById('volume') as HTMLSelectElement).disabled = true;
      (document.getElementById('getaudiovolume') as HTMLInputElement).disabled = true;
      (document.getElementById('talk') as HTMLInputElement).disabled = true;

      (document.getElementById('minimap') as HTMLInputElement).disabled = true;
      (document.getElementById('unmute') as HTMLButtonElement).disabled = false;

      if ((document.getElementById(evt.detail.elementId) as any).playType === RTSPOverWebSocketPlayType.PLAYBACK) {
        (document.getElementById('forward') as HTMLButtonElement).disabled = false;
        (document.getElementById('backward') as HTMLButtonElement).disabled = false;
        (document.getElementById('speed') as HTMLSelectElement).disabled = true;
      }

      if ((document.getElementById('reconnect') as HTMLInputElement).checked === true) {
        state.getSelectedPlayer().play();
      }
      break;
    }
    case RTSPOverWebSocketPlayState.PAUSED: {
      // FR-14: same reasoning as the STOPPED branch above -- paused also
      // isn't PLAYING, so ontimestamp() has already stopped updating the
      // marker by the time this fires.
      state.eventTimeline?.setCustomTime(null);
      (document.getElementById('play_button') as HTMLButtonElement).disabled = true;
      (document.getElementById('stop_button') as HTMLButtonElement).disabled = false;
      (document.getElementById('pause_button') as HTMLButtonElement).disabled = true;
      (document.getElementById('resume_button') as HTMLButtonElement).disabled = false;
      (document.getElementById('capture_button') as HTMLButtonElement).disabled = false;
      (document.getElementById('capture2_button') as HTMLButtonElement).disabled = false;

      const playTypePaused = (document.getElementById(evt.detail.elementId) as any).playType;
      updateStepButtonsEnabled(playTypePaused);
      if (playTypePaused === RTSPOverWebSocketPlayType.PLAYBACK) {
        (document.getElementById('speed') as HTMLSelectElement).disabled = true;
      }
      break;
    }
    case RTSPOverWebSocketPlayState.STEP: {
      // Temporary diagnostic (2026-09-02): investigating a live report of
      // #forward/#backward staying disabled forever -- if this never logs,
      // the step is getting stuck before ever completing (see
      // MediaRouter.ts's/StepBufferList.ts's matching diagnostics).
      console.log('[videoControl] onstatechange STEP fired');
      (document.getElementById('resume_button') as HTMLButtonElement).disabled = false;
      (document.getElementById('capture_button') as HTMLButtonElement).disabled = false;
      (document.getElementById('capture2_button') as HTMLButtonElement).disabled = false;
      // v2.32: this step actually completed -- re-enable the debounce disable
      // forward()/backward() (above) applied when it was kicked off. v2.33:
      // routed through updateStepButtonsEnabled() like the other cases, so
      // this doesn't override a concurrent playerAvailable === false (a
      // buffer-refill re-seek from an *earlier* step, still in flight).
      updateStepButtonsEnabled((document.getElementById(evt.detail.elementId) as any).playType);
      break;
    }
  }
}

/** FR-6.10. */
export function onError(error: any): void {
  if (state.useDebug) {
    const el = document.getElementById('debug') as HTMLTextAreaElement;
    if (typeof error === 'object') {
      el.value = el.value + 'onerror: ' + fastJsonStringfy(error.detail) + '\r\n';
    } else {
      el.value = el.value + 'onerror: ' + error + '\r\n';
    }
    scrollbottom();
  }

  // Real report from the user: an RTSP 503 (device refuses the connection --
  // e.g. every Overlapped Playback ID slot already in use) used to only ever
  // reach the Debug Information panel, which is collapsed by default and
  // easy to miss -- surfaced now via the same popup() modal every other
  // player-reported error already uses (play()'s AuthError/
  // RTSPOverWebSocketBaseError catch above), with the same markup, so a
  // connection failure is visible even with Debug Information collapsed/off.
  // `@melchi45/rtsp-over-websocket`'s RtspClient.ts reports RTSP 503
  // specifically as errorCode 0x0201 (513 decimal) -- see that repo's
  // RtspClient.ts's `ResponseCode === 503` branch.
  if (typeof error === 'object' && error.detail && error.detail.error === 513) {
    (window as any).popup('<div><h4>Error Code: ' + (window as any).toHex(error.detail.error) + '<br>Error: ' + error.detail.message + '</h4></div>');
  }
}

export function onmeta(evt: any): void {
  if (typeof evt.detail.xml === 'string') {
    const xml = state.onvifBeautify ? beautifyXml(evt.detail.xml) : evt.detail.xml;
    changeonvif('onmeta: ' + xml);
  } else {
    changeonvif('onmeta: ' + fastJsonStringfy(evt.detail.json));
  }
}

export function onClose(message: any): void {
  changedebug('onclose: ' + fastJsonStringfy(message.detail));
}

/** FR-6.11 follow-up: `@melchi45/rtsp-over-websocket`'s MediaRouter can tear
 *  down its internal decoder (close()+null) on RTP packet loss during video
 *  playback (MediaRouter.ts's onWaiting(), gated on supportCovertAndOff) --
 *  independent of this element's own Play/Pause readyState, which is what
 *  onstatechange() below actually reads to enable/disable buttons. Without
 *  this, forward/backward stay clickable during that gap and crash
 *  (`Cannot read properties of null (reading 'forward')` in MediaRouter.ts).
 *  `waiting.detail.playerClosed` (added alongside this fix) flags that gap;
 *  disabling here needs no matching re-enable because the next 'statechange'
 *  PLAYING event (fired once a new frame recreates the decoder) already
 *  re-enables both buttons for PLAYBACK, per onstatechange()'s PLAYING case. */
/** FR-6.10. v2.31 added a `waiting.detail.playerClosed`-gated disable of
 *  `#forward`/`#backward` here; v2.33 removed it again as redundant, not a
 *  revert -- `playerClosed` and `onPlayerStateChange()`'s `'playerstatechange'`
 *  event are now both sourced from the exact same `MediaRouter.player`
 *  setter call (`onWaiting()`'s covert-mode teardown does `this.player =
 *  null`, which fires both), so `onPlayerStateChange()` already covers this
 *  case -- and, unlike this removed special-case, also correctly keeps the
 *  buttons disabled through any later PAUSED/PLAYING/STEP statechange that
 *  arrives before the player actually comes back. See MEMORY.md. */
export function onWaiting(waiting: any): void {
  changedebug('onwaiting: ' + fastJsonStringfy(waiting.detail));
}

export function onstatistics(_statistics: any): void {
  // No-op -- the original's body is fully commented out. See SRS FR-6.10.
}

export function onResize(resize: any): void {
  changedebug('onresize: ' + fastJsonStringfy(resize.detail));
  if (typeof resize.detail !== 'undefined') {
    if (typeof resize.detail.width !== 'undefined' && resize.detail.width !== null &&
        typeof resize.detail.height !== 'undefined' && resize.detail.height !== null) {
      const element = document.getElementById(resize.detail.elementId)!;
      element.setAttribute('width', resize.detail.width);
      element.setAttribute('height', resize.detail.height);
      // FR-2.6 (src/shared-v2/-only, split-layout.css): the element itself
      // no longer stretches to fill #video-panel -- it's sized by
      // `aspect-ratio` instead, so its box matches the real video instead of
      // a generic 16:9 placeholder once the actual resolution is known.
      element.style.aspectRatio = `${resize.detail.width} / ${resize.detail.height}`;
    }
  }
}

export function setupVideoControl(): void {
  // FR-15's original startup block (window.ts ~L380-414) -- initial
  // disabled/checked state before any statechange event has fired.
  (document.getElementById('capture_button') as HTMLButtonElement).disabled = true;
  (document.getElementById('capture2_button') as HTMLButtonElement).disabled = true;
  (document.getElementById('minimap') as HTMLInputElement).disabled = true;
  (document.getElementById('minimap') as HTMLInputElement).checked = false;
  // #bestshotfileter is a known dead control (SRS "Known dead controls")
  // -- stays disabled forever, same as the original.
  (document.getElementById('bestshotfileter') as HTMLSelectElement).disabled = true;
  (document.getElementById('reconnect') as HTMLInputElement).checked = false;
  (document.getElementById('bestshot') as HTMLInputElement).checked = false;

  document.getElementById('play_button')!.addEventListener('click', play);
  document.getElementById('stop_button')!.addEventListener('click', onStopClick);
  document.getElementById('pause_button')!.addEventListener('click', pause);
  document.getElementById('resume_button')!.addEventListener('click', resume);
  document.getElementById('forward')!.addEventListener('click', forward);
  document.getElementById('backward')!.addEventListener('click', backward);
  document.getElementById('capture_button')!.addEventListener('click', capture);
  document.getElementById('capture2_button')!.addEventListener('click', capture2);
  (document.getElementById('play_button') as HTMLButtonElement).disabled = true;
  (document.getElementById('stop_button') as HTMLButtonElement).disabled = true;
  (document.getElementById('pause_button') as HTMLButtonElement).disabled = true;
  (document.getElementById('resume_button') as HTMLButtonElement).disabled = true;
  (document.getElementById('capture_button') as HTMLButtonElement).disabled = true;
  (document.getElementById('capture2_button') as HTMLButtonElement).disabled = true;

  document.querySelectorAll('input[type="radio"][name="play_type"]').forEach((el) => {
    el.addEventListener('change', onchangeplaytype);
  });
  mountSwitch({
    containerId: 'play_type_toggle',
    variant: 'segmented',
    options: [{ value: 'live', label: 'Live' }, { value: 'playback', label: 'Playback' }],
  });

  document.getElementById('minimap')!.addEventListener('change', onchangeminimap);
  document.getElementById('framedrop')!.addEventListener('change', onchangeframedrop);
  document.getElementById('iframe')!.addEventListener('change', onchangeframedrop);
  document.getElementById('bestshot')!.addEventListener('change', onchangebestshot);
  document.getElementById('renderer_type')!.addEventListener('change', setrenderertype);
}
