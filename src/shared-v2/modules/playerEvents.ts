// Player custom-element event wiring -- SRS FR-14. Registers every event
// listed in FR-14.1 on each <rtsp-over-websocket> element found on the
// page, plus the non-listener per-element defaults (FR-14.2) and the
// #player_list/#port/#framedrop/#iframe seeding that happens in the same
// source region as the original.

import { createEl, changedebug, fastJsonStringfy, changertsp } from './helpers';
import { state } from './state';
import { onError, onmeta, onClose, onResize, onstatechange, oncapture, onstatistics, onWaiting } from './videoControl';
import { ontimestamp } from './playback';
import { onchangemute, onchangevolume } from './audio';
import { onchangefullscreen } from './screen';
import { onchangetimezone, onchangeprotocol } from './device';

declare var IS_EXTENSION: boolean;

/** Log-only stub, shared by changedevicetype/changeprofilenumber/
 *  changeprofile/changechannel/changehostname/changeport/
 *  changebestshotfilter/changebestshot -- kept as one function per event
 *  name (not literally merged) to preserve each one's own log message
 *  text exactly, including onchangedevicetype's own copy-paste artifact
 *  (it logs "onchangeprofilenumber: ..." in the original, not
 *  "onchangedevicetype: ..." -- preserved verbatim, not corrected). */
function onchangedevicetype(event: any): void {
  try {
    changedebug('onchangeprofilenumber: ' + fastJsonStringfy(event.detail));
  } catch (error) {
    console.error(error);
  }
}

function onchangeprofilenumber(event: any): void {
  try {
    changedebug('onchangeprofilenumber: ' + fastJsonStringfy(event.detail));
  } catch (error) {
    console.error(error);
  }
}

function onchangeprofile(event: any): void {
  try {
    changedebug('onchangeprofile: ' + fastJsonStringfy(event.detail));
  } catch (error) {
    console.error(error);
  }
}

function onchangechannel(event: any): void {
  try {
    changedebug('onchangechannel: ' + fastJsonStringfy(event.detail));
  } catch (error) {
    console.error(error);
  }
}

function onchangehostname(event: any): void {
  try {
    changedebug('onchangehostname: ' + fastJsonStringfy(event.detail));
  } catch (error) {
    console.error(error);
  }
}

/** FR-14 table's one non-trivial log-target: also writes .https on
 *  getSelectedPlayer() -- NOT the event's own target element. Preserved
 *  exactly: if multiple players exist and the event fires on a
 *  non-selected one, this still writes to whichever player is currently
 *  selected in the dropdown, matching the original's own behavior.
 *
 *  **`src/shared-v2/`-only deviation**: outside the extension, this write
 *  is skipped -- device.ts's setupDevice() locks the actual connection
 *  scheme (`player.https`) to `document.location.protocol` (FR-4.10), and
 *  this line was the real, deeper cause of that lock silently breaking:
 *  selecting a discovered device sets `player.port` to that device's own
 *  port (`applyDiscoveredDeviceSelection()`, discovery.ts), the player
 *  custom element's own attribute setter for "port" dispatches
 *  'changeport' as a side effect regardless of extension/web, and this
 *  handler then set `.https = (port === 443)` -- which itself triggers the
 *  player's 'changeprotocol' event, flipping the http/https radios back
 *  via onchangeprotocol() below, one level removed from
 *  discovery.ts's own already-`IS_EXTENSION`-guarded radio-sync lines and
 *  invisible to a fix scoped to just that file. Guarding here (rather
 *  than only in onchangeprotocol()) also keeps the *actual* outgoing
 *  connection scheme (`player.https`) consistent with the locked radios,
 *  not just their visual state -- a locked-to-HTTP page should never
 *  attempt an HTTPS connection just because a selected camera happens to
 *  advertise port 443. Reported directly by the user with the exact
 *  repro (`http://localhost:8080`, selecting a discovered
 *  `https://.../index.htm` camera on port 443 flipped the toggle to
 *  HTTPS). */
function onchangeport(event: any): void {
  try {
    changedebug('onchangeport: ' + fastJsonStringfy(event.detail));
    if (IS_EXTENSION) {
      state.getSelectedPlayer().https = event.detail.port == '443';
    }
  } catch (error) {
    console.error(error);
  }
}

function onchangeevent(event: any): void {
  try {
    changedebug('onchangeevent event!!!: ' + fastJsonStringfy(event.detail));
  } catch (error) {
    console.error(error);
  }
}

function onrtsp(rtsp: any): void {
  changertsp('RTSP: ' + rtsp.detail.message);
}

export function setupPlayerEvents(): void {
  document.querySelectorAll('rtsp-over-websocket').forEach((element: any) => {
    element.addEventListener('error', onError);
    element.addEventListener('meta', onmeta);
    element.addEventListener('close', onClose);
    element.addEventListener('resize', onResize);
    element.addEventListener('statechange', onstatechange);
    element.addEventListener('timestamp', ontimestamp);
    element.addEventListener('capture', oncapture);
    element.addEventListener('statistics', onstatistics);
    element.addEventListener('waiting', onWaiting);
    element.addEventListener('rtsp', onrtsp);

    element.addEventListener('changedevicetype', onchangedevicetype);
    element.addEventListener('changeprofilenumber', onchangeprofilenumber);
    element.addEventListener('changeprofile', onchangeprofile);
    element.addEventListener('changechannel', onchangechannel);
    element.addEventListener('changehostname', onchangehostname);
    element.addEventListener('changemute', onchangemute);
    element.addEventListener('changevolume', onchangevolume);
    element.addEventListener('changeport', onchangeport);
    element.addEventListener('changefullscreen', onchangefullscreen);
    element.addEventListener('changebestshotfilter', onchangeevent);
    element.addEventListener('changebestshot', onchangeevent);
    element.addEventListener('changetimezone', onchangetimezone);
    element.addEventListener('changeprotocol', onchangeprotocol);

    // FR-14.2
    element.loading = true;
    element.framedrop = false;
    element.GMT = null;
    // Default Renderer Type to "video tag" -- matches #renderer_type's
    // default-selected <option>; setrenderertype() only runs on that
    // select's own change event, so without this the element's own
    // default would apply until the user touched the dropdown.
    element.type = 'video';

    (document.getElementById('port') as HTMLInputElement).value = element.port;
    (document.getElementById('framedrop') as HTMLInputElement).value = element.framedrop;
    (document.getElementById('iframe') as HTMLInputElement).value = element.iframe;

    document.getElementById('player_list')!.append(
      createEl('option', { value: element.id, text: element.id }),
    );
  });
}
