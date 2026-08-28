// Backup -- SRS FR-9.

import { state } from './state';

declare var RTSPOverWebSocketPlayType: any;

export function onstatechangebackup(): void {
  const elementPlayer = state.getSelectedPlayer();
  const elementBackupFilename = document.getElementById('backup_filename') as HTMLInputElement;
  const elementBackupCheckbox = document.getElementById('backup_checkbox') as HTMLInputElement;
  const elementPlaybackRadio = document.getElementById('playback_radio') as HTMLInputElement;

  // `!== undefined` guards preserved verbatim -- getElementById never
  // returns undefined (only null), so these are always true in practice,
  // same always-true-guard pattern documented elsewhere in this codebase
  // (see docs/control-panel-data-binding.md §2's note on on_player_select()).
  if (
    elementBackupFilename !== undefined &&
    elementPlayer !== undefined &&
    elementBackupCheckbox !== undefined &&
    elementPlaybackRadio !== undefined
  ) {
    const filename = elementBackupFilename.value;

    if ((!filename || /^\s*$/.test(filename)) && elementPlaybackRadio.checked !== true) {
      alert('Backup file name is empty!!!');
      elementBackupCheckbox.checked = false;
      return;
    }

    const value = elementPlaybackRadio.checked;
    if (value) {
      (document.getElementById('speed') as HTMLSelectElement).disabled = false;
      elementPlayer.playType = RTSPOverWebSocketPlayType.BACKUP;
    }

    if (elementBackupCheckbox.checked) {
      elementPlayer.filename = filename;
      elementPlayer.backup(true);
    } else {
      elementPlayer.backup(false);
    }
  }
}

export function setupBackup(): void {
  document.getElementById('backup_checkbox')!.addEventListener('change', onstatechangebackup);
}
