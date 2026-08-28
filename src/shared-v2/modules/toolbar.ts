// Toolbar -- SRS FR-1.

import { mountSwitch } from '../../component/switch/switch';

declare var socket: any;
declare var IS_EXTENSION: boolean;
declare var chrome: any;

/** FR-1.2: shows/hides Start/Stop per the persisted auto-discovery setting. */
function applyAutoDiscoverySettingUI(enabled: boolean): void {
  (document.getElementById('auto_discovery_toggle') as HTMLInputElement).checked = enabled;
  if (enabled) {
    (document.getElementById('init') as HTMLButtonElement).disabled = true;
    (document.getElementById('disconnect') as HTMLButtonElement).disabled = true;
  }
}

export function setupToolbar(): void {
  // FR-1.1
  document.getElementById('init')!.addEventListener('click', function () {
    socket.start();
    (document.getElementById('init') as HTMLButtonElement).disabled = true;
    document.getElementById('disconnect')!.removeAttribute('disabled');
  });

  // #broadcast has no corresponding element in window.html -- guarded so a
  // missing element is a silent no-op, matching the original's own
  // preserved-from-jQuery behavior (see docs/window-ui SRS "Known dead
  // controls" for the equivalent #usegmttime/#broadcast pattern elsewhere).
  const broadcastEl = document.getElementById('broadcast');
  if (broadcastEl !== null) {
    broadcastEl.addEventListener('click', function () {
      socket.broadcast();
    });
  }

  document.getElementById('disconnect')!.addEventListener('click', function () {
    socket.stop();
    (document.getElementById('disconnect') as HTMLButtonElement).disabled = true;
    const broadcast = document.getElementById('broadcast');
    if (broadcast !== null) {
      (broadcast as HTMLButtonElement).disabled = true;
    }
    document.getElementById('init')!.removeAttribute('disabled');
  });

  // FR-1.2
  if (IS_EXTENSION) {
    chrome.storage.local.get({ autoDiscoveryEnabled: true }, (data: any) => {
      applyAutoDiscoverySettingUI(data.autoDiscoveryEnabled);
    });
  } else {
    fetch('/settings')
      .then((r) => r.json())
      .then((data) => {
        applyAutoDiscoverySettingUI(data.autoDiscoveryEnabled);
      })
      .catch(() => {
        // Server not reachable yet; leave the toggle at its default.
      });
  }

  document.getElementById('auto_discovery_toggle')!.addEventListener('change', function (this: HTMLInputElement) {
    const enabled = this.checked;
    if (IS_EXTENSION) {
      chrome.storage.local.set({ autoDiscoveryEnabled: enabled });
    } else {
      fetch('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoDiscoveryEnabled: enabled }),
      }).catch(() => {});
    }
    if (enabled) {
      (document.getElementById('init') as HTMLButtonElement).disabled = true;
      (document.getElementById('disconnect') as HTMLButtonElement).disabled = true;
    } else {
      document.getElementById('init')!.removeAttribute('disabled');
    }
  });

  // FR-1.3
  document.getElementById('toggle')!.addEventListener('change', changedarkmode);
  mountSwitch({
    containerId: 'theme_switch',
    variant: 'slider',
    options: [{ value: 'light', label: 'Light Mode' }, { value: 'dark', label: 'Dark Mode' }],
  });
}

function changedarkmode(this: HTMLInputElement): void {
  const isDark = this.checked;
  const icon = document.querySelector('.theme-icon img') as HTMLImageElement;
  const label = document.querySelector('.theme-icon em') as HTMLElement;
  if (isDark) {
    document.documentElement.setAttribute('data-theme', 'dark');
    icon.src = 'https://img.icons8.com/emoji/32/000000/crescent-moon-emoji.png';
    label.textContent = 'Dark Mode';
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
    icon.src = 'https://img.icons8.com/offices/32/ffffff/sun.png';
    label.textContent = 'Light Mode';
  }
}
