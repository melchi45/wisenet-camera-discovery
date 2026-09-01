// Video Control -- SRS FR-6.

import { mountSwitch } from '../../component/switch/switch';
import { state } from './state';
import { changedebug, fastJsonStringfy, scrollbottom } from './helpers';
import { updatePlaybackSunapiUIVisibility } from './playbackCalendar';

declare var AuthError: any;
declare var RTSPOverWebSocketBaseError: any;
declare var RTSPOverWebSocketPlayState: any;
declare var RTSPOverWebSocketPlayType: any;

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
 *  on the next Stop -> Play. Requested directly by the user. */
export function forward(): void {
  try {
    state.getSelectedPlayer().forward();
  } catch (error) {
    console.error('forward error:', error);
  }
}

/** FR-6.11, see forward() above. */
export function backward(): void {
  try {
    state.getSelectedPlayer().backward();
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

/** FR-7.7.1: previously a "Known dead control" (no listener at all, see
 *  docs/window-ui/SRS.md). Real bug found via a live console.log trace
 *  (`RTSPOverWebSocket.ts`'s `seeking()`): for camera devices, playback seek
 *  only ever writes the actual outgoing `rangeClock` when
 *  `player.useIsoTimeFormat` is truthy -- otherwise that branch is a no-op
 *  and the previous `rangeClock` value (stale, unrelated to the just-
 *  requested seek target) is resent as-is, so every Event Timeline drag-seek
 *  (FR-14, docs/event-timeline-component/SRS.md) silently landed on the same
 *  wrong position regardless of where the marker was dropped. Reported
 *  directly by the user with the exact console trace. `#iso_date_time_checkbox`
 *  stays unchecked by default (matching legacy's own markup -- no `checked`
 *  attribute), so camera playback seek requires checking it manually; see
 *  `docs/window-ui/DESIGN.md`'s "Deviations from legacy behavior" for why
 *  this wasn't instead defaulted on automatically. */
export function onchangeisodatetime(): void {
  try {
    state.getSelectedPlayer().useIsoTimeFormat = (document.getElementById('iso_date_time_checkbox') as HTMLInputElement).checked;
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

      if ((document.getElementById(evt.detail.elementId) as any).playType === RTSPOverWebSocketPlayType.PLAYBACK) {
        (document.getElementById('forward') as HTMLButtonElement).disabled = false;
        (document.getElementById('backward') as HTMLButtonElement).disabled = false;
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
          state.getSelectedPlayer().startTime = lastTimestampDate && lastTimestampTime ? `${lastTimestampDate}T${lastTimestampTime}Z` : null;
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

      if ((document.getElementById(evt.detail.elementId) as any).playType === RTSPOverWebSocketPlayType.PLAYBACK) {
        (document.getElementById('forward') as HTMLButtonElement).disabled = false;
        (document.getElementById('backward') as HTMLButtonElement).disabled = false;
        (document.getElementById('speed') as HTMLSelectElement).disabled = true;
      }
      break;
    }
    case RTSPOverWebSocketPlayState.STEP: {
      (document.getElementById('resume_button') as HTMLButtonElement).disabled = false;
      (document.getElementById('capture_button') as HTMLButtonElement).disabled = false;
      (document.getElementById('capture2_button') as HTMLButtonElement).disabled = false;
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
}

export function onmeta(evt: any): void {
  changedebug('onmeta: ' + fastJsonStringfy(evt.detail.json));
}

export function onClose(message: any): void {
  changedebug('onclose: ' + fastJsonStringfy(message.detail));
}

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
  document.getElementById('iso_date_time_checkbox')!.addEventListener('change', onchangeisodatetime);
  document.getElementById('renderer_type')!.addEventListener('change', setrenderertype);
}
