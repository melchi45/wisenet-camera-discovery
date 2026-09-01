// Toolbar -- SRS FR-1.

import { mountSwitch } from '../../component/switch/switch';

declare var socket: any;
declare var IS_EXTENSION: boolean;
declare var chrome: any;

/** FR-1.2: shows/hides Start/Stop per the persisted auto-discovery setting.
 *
 *  In the extension, "automatic discovery" is actually driven by
 *  background.ts's service worker, which runs independently of whether
 *  window.html is even open -- this toggle's UI here is purely cosmetic
 *  (Start/Stop disabled because there's nothing for them to do; the
 *  service worker already has a live `chrome.runtime` connection this
 *  page's discovery.ts listens to unconditionally).
 *
 *  Outside the extension there is no such independent process on the
 *  client side -- the nodejs example server's own background UDP loop
 *  (server.ts) keeps running regardless of any open tab, but a given
 *  browser tab only ever sees results while its own `/discover` WebSocket
 *  (`socket.start()`) is open. Disabling Start/Stop without ever calling
 *  `socket.start()` left the toggle's "on" state doing nothing but
 *  blocking the one control that could open that connection -- the
 *  discovery table stayed empty until the toggle was turned off again.
 *  Reported directly by the user (works in the extension, not via the
 *  nodejs server). Fixed by calling `socket.start()`/`socket.stop()` here
 *  too, so this page's own WS connection tracks the setting the same way
 *  the extension's service worker already does. */
function applyAutoDiscoverySettingUI(enabled: boolean): void {
  (document.getElementById('auto_discovery_toggle') as HTMLInputElement).checked = enabled;
  if (enabled) {
    (document.getElementById('init') as HTMLButtonElement).disabled = true;
    (document.getElementById('disconnect') as HTMLButtonElement).disabled = true;
    if (!IS_EXTENSION) {
      socket.start();
    }
  } else {
    (document.getElementById('init') as HTMLButtonElement).removeAttribute('disabled');
    (document.getElementById('disconnect') as HTMLButtonElement).disabled = true;
    if (!IS_EXTENSION) {
      socket.stop();
    }
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
    applyAutoDiscoverySettingUI(enabled);
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
