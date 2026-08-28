// Instant playback -- SRS FR-10.

import { state } from './state';

declare var RTSPOverWebSocketPlayType: any;

export function onstatechangeinstantplayback(): void {
  const elementPlayer = state.getSelectedPlayer();
  const elementInstantplaybackCheckbox = document.getElementById('instantplayback_checkbox') as HTMLInputElement;

  if (elementPlayer !== undefined && elementInstantplaybackCheckbox !== undefined) {
    if (elementInstantplaybackCheckbox.checked) {
      elementPlayer.playType = RTSPOverWebSocketPlayType.INSTANTPLAYBACK;
    } else {
      elementPlayer.playType = RTSPOverWebSocketPlayType.LIVE;
    }
  }
}

export function setupInstantPlayback(): void {
  document.getElementById('instantplayback_checkbox')!.addEventListener('change', onstatechangeinstantplayback);
}
