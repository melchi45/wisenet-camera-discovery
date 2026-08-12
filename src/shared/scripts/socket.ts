// Wisenet device discovery — shared by the Chrome extension
// (chrome-extension://.../window.html + background.js) and the nodejs
// package's example server (examples/server.ts's static window.html).
//
// Two discovery transports, picked at runtime (IS_EXTENSION below):
//  - Extension: chrome.sockets.udp is a Chrome Apps (platform app) API and
//    is not available to Manifest V3 extensions, so the UDP transport —
//    and the SUNAPI binary reply parsing too, since this extension can't
//    decode it itself either — is delegated to a native messaging host
//    (see native-host/wisenet-udp-host.js), which broadcasts the
//    discovery request to 255.255.255.255:7701 and relays every reply
//    received on port 7711 back to this page as an already-parsed device
//    object (native-host/wisenet-udp-host.js and sunapi/response.ts share
//    the same parser — see that file's `toLegacyDeviceObject()`).
//  - Non-extension (nodejs example server): a WebSocket to that server's
//    own `/discover` endpoint (examples/server.ts), which runs the same
//    SUNAPI wire-format parser server-side (sunapi/response.ts via
//    nodejs/udpDiscovery.ts) and streams back the identical device shape
//    over JSON messages — so onDevice()/displayResult() below need zero
//    changes to handle either transport.
//
// This script also runs in two different DOM contexts on the extension
// side specifically:
//  - window.html (manual mode): a real DOM, results are written to the
//    #result textarea and the 'discover' event is dispatched for window.js.
//  - background.js (automatic mode, via importScripts): the MV3 service
//    worker, which has no `document` at all — logStatus/displayResult/
//    onHostDisconnect's UI updates are guarded and become no-ops there.
// Either way, extension-side results are also forwarded to every ID in
// playerExtensionIds (see onDevice below) — meaningless outside a real
// extension context, so that forwarding is IS_EXTENSION-only.

// chrome.runtime.connectNative is the one extension-only API this file
// actually depends on for its transport choice — a plain nodejs-served
// page has no `chrome` global at all.
var IS_EXTENSION = typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.connectNative;

var socket = {
  // The IDs of the player extensions we forward discovery results to —
  // see scripts/player-extension-ids.json (this array is substituted in
  // at build time from that file, not hand-edited here; see
  // globals.d.ts's own note on __PLAYER_EXTENSION_IDS__).
  playerExtensionIds: __PLAYER_EXTENSION_IDS__,

  // Name registered by native-host/install-host.sh / install-host.ps1
  HOST_NAME: "com.wisenet.ipinstaller",

  SENDPORT: 7701,   // camera send port
  RECEIVEPORT: 7711,   // camera receive port
  BROADCAST_ADDR: "255.255.255.255",

  hostPort: null,

  // Devices found so far this session (keyed by IP address, deduplicated —
  // last reply wins). Automatic mode (background.js) runs its UDP scan
  // once at service-worker startup and pushes each result via a one-shot
  // chrome.runtime.sendMessage broadcast (see displayResult below); if
  // window.html wasn't open yet when a device was found, that broadcast
  // has no receiver and is lost. This cache is what lets window.html catch
  // up on open — see the 'wisenet-request-known-devices' handler in
  // background.js and the request in window.js.
  knownDevices: {} as Record<string, any>,

  isRunning: function() {
    return this.hostPort !== null;
  },

  // Connect to the discovery transport (native host, or a WebSocket to
  // the nodejs example server — see IS_EXTENSION above) and start a round.
  start: function() {
    if (this.hostPort !== null) {
      this.broadcast();
      return;
    }

    if (!IS_EXTENSION) {
      // Same construction the old standalone examples/public/index.html
      // used. The server (examples/server.ts) starts a discovery round on
      // connect and keeps streaming — see onHostMessage's 'done' case and
      // this file's top comment.
      var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      var ws = new WebSocket(proto + '//' + location.host + '/discover');
      this.hostPort = ws;
      ws.onmessage = function (event) {
        socket.onHostMessage(JSON.parse(event.data));
      };
      ws.onerror = function () {
        socket.logStatus("WebSocket error — is the server running?");
      };
      ws.onclose = function () {
        socket.onHostDisconnect();
      };
      return;
    }

    try {
      this.hostPort = chrome.runtime.connectNative(this.HOST_NAME);
    } catch (error) {
      this.logStatus("Failed to connect native host '" + this.HOST_NAME + "': " + error.message);
      this.hostPort = null;
      return;
    }

    this.hostPort.onMessage.addListener(socket.onHostMessage);
    this.hostPort.onDisconnect.addListener(socket.onHostDisconnect);

    this.hostPort.postMessage({
      command: "start",
      receivePort: this.RECEIVEPORT,
      sendPort: this.SENDPORT,
      broadcastAddress: this.BROADCAST_ADDR
    });

    // reference from:
    // https://stackoverflow.com/questions/24198322/how-to-launch-a-chrome-app-from-a-chrome-extension
    try {
      socket.playerExtensionIds.forEach(function (id) {
        chrome.runtime.sendMessage(id, { launch: true });
      });
    } catch (error) {
      // Player extensions are optional; ignore if not installed.
    }
  },

  // Re-send the discovery broadcast on the existing socket.
  broadcast: function() {
    if (this.hostPort === null) {
      return;
    }
    if (!IS_EXTENSION) {
      // The WS server runs one round per connection, not a
      // "re-broadcast on demand" command — reconnecting is the equivalent
      // outcome.
      this.stop();
      this.start();
      return;
    }
    this.hostPort.postMessage({ command: "broadcast" });
  },

  stop: function() {
    if (this.hostPort === null) {
      return;
    }
    try {
      if (IS_EXTENSION) {
        this.hostPort.postMessage({ command: "stop" });
        this.hostPort.disconnect();
      } else {
        this.hostPort.close();
      }
    } catch (error) {
      console.log("stop error: " + error);
    }
    this.hostPort = null;
    this.logStatus("discovery stopped.");
  },

  onHostMessage: function(message) {
    if (typeof message === 'undefined' || message === null) {
      return;
    }

    switch (message.type) {
      case "started":
      case "listening":
        console.log("discovery listening" + (message.receivePort ? " on port " + message.receivePort : "") + ".");
        break;
      case "sent":
        console.log("discovery broadcast sent.");
        break;
      case "device":
        socket.onDevice(message.device);
        break;
      case "error":
      case "parseError":
        console.error("discovery error: " + message.message);
        socket.logStatus("discovery error: " + message.message);
        break;
      case "done":
        // WS transport only — one round finished, but the connection
        // stays open (see examples/server.ts) to keep receiving whatever
        // its background auto-discovery loop finds next; nothing to do
        // here. The native-host transport never sends this message type.
        break;
      default:
        console.log("unknown host message: " + JSON.stringify(message));
        break;
    }
  },

  onHostDisconnect: function() {
    var reason = IS_EXTENSION
      ? (chrome.runtime.lastError ? chrome.runtime.lastError.message : "host closed")
      : "connection closed";
    socket.hostPort = null;
    console.log("discovery transport disconnected: " + reason);
    socket.logStatus(
      IS_EXTENSION
        ? ("Native host disconnected: " + reason + "\r\n" +
           "If the host is not installed, run native-host/install-host.sh (macOS/Linux) " +
           "or native-host/install-host.ps1 (Windows) with this extension's ID.")
        : ("Discovery connection closed: " + reason));

    // socket.js is also loaded (via importScripts) into the service
    // worker for headless discovery, which has no `document` at all.
    if (typeof document === 'undefined') {
      return;
    }
    var initButton = document.getElementById('init');
    var disconnectButton = document.getElementById('disconnect');
    if (initButton !== null) initButton.disabled = false;
    if (disconnectButton !== null) disconnectButton.disabled = true;
  },

  logStatus: function(text) {
    if (typeof document === 'undefined') {
      return;
    }
    var resultTextarea = document.getElementById('result');
    if (resultTextarea !== null) {
      resultTextarea.value += text + "\r\n";
    }
  },

  displayResult: function(data) {
    var deviceName = data.chDeviceName;
    var macAddress = data.chMac;
    var ipAddress = data.chIP;
    var port = (typeof(data.httpType) !== 'undefined') ? ((data.httpType === 0) ? data.nHttpPort : data.nHttpsPort) : data.nPort;
    var url = data.DDNSURL;
    var model = data.modelType;
    var httpType = data.httpType;
    var svnp = data.nDevicePort;

    var result = {
      "DeviceName": deviceName,
      "IPAddress": ipAddress,
      "MACAddress": macAddress,
      "Port": port,
      "URL": url,
      "Model": model,
      "Protocol": (typeof(data.httpType) !== 'undefined') ?
                ((httpType === 0) ? "http" : "https") :
                new URL(data.url).protocol.split(':')[0]
    };

    socket.knownDevices[ipAddress] = result;

    // Broadcast within this extension so window.html can show results
    // even when discovery is actually running in the service worker
    // (automatic mode — see background.js) rather than in window.html
    // itself. Harmless/no-op when nothing is listening (manual mode: the
    // page that called displayResult() doesn't receive its own broadcast
    // back, so there's no duplicate row from this).
    try {
      var sendResult = chrome.runtime.sendMessage({ type: "wisenet-discover-result", detail: result });
      if (sendResult && typeof sendResult.catch === 'function') {
        sendResult.catch(function () {});
      }
    } catch (error) {
      // No listener in this context; ignore.
    }

    if (typeof document === 'undefined') {
      return;
    }
    var resultTextarea = document.getElementById('result');
    if (resultTextarea === null) {
      return;
    }

    var str = resultTextarea.value;
    str += JSON.stringify(result) + "\r\n";
    resultTextarea.value = str;

    const event = new CustomEvent('discover',  {
      detail: {
        data: result
      }
    });
    // Dispatch the event; window.js listens for 'discover' and fills the datatable.
    window.dispatchEvent(event);
  },

  // device is already a fully-parsed object — for the extension,
  // native-host/wisenet-udp-host.js parses the raw 334-byte SUNAPI reply
  // itself (via src/sunapi/response.ts's
  // UdpResponse.parse().toLegacyDeviceObject(), shared with
  // src/nodejs/udpDiscovery.ts); for the nodejs example server, the
  // server does the same parsing itself (see examples/server.ts) — so
  // there's no byte decoding left to do on this side either way.
  onDevice: function(device) {
    try {
      socket.playerExtensionIds.forEach(function (id) {
        chrome.runtime.sendMessage(id, device);
      });
    } catch (error) {
      // Player extensions are optional; ignore if not installed.
    }
    socket.displayResult(device); // no-op when there's no document (background.js)
    console.log("device", device);
  }
};
