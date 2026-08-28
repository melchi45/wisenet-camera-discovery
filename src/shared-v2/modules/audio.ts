// Audio -- SRS FR-8.

import { state } from './state';
import { changedebug, fastJsonStringfy } from './helpers';

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
    if (!muteEvt.detail.status) {
      (document.getElementById('unmute') as HTMLButtonElement).disabled = true;
      (document.getElementById('mute') as HTMLButtonElement).disabled = false;
      (document.getElementById('volume') as HTMLSelectElement).disabled = false;
      (document.getElementById('getaudiovolume') as HTMLInputElement).disabled = false;
      (document.getElementById('talk') as HTMLInputElement).disabled = false;
    } else {
      (document.getElementById('unmute') as HTMLButtonElement).disabled = false;
      (document.getElementById('mute') as HTMLButtonElement).disabled = true;
      (document.getElementById('volume') as HTMLSelectElement).disabled = true;
      (document.getElementById('getaudiovolume') as HTMLInputElement).disabled = true;
      (document.getElementById('talk') as HTMLInputElement).disabled = true;
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
  document.getElementById('volume')!.addEventListener('change', setvolume);
  document.getElementById('audio_shift')!.addEventListener('change', setaudioshift);

  ['unmute', 'mute', 'volume', 'getaudiovolume', 'talk'].forEach((id) => {
    (document.getElementById(id) as HTMLButtonElement | HTMLSelectElement | HTMLInputElement).disabled = true;
  });
}
