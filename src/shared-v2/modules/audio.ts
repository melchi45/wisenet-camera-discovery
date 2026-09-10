// Audio -- SRS FR-8.

import { state } from './state';
import { changedebug, fastJsonStringfy } from './helpers';
import { mountSwitch, SwitchController } from '../../component/switch/switch';

// Unmute|Mute button-group switch -- onchangemute() (the player's own
// 'changemute' event handler) syncs this via setValue() so an externally
// (device-)driven mute change is reflected visually too, not just a click
// on either button. Mirrors src/shared/window.ts's equivalent.
let muteSwitch: SwitchController | null = null;

export function unmute(): void {
  try {
    if (state.getSelectedPlayer().ismute === true && state.getSelectedPlayer().isplay) {
      state.getSelectedPlayer().unmute();
    }
  } catch (error) {
    console.error(error);
  }
}

export function mute(): void {
  try {
    if (state.getSelectedPlayer().ismute === false && state.getSelectedPlayer().isplay) {
      state.getSelectedPlayer().mute();
    }
  } catch (error) {
    console.error(error);
  }
}

// #talk was previously unwired -- checking/unchecking it had no effect at
// all. talk(flag) is a real player method (RTSPOverWebSocket.ts), not a
// gettable/settable property like GMT/startTime -- it sends an 'audioOut'
// control command (on/off) and throws (0x1000) if the player isn't
// connected, same as mute()/unmute() above, hence the same isplay guard.
export function changetalk(): void {
  try {
    if (state.getSelectedPlayer().isplay) {
      state.getSelectedPlayer().talk((document.getElementById('talk') as HTMLInputElement).checked);
    }
  } catch (error) {
    console.error(error);
  }
}

export function setvolume(): void {
  try {
    if (state.getSelectedPlayer().ismute === false && state.getSelectedPlayer().isplay) {
      state.getSelectedPlayer().volume = (document.getElementById('volume') as HTMLSelectElement).value;
    }
  } catch (error) {
    console.error(error);
  }
}

export function setaudioshift(): void {
  try {
    state.getSelectedPlayer().audioshift = (document.getElementById('audio_shift') as HTMLInputElement).value;
  } catch (error) {
    console.error(error);
  }
}

export function onchangemute(muteEvt: any): void {
  changedebug('onchangemute: ' + fastJsonStringfy(muteEvt.detail));
  try {
    // #talk's disabled state is NOT touched here -- requested directly by
    // the user: Talk (audioOut) is Live+Playing-only (see videoControl.ts's
    // onstatechange() PLAYING case), unrelated to mute status. Mute/Unmute
    // itself (audioIn) never reconnects RTSP -- only Talk's audioOut path
    // does (RTSPOverWebSocket.ts's open(null, audioOutStatus)) -- so tying
    // Talk's enablement to mute changes was a real mismatch, not just a
    // cosmetic one.
    if (!muteEvt.detail.status) {
      (document.getElementById('unmute') as HTMLButtonElement).disabled = true;
      (document.getElementById('mute') as HTMLButtonElement).disabled = false;
      (document.getElementById('volume') as HTMLSelectElement).disabled = false;
      (document.getElementById('getaudiovolume') as HTMLInputElement).disabled = false;
      if (muteSwitch !== null) {
        muteSwitch.setValue('unmuted');
      }
    } else {
      (document.getElementById('unmute') as HTMLButtonElement).disabled = false;
      (document.getElementById('mute') as HTMLButtonElement).disabled = true;
      (document.getElementById('volume') as HTMLSelectElement).disabled = true;
      (document.getElementById('getaudiovolume') as HTMLInputElement).disabled = true;
      if (muteSwitch !== null) {
        muteSwitch.setValue('muted');
      }
    }

    const player = state.getSelectedPlayer();
    if (typeof player.volume !== 'undefined' || player.volume == null || player.volume === '') {
      (document.getElementById('volume') as HTMLSelectElement).value = player.volume;
      (document.getElementById('getaudiovolume') as HTMLInputElement).value = player.volume;
    }
  } catch (error) {
    console.log(error);
  }
}

export function onchangevolume(volumeEvt: any): void {
  changedebug('onchangevolume: ' + fastJsonStringfy(volumeEvt.detail));
  try {
    (document.getElementById('getaudiovolume') as HTMLInputElement).value = volumeEvt.detail.volume;
    (document.getElementById('volume') as HTMLSelectElement).value = volumeEvt.detail.volume;
  } catch (error) {
    console.error(error);
  }
}

export function setupAudio(): void {
  // FR-15's original startup block (window.ts ~L380-414) disables all
  // audio controls until playback actually starts (onstatechange's
  // PLAYING/STOPPED branches take over from here).
  (document.getElementById('unmute') as HTMLButtonElement).disabled = true;
  (document.getElementById('mute') as HTMLButtonElement).disabled = true;
  (document.getElementById('volume') as HTMLSelectElement).disabled = true;
  (document.getElementById('getaudiovolume') as HTMLInputElement).disabled = true;
  (document.getElementById('talk') as HTMLInputElement).disabled = true;

  document.getElementById('unmute')!.addEventListener('click', unmute);
  document.getElementById('mute')!.addEventListener('click', mute);
  muteSwitch = mountSwitch({
    containerId: 'mute_toggle',
    variant: 'segmented',
    options: [{ value: 'unmuted', label: 'Unmute' }, { value: 'muted', label: 'Mute' }],
  });
  // MediaRouter.ts's `_mute` defaults to `true` -- mountSwitch() itself
  // defaults a button-group's first option ("Unmute") active when neither
  // button starts with an `active` class, which doesn't match that real
  // starting state. Requested directly by the user (page loads muted).
  muteSwitch.setValue('muted');
  document.getElementById('volume')!.addEventListener('change', setvolume);
  document.getElementById('audio_shift')!.addEventListener('change', setaudioshift);

  document.getElementById('talk')!.addEventListener('change', changetalk);
  mountSwitch({
    containerId: 'talk_toggle',
    variant: 'segmented',
    options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }],
  });

  ['unmute', 'mute', 'volume', 'getaudiovolume', 'talk'].forEach((id) => {
    (document.getElementById(id) as HTMLButtonElement | HTMLSelectElement | HTMLInputElement).disabled = true;
  });
}
