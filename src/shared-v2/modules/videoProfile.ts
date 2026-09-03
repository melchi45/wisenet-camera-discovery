// Video Source / Profile List -- SRS FR-5. See docs/control-panel-data-binding.md
// §4 for the full narrative spec (badge meaning, and the click-vs-change-event
// gap this file used to preserve as-is -- now fixed, see FR-5.3 below) --
// this is the direct implementation.

import { state } from './state';
// Circular with device.ts (device.ts also imports from this module) --
// safe in ESM as long as the binding is only used inside a function body
// (never at module-top-level evaluation time), which is the case here:
// changechannel/changeprofile are only referenced inside function bodies
// below, called well after both modules have finished evaluating.
import { changechannel, changeprofile } from './device';

declare var RTSPOverWebSocketPlayState: any;
declare var RTSPOverWebSocketPlayType: any;

/** FR-5.1: swaps #channel between a plain <input> and a <select> in place,
 *  preserving its current value and re-binding the change listener. */
export function setChannelWidgetMode(useSelect: boolean): HTMLElement {
  try {
    const current = document.getElementById('channel') as HTMLInputElement | HTMLSelectElement;
    const isSelect = current.tagName === 'SELECT';
    if (useSelect === isSelect) {
      return current;
    }

    const currentValue = (current as HTMLInputElement).value;
    let replacement: HTMLInputElement | HTMLSelectElement;
    if (useSelect) {
      replacement = document.createElement('select');
      replacement.id = 'channel';
    } else {
      replacement = document.createElement('input');
      replacement.type = 'text';
      replacement.id = 'channel';
      (replacement as HTMLInputElement).size = 4;
      replacement.value = currentValue || '1';
    }

    current.replaceWith(replacement);
    replacement.addEventListener('change', changechannel as any);
    return replacement;
  } catch (error) {
    console.error(error);
    return document.getElementById('channel')!;
  }
}

/** FR-5.1/FR-4.5: rebuilds #channel's <option>s from deviceInformation.channels. */
export function populateChannelSelect(): void {
  try {
    const channels = state.deviceInformation.channels;
    if (!channels || !channels.length) {
      return;
    }

    const channelSelect = setChannelWidgetMode(true) as HTMLSelectElement;
    const previousValue = channelSelect.value;

    channelSelect.replaceChildren();
    channels.forEach((channelInfo: any) => {
      // SUNAPI's videosource/videoprofile(policy) responses number
      // channels from 0; <rtsp-over-websocket>'s `channel` property
      // rejects anything below 1, matching this app's 1-based convention
      // elsewhere -- +1 here so the dropdown/player deal in the 1-based
      // number; renderVideoProfileInfo() below converts back to 0-based
      // to look the entry up again.
      const option = document.createElement('option');
      option.value = String(channelInfo.Channel + 1);
      option.textContent = 'Channel ' + (channelInfo.Channel + 1);
      channelSelect.append(option);
    });

    if (previousValue !== null && channelSelect.querySelector('option[value="' + previousValue + '"]') !== null) {
      channelSelect.value = previousValue;
    }

    renderVideoProfileInfo();
  } catch (error) {
    console.error(error);
  }
}

/** FR-5.1-style, mirroring setChannelWidgetMode() above: swaps #profile
 *  between a plain <input> (typed profile name/number, the only mode
 *  possible before SUNAPI has supplied a profile list -- or for a channel
 *  with none) and a <select> of that channel's profile Names, preserving
 *  its current value and re-binding the change listener. Requested
 *  directly by the user ("Channel 처럼 ... Profiles의 Name 을 select box
 *  으로 적용"). */
export function setProfileWidgetMode(useSelect: boolean): HTMLElement {
  try {
    const current = document.getElementById('profile') as HTMLInputElement | HTMLSelectElement;
    const isSelect = current.tagName === 'SELECT';
    if (useSelect === isSelect) {
      return current;
    }

    const currentValue = (current as HTMLInputElement).value;
    let replacement: HTMLInputElement | HTMLSelectElement;
    if (useSelect) {
      replacement = document.createElement('select');
      replacement.id = 'profile';
    } else {
      replacement = document.createElement('input');
      replacement.type = 'text';
      replacement.id = 'profile';
      (replacement as HTMLInputElement).size = 10;
      replacement.value = currentValue || '';
    }

    current.replaceWith(replacement);
    replacement.addEventListener('change', useSelect ? (onProfileFieldChange as any) : (changeprofile as any));
    return replacement;
  } catch (error) {
    console.error(error);
    return document.getElementById('profile')!;
  }
}

/** FR-5.3: writes the given #profile element's value onto the selected
 *  player (FR-4.4's changeprofile()) and, if a Live stream is already
 *  playing, restarts it so the newly selected profile actually takes
 *  effect immediately -- reported directly by the user (a profile picked
 *  in Video Source wasn't taking effect on the rtsp-over-websocket
 *  player). The player only reads .profile/.profile_number when
 *  generating the RTSP URL at play() time (see @melchi45/rtsp-over-
 *  websocket's RTSPOverWebSocket.ts) -- it does not hot-switch mid-stream.
 *  Playback is excluded: profile selection doesn't apply to an
 *  already-recorded segment, and #video_source_group is hidden during
 *  Playback already (see docs/window-ui/DESIGN.md's History). stop()
 *  synchronously flips .readyState to STOPPED before returning, so
 *  calling play() right after is safe -- same sequencing the
 *  STOPPED-statechange #reconnect path (FR-6.5, videoControl.ts) already
 *  relies on. Shared by both ways of picking a profile: the #profile
 *  <select> itself (onProfileFieldChange below) and clicking a row in the
 *  profile list. */
function applyProfileSelection(profileEl: HTMLInputElement | HTMLSelectElement): void {
  changeprofile.call(profileEl as any);

  const player = state.getSelectedPlayer();
  if (player.playType === RTSPOverWebSocketPlayType.LIVE && player.readyState === RTSPOverWebSocketPlayState.PLAYING) {
    player.stop();
    player.play();
  }
}

/** #profile's own 'change' listener while it's in <select> mode -- applies
 *  the selection and re-renders the profile list's highlight to match. */
function onProfileFieldChange(this: HTMLSelectElement): void {
  try {
    applyProfileSelection(this);
    renderVideoProfileInfo();
  } catch (error) {
    console.error(error);
  }
}

/** FR-5.2/FR-5.3: pure render from cache, no network call. Badge meaning:
 *  docs/control-panel-data-binding.md §4. */
export function renderVideoProfileInfo(): void {
  try {
    const summaryEl = document.getElementById('video_source_summary')!;
    const listEl = document.getElementById('video_profile_list')!;
    summaryEl.replaceChildren();
    listEl.replaceChildren();

    const channels = state.deviceInformation.channels;
    if (!channels || !channels.length) {
      summaryEl.textContent = 'No video source information yet — check "Use SUNAPI" first.';
      setProfileWidgetMode(false);
      return;
    }

    const selectedChannel = Number((document.getElementById('channel') as HTMLInputElement).value) - 1;
    const channelInfo = channels.filter((c: any) => c.Channel === selectedChannel)[0];
    if (!channelInfo) {
      summaryEl.textContent = 'No video source information for this channel.';
      setProfileWidgetMode(false);
      return;
    }

    summaryEl.textContent =
      'Video Source Token: ' + (channelInfo.VideoSourceToken || '-') +
      '  /  Sensor Capture Frame Rate: ' + (channelInfo.SensorCaptureFrameRate || '-');

    const policy = channelInfo.ProfilePolicy || {};
    const profiles = (channelInfo.Profile && channelInfo.Profile.Profiles) || [];

    // #profile becomes a <select> of this channel's profile Names once any
    // are available, mirroring #channel's own input-vs-select swap
    // (setChannelWidgetMode() above) -- requested directly by the user.
    // Captured before the swap: an input->select swap always starts the
    // new <select> with no options/value, so whatever #profile already
    // held (typed manually, or restored from player.profile/.profile_number
    // by session.ts's on_player_select()) has to be re-applied afterward
    // against the freshly built <option>s, once there's something to match
    // it against.
    const desiredProfileValue = (document.getElementById('profile') as HTMLInputElement | HTMLSelectElement).value;
    const profileField = setProfileWidgetMode(profiles.length > 0);
    if (profileField.tagName === 'SELECT') {
      const profileSelect = profileField as HTMLSelectElement;
      profileSelect.replaceChildren();
      profiles.forEach((profile: any) => {
        const option = document.createElement('option');
        option.value = profile.Name;
        option.textContent = profile.Profile + '. ' + profile.Name;
        profileSelect.append(option);
      });
      if (desiredProfileValue && profileSelect.querySelector('option[value="' + CSS.escape(desiredProfileValue) + '"]') !== null) {
        profileSelect.value = desiredProfileValue;
      }
    }

    const selectedProfileName = (document.getElementById('profile') as HTMLInputElement).value;

    profiles.forEach((profile: any) => {
      const row = document.createElement('div');
      row.className = 'profile-row';
      if (profile.Name === selectedProfileName) {
        row.classList.add('selected');
      }

      const badges = document.createElement('div');
      badges.className = 'profile-badges';
      if (profile.Profile === policy.DefaultProfile) {
        const b = document.createElement('span');
        b.className = 'profile-badge default';
        b.textContent = 'Default';
        badges.append(b);
      }
      if (profile.Profile === policy.EventProfile) {
        const b = document.createElement('span');
        b.className = 'profile-badge event';
        b.textContent = 'Event';
        badges.append(b);
      }
      if (profile.Profile === policy.RecordProfile) {
        const b = document.createElement('span');
        b.className = 'profile-badge record';
        b.textContent = 'Record';
        badges.append(b);
      }

      const nameSpan = document.createElement('span');
      nameSpan.className = 'profile-name';
      nameSpan.textContent = profile.Profile + '. ' + profile.Name;
      row.append(nameSpan);

      const metaSpan = document.createElement('span');
      metaSpan.className = 'profile-meta';
      metaSpan.textContent = [profile.EncodingType, profile.Resolution, profile.FrameRate + 'fps', profile.Bitrate + 'kbps'].join(' · ');
      row.append(metaSpan);

      row.append(badges);

      // FR-5.3 (fixed): setting #profile via direct .value assignment does
      // NOT fire 'change', so applyProfileSelection() would never run as a
      // side effect of this click and the player's own .profile/
      // .profile_number would silently stay on whatever was selected
      // before -- reported directly by the user (profile picked in Video
      // Source not taking effect on the rtsp-over-websocket player). Calls
      // applyProfileSelection() directly instead of relying on a 'change'
      // event that direct .value assignment never dispatches.
      row.addEventListener('click', () => {
        const profileEl = document.getElementById('profile') as HTMLInputElement | HTMLSelectElement;
        profileEl.value = profile.Name;
        applyProfileSelection(profileEl);
        listEl.querySelectorAll('.profile-row').forEach((el) => el.classList.remove('selected'));
        row.classList.add('selected');
      });

      listEl.append(row);
    });
  } catch (error) {
    console.error(error);
  }
}
