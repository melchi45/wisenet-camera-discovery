// Screen -- SRS FR-11.

import { state } from './state';

/** FR-11.1: unconditionally flips player .fullscreen -- bound to the
 *  checkbox's own 'click' (not 'change'), and does not read the
 *  checkbox's .checked at all. Also the player's own 'changefullscreen'
 *  event target, so both this direct click and the player's own event
 *  call the identical toggle -- preserved as-is (double-toggle risk
 *  included, see docs/window-ui/SRS.md FR-11.1). */
export function onchangefullscreen(): void {
  try {
    state.getSelectedPlayer().fullscreen = !state.getSelectedPlayer().fullscreen;
  } catch (error) {
    console.error(error);
  }
}

export function setupScreen(): void {
  document.getElementById('fullscreen')!.addEventListener('click', onchangefullscreen);
}
