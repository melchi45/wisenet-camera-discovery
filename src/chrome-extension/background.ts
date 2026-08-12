// Manifest V3 service worker.
//
// Automatic discovery ("autoDiscoveryEnabled" on, the default) now runs
// directly in this service worker — no window at all, so there's nothing
// visible and no taskbar entry. It reuses the exact same
// scripts/socket.js that window.html uses for manual discovery, loaded
// via importScripts() (this is a classic, non-module service worker, so
// that's available). socket.js is guarded to skip every DOM access when
// `document` doesn't exist — see its own top comment — so it's safe to
// run headlessly here.
//
// Why this works despite MV3 tearing down idle service workers: a native
// messaging port (from chrome.runtime.connectNative) counts as active
// work for the service-worker lifecycle, the same way an open
// chrome.runtime.connect() port does. As long as socket.hostPort stays
// connected, Chrome shouldn't apply its normal ~30s idle timeout here.
//
// Earlier approaches that were tried and ruled out for "hidden" discovery:
//  - chrome.offscreen: chrome.runtime.connectNative is not available
//    inside an offscreen document at all (confirmed by testing — it
//    throws "chrome.runtime.connectNative is not a function" there).
//  - A window positioned off-screen or minimized: any real window still
//    gets a taskbar entry (that's an OS-level thing extension APIs can't
//    suppress), and state:'minimized' was unreliable for type:'popup'
//    windows in testing anyway.
//
// window.html is now purely an optional manual UI — opening it (toolbar
// icon, right-click menu, or an external {window:true}/{launch:true}/
// {discovery:true} message) just shows the installer; it has no effect
// on whether this service worker is doing automatic discovery.
importScripts('scripts/socket.js');

const AUTO_DISCOVERY_SETTING_KEY = 'autoDiscoveryEnabled';
const AUTO_DISCOVERY_DEFAULT = true;

function withAutoDiscoverySetting(callback) {
  chrome.storage.local.get({ [AUTO_DISCOVERY_SETTING_KEY]: AUTO_DISCOVERY_DEFAULT }, function (data) {
    callback(data[AUTO_DISCOVERY_SETTING_KEY]);
  });
}

function applyAutoDiscoverySetting(enabled) {
  console.log('[wisenet] applyAutoDiscoverySetting(' + enabled + ')');
  if (enabled) {
    socket.start();
  } else {
    socket.stop();
  }
}

function loadAutoDiscoverySetting() {
  withAutoDiscoverySetting(applyAutoDiscoverySetting);
}

chrome.runtime.onStartup.addListener(loadAutoDiscoverySetting);
chrome.runtime.onInstalled.addListener(loadAutoDiscoverySetting);
loadAutoDiscoverySetting();

chrome.storage.onChanged.addListener(function (changes, areaName) {
  if (areaName === 'local' && AUTO_DISCOVERY_SETTING_KEY in changes) {
    // newValue is undefined when the key is removed rather than set to
    // false — fall back to the code default instead of treating that as
    // "disabled".
    var newValue = changes[AUTO_DISCOVERY_SETTING_KEY].newValue;
    applyAutoDiscoverySetting(newValue === undefined ? AUTO_DISCOVERY_DEFAULT : newValue);
  }
});

// --- window.html: a purely manual/optional UI from here on ---
//
// appWindowId is kept in chrome.storage.session rather than a plain
// module-level variable: MV3 service workers are torn down after a short
// idle period (their top-level state resets each time they wake back up),
// but chrome.storage.session survives that and only clears when the
// browser itself closes. Without this, the service worker "forgets" a
// window it already created after ~30s idle and opens a duplicate one on
// the next click.

function getStoredWindowId(callback) {
  chrome.storage.session.get({ appWindowId: null }, function (data) {
    callback(data.appWindowId);
  });
}

function setStoredWindowId(id) {
  chrome.storage.session.set({ appWindowId: id });
}

function createAppWindow() {
  chrome.windows.create({
    url: chrome.runtime.getURL('window.html'),
    type: 'popup',
    width: 1024,
    height: 768
  }, function (createdWindow) {
    if (createdWindow) {
      setStoredWindowId(createdWindow.id);
    } else if (chrome.runtime.lastError) {
      console.error('[wisenet] Failed to create window:', chrome.runtime.lastError.message);
    }
  });
}

function openAppWindow() {
  getStoredWindowId(function (id) {
    if (id !== null) {
      chrome.windows.update(id, { focused: true, state: 'normal' }, function () {
        if (chrome.runtime.lastError) {
          // Window was closed since we created it.
          setStoredWindowId(null);
          createAppWindow();
        }
      });
      return;
    }
    createAppWindow();
  });
}

chrome.windows.onRemoved.addListener(function (windowId) {
  getStoredWindowId(function (id) {
    if (windowId === id) {
      setStoredWindowId(null);
    }
  });
});

chrome.action.onClicked.addListener(function () {
  openAppWindow();
});

chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.create({
    id: 'open-installer-window',
    title: 'Open Wisenet IP Installer window',
    contexts: ['action']
  });
});

chrome.contextMenus.onClicked.addListener(function (info) {
  if (info.menuItemId === 'open-installer-window') {
    openAppWindow();
  }
});

chrome.runtime.onMessageExternal.addListener(
  function (message, sender, sendResponse) {
    console.log("sender" + JSON.stringify(sender));
    console.log("message" + JSON.stringify(message));
    if (message.discovery) {
      // Discovery already runs continuously in this service worker; just
      // make sure it's going (or re-broadcast if it already is). This
      // does NOT open window.html — that's what "window" is for below,
      // and callers like react-wisenet-player explicitly send
      // {window:false, discovery:true} to ask for exactly that.
      if (socket.hostPort !== null) {
        socket.broadcast();
      } else {
        socket.start();
      }
    }
    if (message.window || message.launch) {
      openAppWindow();
    }
    sendResponse({ success: true });
  }
);

chrome.runtime.onMessage.addListener(
  function (message, sender, sendResponse) {
    // window.js asks for this on load to catch up on devices automatic
    // mode already found before the window existed — see socket.js's
    // knownDevices comment for why a live broadcast alone isn't enough.
    if (message && message.type === 'wisenet-request-known-devices') {
      sendResponse({ devices: Object.values(socket.knownDevices) });
      return;
    }
    console.log("sender" + JSON.stringify(sender));
    console.log("message" + JSON.stringify(message));
  }
);
