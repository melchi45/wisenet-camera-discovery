// Video Source / Profile List -- SRS FR-5. See docs/control-panel-data-binding.md
// §4 for the full narrative spec (badge meaning, the click-vs-change-event
// gap) -- this is the direct implementation, preserving that gap exactly.

import { state } from './state';
// Circular with device.ts (device.ts also imports from this module) --
// safe in ESM as long as the binding is only used inside a function body
// (never at module-top-level evaluation time), which is the case here:
// changechannel is only referenced inside setChannelWidgetMode() below,
// called well after both modules have finished evaluating.
import { changechannel } from './device';

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
      return;
    }

    const selectedChannel = Number((document.getElementById('channel') as HTMLInputElement).value) - 1;
    const channelInfo = channels.filter((c: any) => c.Channel === selectedChannel)[0];
    if (!channelInfo) {
      summaryEl.textContent = 'No video source information for this channel.';
      return;
    }

    summaryEl.textContent =
      'Video Source Token: ' + (channelInfo.VideoSourceToken || '-') +
      '  /  Sensor Capture Frame Rate: ' + (channelInfo.SensorCaptureFrameRate || '-');

    const policy = channelInfo.ProfilePolicy || {};
    const profiles = (channelInfo.Profile && channelInfo.Profile.Profiles) || [];
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

      // FR-5.3: sets #profile via direct .value assignment -- does NOT
      // fire 'change', so changeprofile() does not run as a side effect
      // of this click. Preserved exactly, per docs/control-panel-data-
      // binding.md §4's documented gap.
      row.addEventListener('click', () => {
        (document.getElementById('profile') as HTMLInputElement).value = profile.Name;
        listEl.querySelectorAll('.profile-row').forEach((el) => el.classList.remove('selected'));
        row.classList.add('selected');
      });

      listEl.append(row);
    });
  } catch (error) {
    console.error(error);
  }
}
