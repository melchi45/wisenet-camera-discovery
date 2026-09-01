// Control panel > Device -- SRS FR-4, including the full initSunapiManager()
// chain (docs/control-panel-data-binding.md §3 is the full narrative spec;
// this is the direct implementation). Also FR-4.6/4.7/4.9 (timezone, HTTP/
// HTTPS switch, is_android).

import { mountSwitch } from '../../component/switch/switch';
import { NativeSunapiClient } from '../../shared/scripts/nativeSunapiClient';
import { createNativeTransportFactory } from '../../shared/scripts/nativeWebSocketTransport';
import { state } from './state';
import { changedebug, checkUserAccount, applySearchByUTCTimeCapability, fastJsonStringfy } from './helpers';
import { populateChannelSelect, renderVideoProfileInfo, setChannelWidgetMode } from './videoProfile';
import { updatePlaybackSunapiUIVisibility, refreshRuleSelectForChannelChange, resetPlaybackSearchStateForChannelChange } from './playbackCalendar';

declare var IS_EXTENSION: boolean;
declare var SunapiError: any;
declare var RTSPOverWebSocketBaseError: any;
declare var AuthError: any;

export function setdevicetype(): void {
  try {
    state.getSelectedPlayer().device = (document.getElementById('device_type') as HTMLSelectElement).value;
  } catch (error) {
    console.error(error);
  }
}

export function changehostname(this: HTMLInputElement): void {
  try {
    state.getSelectedPlayer().hostname = this.value;
    if ((document.getElementById('use_sunapi_client_checkbox') as HTMLInputElement).checked === true) {
      initSunapiManager();
    }
  } catch (error) {
    console.error(error);
  }
}

export function changeport(this: HTMLInputElement): void {
  try {
    state.getSelectedPlayer().port = this.value;
    if ((document.getElementById('use_sunapi_client_checkbox') as HTMLInputElement).checked === true) {
      initSunapiManager();
    }
  } catch (error) {
    console.error(error);
  }
}

/** FR-4.3: writes player .channel, re-renders the profile panel from
 *  cache immediately, then re-fetches if SUNAPI is on. FR-7.8's own
 *  channel-change handlers (Rule dropdown refresh, and -- while Play Type
 *  is Playback -- resetting/re-fetching every piece of channel-scoped
 *  Playback search state, see resetPlaybackSearchStateForChannelChange()'s
 *  own doc comment) are unconditional here, same as `refreshRuleSelectForChannelChange()`
 *  always was: each callee gates itself on its own precondition (Play
 *  Type, panel visibility) rather than this caller checking first. */
export function changechannel(this: HTMLInputElement): void {
  try {
    state.getSelectedPlayer().channel = this.value;
    renderVideoProfileInfo();
    if ((document.getElementById('use_sunapi_client_checkbox') as HTMLInputElement).checked === true) {
      initSunapiManager();
    }
    refreshRuleSelectForChannelChange();
    resetPlaybackSearchStateForChannelChange();
  } catch (error) {
    console.error(error);
  }
}

/** FR-4.4. */
export function changeprofile(this: HTMLInputElement): void {
  try {
    if (!isNaN(parseInt(this.value, 10))) {
      state.getSelectedPlayer().profile = null;
      state.getSelectedPlayer().profile_number = this.value;
    } else {
      state.getSelectedPlayer().profile_number = null;
      state.getSelectedPlayer().profile = this.value;
    }
  } catch (error) {
    console.error(error);
  }
}

/** FR-4.7: two independent handlers on the same HTTP/HTTPS radios,
 *  preserved as separate functions to match the original exactly. */
function changehttptype(): void {
  try {
    const checkedHttpType = document.querySelector('input[type="radio"][name="http_type"]:checked') as HTMLInputElement | null;
    (document.getElementById('port') as HTMLInputElement).value = checkedHttpType && checkedHttpType.value === 'https' ? '443' : '80';
    state.getSelectedPlayer().port = (document.getElementById('port') as HTMLInputElement).value;
    if ((document.getElementById('use_sunapi_client_checkbox') as HTMLInputElement).checked === true) {
      initSunapiManager();
    }
  } catch (error) {
    console.error(error);
  }
}

function onchangehttptype(): void {
  try {
    const checkedHttpType = document.querySelector('input[type="radio"][name="http_type"]:checked') as HTMLInputElement | null;
    const httptype = checkedHttpType ? checkedHttpType.value : undefined;
    state.getSelectedPlayer().https = httptype === 'https';
  } catch (error) {
    console.error(error);
  }
}

/** Player's own 'changeprotocol' event -- syncs the radio .checked directly,
 *  bypassing changehttptype()/onchangehttptype() (same pattern as
 *  applyDiscoveredDeviceSelection).
 *
 *  Outside the extension, FR-4.10 locks these radios to
 *  `document.location.protocol` -- skipped here too (the primary fix for
 *  the reported "toggle flips on device select" bug is in
 *  playerEvents.ts's onchangeport(), which is what was actually causing
 *  this event to fire with the wrong value in the first place; this is
 *  defense-in-depth for any other path that ends up dispatching
 *  'changeprotocol'). */
export function onchangeprotocol(event: any): void {
  try {
    if (!IS_EXTENSION) {
      return;
    }
    (document.getElementById('https_radio') as HTMLInputElement).checked = !!event.detail.https;
    (document.getElementById('http_radio') as HTMLInputElement).checked = !event.detail.https;
  } catch (error) {
    console.error(error);
  }
}

/** FR-4.6. */
export function changeusegmt(): void {
  try {
    if ((document.getElementById('use_gmt') as HTMLInputElement).checked) {
      (document.getElementById('timezone') as HTMLInputElement).disabled = false;
      state.getSelectedPlayer().GMT = (document.getElementById('timezone') as HTMLInputElement).value;
    } else {
      (document.getElementById('timezone') as HTMLInputElement).disabled = true;
      state.getSelectedPlayer().GMT = null;
    }
  } catch (error) {
    console.error(error);
  }
}

export function changetimezone(): void {
  try {
    state.getSelectedPlayer().GMT = (document.getElementById('timezone') as HTMLInputElement).value;
  } catch (error) {
    console.error(error);
  }
}

export function onchangetimezone(timezone: any): void {
  try {
    (document.getElementById('timezone') as HTMLInputElement).value = timezone.detail.timezone;
    (document.getElementById('timezone') as HTMLInputElement).disabled = false;
    (document.getElementById('use_gmt') as HTMLInputElement).checked = false;
  } catch (error) {
    console.error(error);
  }
}

export function set_use_universal_time(): void {
  try {
    state.getSelectedPlayer().coordinatedUniversalTime = (document.getElementById('universaltime_checkbox') as HTMLInputElement).checked;
  } catch (error) {
    console.error(error);
  }
}

export function onchangeandroid(): void {
  state.getSelectedPlayer().android = (document.getElementById('is_android') as HTMLInputElement).checked;
}

/** FR-4.5: the full SUNAPI bootstrap chain. */
export function initSunapiManager(): void {
  if (state.getSelectedPlayer() === null) {
    return;
  }
  // DEVIATION (see state.ts's own comment on sunapiInitInFlight): skip if
  // a chain is already running instead of starting a redundant, fully
  // concurrent second one -- the original has no such guard.
  if (state.sunapiInitInFlight) {
    return;
  }
  state.sunapiInitInFlight = true;
  try {
    checkUserAccount();
    let videoChannels: any[] = [];

    const player = state.getSelectedPlayer();
    state.device.user = state.device.username = (document.getElementById('username') as HTMLInputElement).value;
    state.device.password = (document.getElementById('password') as HTMLInputElement).value;
    state.device.deviceType = player.device;

    if (state.device.deviceType === 'camera') {
      state.device.cameraIp = player.hostname;
      state.device.hostname = '';
    } else {
      state.device.hostname = player.hostname;
      state.device.cameraIp = '';
    }

    state.device.port = (document.getElementById('port') as HTMLInputElement).value as any;

    const checkedHttpType = document.querySelector('input[type="radio"][name="http_type"]:checked') as HTMLInputElement | null;
    const httptype = checkedHttpType ? checkedHttpType.value : undefined;
    state.device.protocol = httptype === 'https' ? 'https' : 'http';

    if (state.nativeSunapiClient !== null) {
      state.nativeSunapiClient.close();
      state.nativeSunapiClient = null;
    }
    const useNativeTlsProxyEl = document.getElementById('use_native_tls_proxy_checkbox') as HTMLInputElement | null;
    const useNativeTlsProxy = IS_EXTENSION && useNativeTlsProxyEl !== null && useNativeTlsProxyEl.checked;
    let initPromise: Promise<any>;
    if (useNativeTlsProxy) {
      state.nativeSunapiClient = new NativeSunapiClient(state.device as any);
      state.getSunapiManager().attach(state.nativeSunapiClient);
      initPromise = state.nativeSunapiClient.initDevice(state.device as any);
    } else {
      initPromise = state.getSunapiManager().init(state.device);
    }

    player.transportFactory = useNativeTlsProxy ? createNativeTransportFactory() : undefined;

    initPromise
      .then((attributes: any) => {
        const initialized = typeof attributes.Initialized === 'string' ? JSON.parse(attributes.Initialized) : attributes.Initialized;
        if (initialized === false) {
          (window as any).popup('<div><h4>Device is not initialize</h4></div>');
        }

        changedebug('onattributes: ' + fastJsonStringfy(attributes));

        if (attributes) {
          player.sunapiClient = state.getSunapiManager().getSunapiClient();

          state.deviceInformation.attributes = attributes;
          (document.getElementById('is_android') as HTMLInputElement).checked = state.deviceInformation.attributes.IsAndroid;
          player.android = state.deviceInformation.attributes.IsAndroid;
          applySearchByUTCTimeCapability(attributes, changeusegmt);
          return state.getSunapiManager().getVideoSource();
        } else {
          (window as any).popup('<div><h4>Device attributes not ready.</h4></div>');
          throw new Error('Device attributes not ready');
        }
      })
      .then((VideoSource: any) => {
        if (typeof VideoSource !== 'undefined') {
          videoChannels = VideoSource;
          return state.getSunapiManager().getVideoProfilePolicyAll();
        } else {
          (window as any).popup('<div><h4>Video Source is not defined.</h4></div>');
        }
      })
      .then((videoProfilePolicies: any) => {
        if (typeof videoProfilePolicies !== 'undefined') {
          videoProfilePolicies.forEach((policy: any) => {
            videoChannels[policy.Channel].ProfilePolicy = policy;
          });
          return state.getSunapiManager().getVideoProfile();
        } else {
          (window as any).popup('<div><h4>Video Profile policy is not defined.</h4></div>');
        }
      })
      .then((videoProfile: any) => {
        if (typeof videoProfile !== 'undefined') {
          videoProfile.forEach((profile: any) => {
            videoChannels[profile.Channel].Profile = profile;
          });
          state.deviceInformation.channels = videoChannels;
          populateChannelSelect();
        }
        return state.getSunapiManager().getTimezoneInfo();
      })
      .then((timezoneList: any) => {
        if (typeof timezoneList !== 'undefined') {
          state.deviceInformation.timezoneList = timezoneList;
        } else {
          (window as any).popup('<div><h4>timezone list infomation can not get.</h4></div>');
        }
        return state.getSunapiManager().getDateInfo();
      })
      .then((dateInfo: any) => {
        // Deviation from the original (documented, not a bug to
        // reproduce): uses getSelectedPlayer().device here, not the
        // original's stray forEach-loop-scoped `element` variable -- see
        // docs/window-ui/DESIGN.md's "Deviations from legacy behavior".
        if (typeof dateInfo.TimeZoneIndex !== 'undefined' && player.device === 'camera') {
          state.deviceInformation.dateInfo = dateInfo;
          state.deviceInformation.timezone = state.deviceInformation.timezoneList.TimeZones[dateInfo.TimeZoneIndex];
          const dateArray = state.deviceInformation.timezone.TimeZone.match(/\(([A-Za-z\s].*)\)/)[1];
          const tmpTimezone = dateArray.replace('GMT', '');

          if (!(document.getElementById('use_gmt') as HTMLInputElement).checked) {
            (document.getElementById('use_gmt') as HTMLInputElement).checked = true;
            (document.getElementById('timezone') as HTMLInputElement).disabled = false;
          }

          if (tmpTimezone.indexOf(':') !== -1) {
            let timezoneHour: number = parseInt(tmpTimezone.split(':')[0]);
            const timezoneMinute = parseInt(tmpTimezone.split(':')[1]);
            if (timezoneMinute !== 0) {
              timezoneHour += 0.5;
            }
            player.GMT = timezoneHour;
            (document.getElementById('timezone') as HTMLInputElement).value = String(timezoneHour);
          }
        } else if (player.device === 'nvr') {
          state.deviceInformation.dateInfo = dateInfo;
        } else {
          (window as any).popup('<div><h4>dateInfo infomation can not get.</h4></div>');
        }
      })
      .then(() => {
        player.sunapiClient = state.getSunapiManager().getSunapiClient();

        if (player.isplay !== true) {
          (document.getElementById('play_button') as HTMLButtonElement).disabled = false;
          (document.getElementById('stop_button') as HTMLButtonElement).disabled = true;
          (document.getElementById('pause_button') as HTMLButtonElement).disabled = true;
          (document.getElementById('resume_button') as HTMLButtonElement).disabled = true;
        } else {
          (document.getElementById('play_button') as HTMLButtonElement).disabled = true;
          (document.getElementById('stop_button') as HTMLButtonElement).disabled = false;
          (document.getElementById('pause_button') as HTMLButtonElement).disabled = false;
          (document.getElementById('resume_button') as HTMLButtonElement).disabled = false;

          (document.getElementById('getaudiovolume') as HTMLInputElement).value = player.volume;
          (document.getElementById('volume') as HTMLInputElement).value = player.volume;
        }

        (document.getElementById('use_sunapi_client_checkbox') as HTMLInputElement).checked = true;
        state.sunapiInitInFlight = false;
      })
      .catch((error: any) => {
        console.error('error', error);
        if (error instanceof SunapiError) {
          (document.getElementById('use_sunapi_client_checkbox') as HTMLInputElement).checked = false;
          (window as any).popup('<div><h4>Error Code: ' + (window as any).toHex(error.errorCode) + '<br>Error: ' + error.message + '</h4></div>');
        } else if (error instanceof RTSPOverWebSocketBaseError) {
          (window as any).popup('<div><h4>getOverlappedIdList error: ' + error.errorCode + '<br>message: ' + error.message + '</h4></div>');
        } else if (error instanceof DOMException) {
          (document.getElementById('use_sunapi_client_checkbox') as HTMLInputElement).checked = false;
          (window as any).popup('<div><h4>Error Code: ' + (window as any).toHex((error as any).errorCode) + '<br>Error: ' + error.message + '</h4></div>');
        }
        (document.getElementById('use_sunapi_client_checkbox') as HTMLInputElement).checked = false;
        state.sunapiInitInFlight = false;
      });
  } catch (error: any) {
    state.sunapiInitInFlight = false;
    changedebug('initSunapiManager: ' + fastJsonStringfy(error));
    if (error instanceof AuthError) {
      (document.querySelector('input[id="use_sunapi_client_checkbox"]') as HTMLInputElement).checked = false;
      (window as any).popup('<div><h4>Error Code: ' + (window as any).toHex(error.errorCode) + '<br>Error: ' + error.message + '</h4></div>');
    }
  }
}

/** FR-4.5: the switch itself (docs/switch-component/) and its Off/On branch. */
export function on_change_use_sunapi_client(): void {
  const checkbox = document.getElementById('use_sunapi_client_checkbox') as HTMLInputElement;
  if (checkbox.checked === false) {
    state.getSelectedPlayer().sunapiClient = null;
    // No SUNAPI channel list to choose from anymore.
    setChannelWidgetMode(false);
    state.deviceInformation.channels = undefined;
    renderVideoProfileInfo();
  } else {
    state.getSelectedPlayer().sunapiClient = null;
    initSunapiManager();
  }
  // FR-7.8 (src/shared-v2/-only): switches #playback_control /
  // #playback_control_calendar based on this checkbox + Playback mode.
  updatePlaybackSunapiUIVisibility();
}

export function setupDevice(): void {
  // FR-15's original startup block (window.ts ~L380-414) disables this
  // until a SUNAPI session actually supplies a timezone list.
  (document.getElementById('timezone') as HTMLSelectElement).disabled = true;

  document.getElementById('device_type')!.addEventListener('change', setdevicetype);
  document.getElementById('hostname')!.addEventListener('change', changehostname);
  document.getElementById('port')!.addEventListener('change', changeport);
  document.querySelectorAll('input[type="radio"][name="http_type"]').forEach((el) => {
    el.addEventListener('change', changehttptype);
  });
  mountSwitch({
    containerId: 'http_type_toggle',
    variant: 'segmented',
    options: [{ value: 'http', label: 'HTTP' }, { value: 'https', label: 'HTTPS' }],
  });
  document.querySelectorAll('input[type="radio"][name="http_type"]').forEach((el) => {
    el.addEventListener('change', onchangehttptype);
  });
  document.getElementById('channel')!.addEventListener('change', changechannel);
  document.getElementById('profile')!.addEventListener('change', changeprofile);

  document.getElementById('use_gmt')!.addEventListener('change', changeusegmt);
  document.getElementById('timezone')!.addEventListener('change', changetimezone);
  document.getElementById('universaltime_checkbox')!.addEventListener('change', set_use_universal_time);

  document.getElementById('use_sunapi_client_checkbox')!.addEventListener('click', on_change_use_sunapi_client);
  mountSwitch({
    containerId: 'sunapi_toggle',
    variant: 'segmented',
    options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }],
  });

  document.getElementById('is_android')!.addEventListener('change', onchangeandroid);

  if (!IS_EXTENSION) {
    (document.getElementById('native_tls_proxy_field') as HTMLElement).style.display = 'none';

    // Outside the extension, this page is itself served over http:// or
    // https:// (the nodejs example server / any plain web host) -- unlike
    // the extension (a chrome-extension:// page with no scheme of its
    // own), the camera connection's own HTTP/HTTPS choice here isn't
    // actually free: an https:// page can't issue http:// XHR/WebSocket
    // requests at all (mixed-content blocking), and there's no reason to
    // deliberately downgrade an http:// page to https: either. Locking the
    // toggle to match `location.protocol` -- rather than leaving it a free
    // choice that mixed-content blocking would silently break for one of
    // the two options -- was requested directly by the user.
    const isHttpsPage = document.location.protocol === 'https:';
    (document.getElementById('http_radio') as HTMLInputElement).checked = !isHttpsPage;
    (document.getElementById('https_radio') as HTMLInputElement).checked = isHttpsPage;
    (document.getElementById('http_radio') as HTMLInputElement).disabled = true;
    (document.getElementById('https_radio') as HTMLInputElement).disabled = true;
    changehttptype();
    onchangehttptype();
  }
}
