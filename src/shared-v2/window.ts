// src/shared-v2/window.ts -- entry point. See docs/window-ui/DESIGN.md for
// the module structure. Written fresh from docs/window-ui/SRS.md, not
// copied from src/shared/window.ts -- see docs/window-ui/MRD.md/PRD.md.

import { setupToolbar } from './modules/toolbar';
import { setupPlayerEvents } from './modules/playerEvents';
import { createPlayerListSelect, setupSession } from './modules/session';
import { setupDevice } from './modules/device';
import { setupVideoControl } from './modules/videoControl';
import { setupPlayback } from './modules/playback';
import { setupPlaybackCalendar, updatePlaybackSunapiUIVisibility } from './modules/playbackCalendar';
import { setupAudio } from './modules/audio';
import { setupBackup } from './modules/backup';
import { setupInstantPlayback } from './modules/instantPlayback';
import { setupScreen } from './modules/screen';
import { setupDebugPanels } from './modules/debugPanels';
import { setupDiscovery } from './modules/discovery';
import { setupModals } from './modules/modals';

document.addEventListener('DOMContentLoaded', () => {
  setupToolbar();

  // Must run before setupSession()/setupPlayerEvents(): both assume
  // #player_list already exists as a <select> (FR-3.1).
  createPlayerListSelect();

  // Must run before setupDiscovery(): it populates #player_list's
  // <option>s, and setupDiscovery() ends by calling onPlayerSelect() once
  // unconditionally (SRS FR-15.1 / docs/control-panel-data-binding.md §2,
  // corrected) -- that call needs a real option already selected.
  setupPlayerEvents();

  setupSession();
  setupDevice();
  setupVideoControl();
  setupPlayback();
  setupPlaybackCalendar();
  // Initial state: Live mode, SUNAPI off -- both #playback_control and
  // #playback_control_calendar start hidden (FR-7.8). Live-mode's own
  // default doesn't otherwise call this, so set it explicitly once here.
  updatePlaybackSunapiUIVisibility();
  setupAudio();
  setupBackup();
  setupInstantPlayback();
  setupScreen();
  setupDebugPanels();

  setupDiscovery();
  setupModals();
});
