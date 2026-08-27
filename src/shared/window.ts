// reference from
// https://busy.org/@anpigon/chrome-app-1
// https://developer.chrome.com/apps/sockets_udp#method-bind
// https://stackoverflow.com/questions/59737903/ionic-4-cordova-plugin-chrome-apps-sockets-udp
// https://github.com/melchi45/chrome-app-udpsocket
// https://stackoverflow.com/questions/33990159/example-explanation-on-chrome-sockets-udp-multicasting
// https://bugs.chromium.org/p/chromium/issues/detail?id=399850
// https://stackoverflow.com/questions/47480990/chrome-sockets-udp-how-to-successfully-broadcast
// https://groups.google.com/a/chromium.org/forum/#!topic/chromium-checkins/IlTiIwXsaGI
// https://stackoverflow.com/questions/47480990/chrome-sockets-udp-how-to-successfully-broadcast

import moment from 'moment';
import 'moment-timezone';
import * as vis from 'vis';
import { NativeSunapiClient } from './scripts/nativeSunapiClient';
import { createNativeTransportFactory } from './scripts/nativeWebSocketTransport';

// Circular-reference-safe JSON.stringify — used throughout this file for
// logging. Defined here directly rather than pulling in a whole vendored
// utility script just for this one function.
// JSON.stringify(error) reliably yields "{}" for real Error/DOMException
// instances — V8 defines .message/.name/.stack (and DOMException's fields
// entirely) as non-enumerable, so fastJsonStringfy() above (plain
// JSON.stringify under the hood) silently drops them. Used where a catch
// block needs to actually show what failed, not just confirm that
// *something* did.
function errorDetails(error: any): string {
  if (error === null || typeof error !== 'object') {
    return String(error);
  }
  try {
    return JSON.stringify(error, Object.getOwnPropertyNames(error));
  } catch (e) {
    return String(error);
  }
}

function fastJsonStringfy(obj: any): string {
  let cache: any[] = [];
  let data = JSON.stringify(obj, function(key, value) {
    if (typeof value === "object" && value !== null) {
      if (cache.indexOf(value) !== -1) {
        // Circular reference found, discard key
        return;
      }
      // Store value in our collection
      cache.push(value);
    }
    return value;
  });
  cache = null as any;
  return data;
}

var selected_player_id = null;

// Returns the currently-selected <rtsp-over-websocket> player element.
// Loosely `any`-typed on purpose (matching this file's existing `any`-typed
// globals, see types/globals.d.ts) — the element's real type is
// rtsp-over-websocket's own custom element class, not declared here, and
// this file reads/writes many of its custom properties (.hostname, .port,
// .play(), .stop(), etc.) that a plain `HTMLElement | null` return type
// would reject. Previously `$("#" + selected_player_id)[0]` (jQuery's `any`
// wrapper unwrapped via `[0]`) — this is the direct vanilla equivalent.
function getSelectedPlayer(): any {
  return document.getElementById(selected_player_id);
}

// Vanilla equivalent of jQuery's `$('<tag/>', {attr: value, ...})` element
// constructor — this file used that form to build a handful of one-off
// elements (label/select/option/input). `text` is special-cased to
// textContent (jQuery does the same); every other key becomes an HTML
// attribute via setAttribute, matching jQuery's default (attr-based)
// behavior for a plain string value.
function createEl(tag: string, attrs: { [key: string]: any }): HTMLElement {
  var el = document.createElement(tag);
  for (var key in attrs) {
    if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
    if (key === 'text') {
      el.textContent = attrs[key];
    } else {
      el.setAttribute(key, attrs[key]);
    }
  }
  return el;
}

var _useDebug = true;
var deviceInformation: any = {};
var device = {
  ClientIPAddress: '127.0.0.1',
  hostname: '',
  cameraIp: '',
  port: 80,
  user: '',
  username: '',
  password: '',
  deviceType: '',
  serverType: 'grunt',
  proxy: false,
  debug: false,
  async: true,
  protocol: 'http'
};
var visTimeline;

// Single shared SunapiManager instance for whichever player is
// selected_player_id at the time — mirrors the old SunapiManagerService
// singleton's behavior (this file only ever drives one player at once).
// Lazily constructed (not `new SunapiManager()` right here) because
// window.js is a classic script that runs immediately as the parser
// reaches it, while legacy-globals-bridge.js (which puts SunapiManager on
// window) is a <script type="module"> — always deferred, so it hasn't run
// yet at this point. getSunapiManager() is safe to call from inside any
// function here (all invoked later, well after the bridge module runs).
var sunapiManager: any = null;
function getSunapiManager() {
  if (sunapiManager === null) {
    sunapiManager = new SunapiManager();
  }
  return sunapiManager;
}

// Backing client for the "Bypass Untrusted Certificate (Native Host)"
// checkbox — see docs/native-https-proxy/DESIGN.md. One instance per
// initSunapiManager() run using the native-proxy path, closed and replaced
// on the next run (mirrors sunapiManager's own "one shared instance for
// whichever player is selected" comment above); null whenever that
// checkbox is unchecked, so the default XHR-based SunapiManager.init()
// path (unaffected by this feature) is used instead.
var nativeSunapiClient: NativeSunapiClient | null = null;

// Implicit globals (bare assignment, no var/let/const) in the original
// window.js — declared here so TypeScript can see them; behavior is
// unchanged (non-strict-mode bare assignment already made these globals).
var resultElement: any;
var element: any;
var index: any;
var item: any;
var pad: any;

var isResizing = false;
// var container = document.getElementById("container"),
//     left = document.getElementById("left_panel"),
//     right = document.getElementById("right_panel"),
//     handle = document.getElementById("drag");

// get locale time zone
var gmtRe = /GMT([\-\+]?\d{4})/;
var tz = gmtRe.exec(String(new Date()))[1];               // +0900


document.addEventListener("DOMContentLoaded", function(){
  console.log('start method');

  // document.getElementById("open_menu").click(e => {
  //   document.getElementById("sidebar").style.width = '250px';;
  //   document.getElementById("main").style.marginLeft = '250px';
  // });

  document.getElementById("init").addEventListener("click", function(){
      resultElement = document.getElementById("result");
      socket.start();
      document.getElementById("init").disabled = "disabled";
      document.getElementById("disconnect").removeAttribute("disabled");
  });

  // #broadcast has no corresponding element in window.html (already true
  // before this file's jQuery removal — `$("#broadcast")` on a missing
  // element is a silent no-op in jQuery, which is why this went unnoticed;
  // the vanilla getElementById()/addEventListener() equivalent throws on
  // null instead, so it's guarded here to preserve that original no-op
  // behavior rather than aborting the rest of this handler).
  if (document.getElementById("broadcast") !== null) {
    document.getElementById("broadcast").addEventListener("click", function(){
        socket.broadcast();
    });
  }

  document.getElementById("disconnect").addEventListener("click", function(){
      socket.stop();
      document.getElementById("disconnect").disabled = "disabled";
      if (document.getElementById("broadcast") !== null) {
        document.getElementById("broadcast").disabled = "disabled";
      }
      document.getElementById("init").removeAttribute("disabled");
  });

  // "autoDiscoveryEnabled": in the extension, background.js runs its own
  // independent discovery session directly in the service worker when
  // this is on (no window involved at all — see background.js); outside
  // the extension (IS_EXTENSION false — see socket.ts), the nodejs
  // example server (examples/server.ts) plays the same role with its own
  // persistent background discovery loop, exposed via GET/POST /settings
  // instead of chrome.storage.local. Either way, this window only
  // reflects/toggles that setting; it does not also start its own local
  // session (that would mean two discovery processes running at once).
  // The manual Start/Stop buttons stay disabled while automatic mode owns
  // discovery, since there'd be nothing for them to usefully do.
  function applyAutoDiscoverySettingUI(enabled: boolean) {
    (document.getElementById("auto_discovery_toggle") as HTMLInputElement).checked = enabled;
    if (enabled) {
      document.getElementById("init").disabled = "disabled";
      document.getElementById("disconnect").disabled = "disabled";
    }
  }

  if (IS_EXTENSION) {
    chrome.storage.local.get({ autoDiscoveryEnabled: true }, function (data) {
      applyAutoDiscoverySettingUI(data.autoDiscoveryEnabled);
    });
  } else {
    fetch('/settings').then(function (r) { return r.json(); }).then(function (data) {
      applyAutoDiscoverySettingUI(data.autoDiscoveryEnabled);
    }).catch(function () {
      // Server not reachable yet; leave the toggle at its default.
    });
  }

  document.getElementById("auto_discovery_toggle").addEventListener("change", function (this: HTMLInputElement) {
    var enabled = this.checked;
    if (IS_EXTENSION) {
      chrome.storage.local.set({ autoDiscoveryEnabled: enabled });
    } else {
      fetch('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoDiscoveryEnabled: enabled })
      }).catch(function () {});
    }
    if (enabled) {
      document.getElementById("init").disabled = "disabled";
      document.getElementById("disconnect").disabled = "disabled";
    } else {
      document.getElementById("init").removeAttribute("disabled");
    }
  });

  // Catch up on devices automatic mode already found before this window
  // existed — see background.js's 'wisenet-request-known-devices' handler
  // and socket.js's knownDevices comment for why a live broadcast alone
  // misses these. Extension-only: outside the extension, the WS transport
  // (socket.ts) already pushes the server's cached known-devices as
  // ordinary 'device' messages right after connect — same
  // onDevice()/addDiscoveredDeviceRow() pipeline, no separate catch-up
  // call needed.
  if (IS_EXTENSION) {
    chrome.runtime.sendMessage({ type: 'wisenet-request-known-devices' }, function (response) {
      if (chrome.runtime.lastError) {
        return; // background.js not reachable yet; nothing to catch up on.
      }
      if (response && Array.isArray(response.devices)) {
        response.devices.forEach(function (device: any) {
          addDiscoveredDeviceRow(device);
        });
      }
    });
  }

  // "Bypass Untrusted Certificate (Native Host)" — extension-only (needs
  // the native messaging host); see docs/native-https-proxy/DESIGN.md and
  // initSunapiManager()'s use of this checkbox further down.
  if (!IS_EXTENSION) {
    document.getElementById("native_tls_proxy_field").style.display = "none";
  }

  var divChannel = document.getElementById("");

  // document.getElementById("channel")
  document.getElementById("player_list_div").append(
    createEl('label', {
      id: 'player_list_label',
      text: 'Plyaer List: ',
      for: 'player_list',
      style: 'margin-right: 5px;'
      //각 태그의 속성값이 들어오는 자리
    })
  );
  var playerListSelect = createEl('select', {
    id: 'player_list',
    text: 'Player List:',
    //각 태그의 속성값이 들어오는 자리
  });
  playerListSelect.addEventListener('change', on_player_select);
  document.getElementById("player_list_div").append(playerListSelect);

  // document.getElementById("channel")
  //       //Create and append select list
  //       var channelLabel = document.createElement("label");
  //       channelLabel.setAttribute("for", "channel_list");
  //       channelLabel.innerText = "Channel List:";
  //       var selectList = document.createElement("select");
  //       selectList.setAttribute("id", "channel_list")
  //       selectList.setAttribute("onchange", "selectedPlayer()")
  //       divChannel.appendChild(channelLabel);
  //       divChannel.appendChild(selectList);

  document.getElementById("backup_checkbox").addEventListener("change", onstatechangebackup);
  document.getElementById("instantplayback_checkbox").addEventListener("change", onstatechangeinstantplayback);

  document.querySelectorAll("rtsp-over-websocket").forEach(function( element: any ) {
    element.addEventListener('error', onError);
    element.addEventListener('meta', onmeta);
    element.addEventListener('close', onClose);
    element.addEventListener('resize', onResize);
    element.addEventListener('statechange', onstatechange);
    element.addEventListener('timestamp', ontimestamp);
    element.addEventListener('capture', oncapture);
    element.addEventListener('statistics', onstatistics);
    // element.addEventListener('backupstatechange', onbackupstate);
    // element.addEventListener('changeplayermode', onchangeplayermode);
    // element.addEventListener('instantplayback', oninstantplayback);
    element.addEventListener('waiting', onWaiting);
    // element.addEventListener('networkstate', onnetworkstate);
    // element.addEventListener('metaImage', onmetamage);
    element.addEventListener('rtsp', onrtsp);

    // // add the onchange method from element property
    element.addEventListener('changedevicetype', onchangedevicetype);
    element.addEventListener('changeprofilenumber', onchangeprofilenumber);
    element.addEventListener('changeprofile', onchangeprofile);
    element.addEventListener('changechannel', onchangechannel);
    element.addEventListener('changehostname', onchangehostname);
    element.addEventListener('changemute', onchangemute);
    element.addEventListener('changevolume', onchangevolume);
    element.addEventListener('changeport', onchangeport);
    element.addEventListener('changefullscreen', onchangefullscreen);
    // element.addEventListener('changesunapiclient', onchangesunapiclient);
    element.addEventListener('changebestshotfilter', onchangeevent);
    element.addEventListener('changebestshot', onchangeevent);
    // element.addEventListener('stream', onstream);
    element.addEventListener('changetimezone', onchangetimezone);
    element.addEventListener('changeprotocol', onchangeprotocol);
    // element.background = "#ff6633";
    element.loading = true;
    element.framedrop = false;
    // element.bestshotfilter = 0;
    // element.bestshotfilter = "Person";
    // element.bestshot = true;
    element.GMT = null;
    // Default Renderer Type to "video tag" — matches #renderer_type's
    // default-selected <option> in window.html; setrenderertype() only
    // runs on that select's change event, so without this the element's
    // own default (whatever element.type otherwise resolves to) would apply
    // instead until the user touched the dropdown themselves.
    element.type = 'video';

    document.getElementById("port").value = element.port;
    document.getElementById("framedrop").value = element.framedrop;
    document.getElementById("iframe").value = element.iframe;

    // if ( element.style.color !== "blue" ) {
    //   element.style.color = "blue";
    // } else {
    //   element.style.color = "";
    // }
    document.getElementById("player_list").append(
      createEl('option', {
        value: element.id,
        text: element.id
      })
    );

    document.getElementById("device_type").addEventListener("change", setdevicetype);

    (document.getElementById("debug") as HTMLTextAreaElement).addEventListener("input", function(this: HTMLTextAreaElement) {
      if (this.value.length > this.maxLength) {
          this.value = this.value.substring(0, this.maxLength);
      }
    });

    let today = new Date();
    let dd = String(today.getDate()).padStart(2, '0');
    let mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
    let yyyy = today.getFullYear();

    document.getElementById("search_timeline").disabled = true;
    document.getElementById("search_three_month_timeline").disabled = true;
    document.getElementById("forward").disabled = true;
    document.getElementById("backward").disabled = true;
    document.getElementById("speed").disabled = true;

    document.getElementById("unmute").disabled = true;
    document.getElementById("mute").disabled = true;
    document.getElementById("volume").disabled = true;
    document.getElementById("getaudiovolume").disabled = true;
    document.getElementById("talk").disabled = true;

    (document.getElementById("start_date") as HTMLInputElement).value = [today.getFullYear(), ('0' + (today.getMonth() + 1)).slice(-2), ('0' + today.getDate()).slice(-2)].join('-');
    document.getElementById("start_date").value = yyyy + '-' + mm + '-' + dd;
    document.getElementById("end_date").value = yyyy + '-' + mm + '-' + dd;
    document.getElementById("seeking_date").value = yyyy + '-' + mm + '-' + dd;

    // document.querySelector('input[id="start_time"]').value = new Date().timeToInput();
    // document.querySelector('input[id="end_time"]').value = new Date().timeToInput();

    document.getElementById("timezone").disabled = true;
    document.getElementById("reconnect").checked = false;
    document.getElementById("bestshot").checked = false;
    document.getElementById("minimap").disabled = true;
    document.getElementById("minimap").checked = false;
    document.getElementById("bestshotfileter").disabled = true;
    document.getElementById("search_aitimeline").disabled = true;

    document.getElementById("capture_button").disabled = true;
    document.getElementById("capture2_button").disabled = true;

    document.getElementById("username").addEventListener("change", changeusername);
    document.getElementById("password").addEventListener("change", changepassword);
    document.getElementById("hostname").addEventListener("change", changehostname);
    document.getElementById("port").addEventListener("change", changeport);
    document.querySelectorAll('input[type="radio"][name="http_type"]').forEach(function (el) {
      el.addEventListener('change', changehttptype);
    });
    document.getElementById("channel").addEventListener("change", changechannel);
    document.getElementById("profile").addEventListener("change", changeprofile);

    document.getElementById("play_button").addEventListener("click", play);
    document.getElementById("stop_button").addEventListener("click", onStopClick);
    document.getElementById("pause_button").addEventListener("click", pause);
    document.getElementById("resume_button").addEventListener("click", resume);
    document.getElementById("capture_button").addEventListener("click", capture);
    document.getElementById("capture2_button").addEventListener("click", capture2);

    document.getElementById("use_gmt").addEventListener("change", changeusegmt);
    document.getElementById("timezone").addEventListener("change", changetimezone);

    document.getElementById("universaltime_checkbox").addEventListener("change", set_use_universal_time);

    document.querySelectorAll('input[type="radio"][name="http_type"]').forEach(function (el) {
      el.addEventListener('change', onchangehttptype);
    });

    document.getElementById("start_apply").addEventListener("click", onchangestarttime);
    document.getElementById("start_date").addEventListener("change", onchangestarttime);
    document.getElementById("start_time").addEventListener("change", onchangestarttime);

    document.getElementById("end_apply").addEventListener("click", onchangeendtime);
    document.getElementById("end_date").addEventListener("change", onchangeendtime);
    document.getElementById("end_time").addEventListener("change", onchangeendtime);

    document.getElementById("search_overlapped_id").addEventListener("click", search_overlapped_id);
    document.getElementById("search_date").addEventListener("click", search_date);
    document.getElementById("search_timeline").addEventListener("click", search_oneday_timeline);

    document.getElementById("speed").addEventListener("change", changespeed);

    document.querySelectorAll('input[type="radio"][name="play_type"]').forEach(function (el) {
      el.addEventListener('change', onchangeplaytype);
    });

    // initialize to true the use sunapi client checkbox
    // document.getElementById("use_sunapi_client_checkbox").checked = true;
    // if use
    document.getElementById("use_sunapi_client_checkbox").addEventListener("click", on_change_use_sunapi_client);

    document.getElementById("minimap").addEventListener("change", onchangeminimap);
    document.getElementById("framedrop").addEventListener("change", onchangeframedrop);
    document.getElementById("iframe").addEventListener("change", onchangeframedrop);
    document.getElementById("bestshot").addEventListener("change", onchangebestshot);

    document.getElementById("statistics").checked = true;
    document.getElementById("statistics").addEventListener("change", onchangestatistics);

    document.getElementById("unmute").addEventListener("click", unmute);
    document.getElementById("mute").addEventListener("click", mute);
    document.getElementById("volume").addEventListener("change", setvolume);

    // click the clear deubug button
    document.getElementById("clear_debug").addEventListener("click", oncleardebug);
    // initialize to true the use debug information checkbox
    document.getElementById("use_debug").checked = true;
    // if use information debug check box was on change.
    document.getElementById("use_debug").addEventListener("change", onchangeusedebug);

    document.getElementById("renderer_type").addEventListener("change", setrenderertype);

    document.getElementById("fullscreen").addEventListener("click", onchangefullscreen);

    document.getElementById("is_android").addEventListener("change", onchangeandroid);

    document.getElementById("toggle").addEventListener("change", changedarkmode);
  });

  // selectChannel();

  // function destory() {
  //   alert('Handler for .unload() called.');
  //   if(sendingSocketId !== null) {
  //     chrome.sockets.udp.close(sendingSocketId, function() {
  //       sendingSocketId = null;
  //     });
  //   }
  //   if(listeningSocketId !== null) {
  //     chrome.sockets.udp.close(listeningSocketId, function() {
  //       listeningSocketId = null;
  //     });;
  //   }

  // }

  // window.addEventListener('beforeunload', function(event) {
  //   alert('Handler for .unload() called.');
  //   if(sendingSocketId !== null) {
  //     chrome.sockets.udp.close(sendingSocketId, function() {
  //       sendingSocketId = null;
  //     });
  //   }
  //   if(listeningSocketId !== null) {
  //     chrome.sockets.udp.close(listeningSocketId, function() {
  //       listeningSocketId = null;
  //     });;
  //   }
  // });
});

var dataSet: string[][] = [
  // [ "XXX-XXXX", "0.0.0.0", "00:00:00:00:00:00", "80" ]
];

// Vanilla replacement for the old DataTables-backed discovery table
// (init options previously here: scrollY '230px'/scrollCollapse — now the
// CSS `.datatable-scroll` sticky-header wrapper in table.css; paging:
// false — this never paginates, so "Showing X to Y of Z" always covers
// the whole filtered set; the default column search box and click-to-sort
// header behavior are reimplemented directly below).
var discoverySortColumn = 0;
var discoverySortAscending = true;
var discoverySearchText = '';

function renderDiscoveryTable() {
  var filtered = dataSet.filter(function (row) {
    if (discoverySearchText === '') return true;
    return row.some(function (cell) {
      return String(cell).toLowerCase().indexOf(discoverySearchText) !== -1;
    });
  });

  var col = discoverySortColumn;
  var dir = discoverySortAscending ? 1 : -1;
  filtered.sort(function (a, b) {
    return String(a[col]).localeCompare(String(b[col]), undefined, { numeric: true }) * dir;
  });

  var tbody = document.querySelector('#datatable tbody');
  tbody.replaceChildren();
  filtered.forEach(function (row, index) {
    var tr = document.createElement('tr');
    tr.className = index % 2 === 1 ? 'odd' : 'even';
    row.forEach(function (cell) {
      var td = document.createElement('td');
      td.textContent = cell;
      tr.append(td);
    });
    tbody.append(tr);
  });

  var infoElement = document.getElementById('datatable_info');
  if (filtered.length === 0) {
    infoElement.textContent = 'Showing 0 to 0 of 0 entries';
  } else {
    infoElement.textContent = 'Showing 1 to ' + filtered.length + ' of ' + filtered.length + ' entries' +
      (filtered.length !== dataSet.length ? ' (filtered from ' + dataSet.length + ' total entries)' : '');
  }
}

// Node-link view of the same dataSet, toggled alongside the table via
// #discovery_view_type. Reuses vis.Network (already bundled for the
// playback Timeline below via `import * as vis from 'vis'` -- vis@4's
// package includes Network alongside Timeline/DataSet in one module, so
// this needs no extra dependency).
var discoveryViewType: string = 'table';
var discoveryTopologyGroupBy: string = 'ip';
var visNetwork: any = null;

// Fixed palette so a given group's hub/leaf colors stay stable across
// re-renders; cycles if there are more than 6 distinct groups. Plain hex
// strings are deliberate here, not objects -- vis.Network's own color
// normalization (confirmed against node_modules/vis/dist/vis.js's
// exports.parseColor(), since this old vis@4.20 build ships no .d.ts to
// just read instead) already expands a hex string into background/border
// plus HSV-lightened/darkened highlight+hover variants automatically, and
// applies the hover variant purely at draw time (Node.getFormattingValues())
// -- no DataSet mutation involved, so hovering can't perturb physics. See
// MEMORY.md's "Discovery result 'Star Topology' view" entry for the two
// earlier, more complicated attempts at this (manual chosen:false + a
// DataSet.update() per hoverNode/blurNode) that this replaced, and why
// they were the actual cause of the graph jumping on hover/click.
var TOPOLOGY_GROUP_COLORS = [
  { hub: '#e05c5c', leaf: '#f0a3a3' },
  { hub: '#4caf50', leaf: '#a3d6a5' },
  { hub: '#e0b400', leaf: '#f0d67a' },
  { hub: '#4a90d9', leaf: '#a3c8ec' },
  { hub: '#9b59b6', leaf: '#cba3d9' },
  { hub: '#e67e22', leaf: '#f0bd8a' },
];

// Shared by the table row click handler and the topology leaf-node click
// handler in renderDiscoveryTopology() — applying the same
// discovered-device fields regardless of which view the user clicked in.
function applyDiscoveredDeviceSelection(row_data: string[]) {
  if(getSelectedPlayer().isplay) {
    getSelectedPlayer().stop();
  }

  if(document.getElementById("use_sunapi_client_checkbox").checked == true) {
    document.getElementById("use_sunapi_client_checkbox").checked = false;
    getSelectedPlayer().sunapiClient = null;
  }
  if(document.getElementById("is_android").checked == true) {
    getSelectedPlayer().android = false;
    document.getElementById("is_android").checked = false;
  }

  console.log( row_data );
  document.getElementById("hostname").value = row_data[1];
  getSelectedPlayer().hostname = row_data[1];
  document.getElementById("port").value = row_data[3];
  getSelectedPlayer().port = row_data[3];

  // row_data[5] is the discovered device's Protocol ("http"/"https" —
  // see socket.ts's displayResult()). Setting .checked directly here
  // (not .click()) deliberately does not fire changehttptype()'s
  // 'change' listener above, so the real discovered port set just
  // above isn't immediately overwritten by that handler's 80/443
  // default. Defaulting "Bypass Untrusted Certificate" on for a
  // discovered HTTPS device: an HTTPS device found via SUNAPI
  // discovery is highly likely to be a self-signed factory cert (see
  // docs/native-https-proxy/PRD.md) — still fully opt-out via the
  // checkbox itself, and has no effect outside the extension target
  // (IS_EXTENSION-gated visibility, see initSunapiManager()).
  var isHttps = row_data[5] === 'https';
  document.getElementById("https_radio").checked = isHttps;
  document.getElementById("http_radio").checked = !isHttps;
  document.getElementById("use_native_tls_proxy_checkbox").checked = isHttps;

  document.getElementById("webviewer").src = row_data[4];
  document.getElementById("web").disabled = false;
}

// dataSet column each #discovery_topology_group_by option groups on -- see
// docs/architecture.md's "Discovery result views" section for the full
// per-type key-extraction/hub-label rule table.
var TOPOLOGY_GROUP_COLUMN: { [key: string]: number } = {
  ip: 1, name: 0, mac: 2, port: 3, protocol: 5
};

function getTopologyGroupKey(row: string[], groupBy: string): string {
  var column = TOPOLOGY_GROUP_COLUMN.hasOwnProperty(groupBy) ? TOPOLOGY_GROUP_COLUMN[groupBy] : 1;
  var value = String(row[column]);
  if (groupBy === 'ip') {
    var ipParts = value.split('.');
    return ipParts.length >= 3 ? ipParts.slice(0, 3).join('.') : value;
  }
  if (groupBy === 'mac') {
    var macParts = value.split(':');
    return macParts.length >= 3 ? macParts.slice(0, 3).join(':') : value;
  }
  if (groupBy === 'name') {
    var dashIndex = value.indexOf('-');
    return dashIndex > 0 ? value.substring(0, dashIndex) : value;
  }
  return value; // port / protocol: exact value, no truncation
}

function getTopologyHubLabel(key: string, groupBy: string): string {
  if (groupBy === 'ip') return key + '.0/24';
  if (groupBy === 'mac') return key + ' (OUI)';
  if (groupBy === 'port') return 'Port ' + key;
  return key; // name / protocol
}

function renderDiscoveryTopology() {
  var container = document.getElementById('datatable_topology');
  if (container === null) return;

  // Grouping is a client-side derivation of the flat discovery list --
  // SUNAPI discovery replies carry no real parent/child device
  // relationship (see docs/architecture.md), so there's nothing more
  // meaningful to group by than whichever column
  // #discovery_topology_group_by picks. Hub nodes are deliberately not
  // linked to each other for the same reason (see the comment on
  // #datatable_topology in window.html).
  //
  // Search reuses the exact same per-row predicate renderDiscoveryTable()
  // uses (any cell contains discoverySearchText) -- see MEMORY.md's
  // "Discovery result 'Star Topology' view" entry for why that alone
  // makes multi-group prefix matches (e.g. "192." spanning several /24
  // hubs, or "P" spanning "PNM"/"PNO"/"PND") work without a second,
  // per-groupBy-type matching rule.
  var groupIndex: { [key: string]: number } = {};
  var groupCount = 0;
  var nodes: any[] = [];
  var edges: any[] = [];

  dataSet.forEach(function (row) {
    if (discoverySearchText !== '' && !row.some(function (cell) {
      return String(cell).toLowerCase().indexOf(discoverySearchText) !== -1;
    })) {
      return;
    }

    var name = row[0], ip = row[1];
    var groupKey = getTopologyGroupKey(row, discoveryTopologyGroupBy);

    if (!(groupKey in groupIndex)) {
      groupIndex[groupKey] = groupCount++;
      var hubColors = TOPOLOGY_GROUP_COLORS[groupIndex[groupKey] % TOPOLOGY_GROUP_COLORS.length];
      nodes.push({
        id: 'hub:' + groupKey,
        label: getTopologyHubLabel(groupKey, discoveryTopologyGroupBy),
        shape: 'dot',
        size: 16,
        color: hubColors.hub,
        font: { color: '#ffffff' }
      });
    }

    var colors = TOPOLOGY_GROUP_COLORS[groupIndex[groupKey] % TOPOLOGY_GROUP_COLORS.length];
    nodes.push({
      id: ip,
      label: name || ip,
      title: ip,
      shape: 'dot',
      size: 10,
      color: colors.leaf,
      font: { color: '#ffffff' }
    });
    edges.push({ from: 'hub:' + groupKey, to: ip, color: { color: '#888888' } });
  });

  var data = { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) };
  var options = {
    // stabilization.fit: false -- vis's own default (true) re-fits/zooms
    // the view itself as soon as physics finishes stabilizing, racing our
    // own fit() call below (registered on the same 'stabilizationIterationsDone'
    // event, so ours always wins/is the only one that runs).
    physics: { barnesHut: { springLength: 90 }, stabilization: { iterations: 150, fit: false } },
    interaction: { hover: true }
  };

  // Destroy and fully reconstruct the Network on every render, rather than
  // reusing the existing instance via setOptions()+setData() -- reusing it
  // was the actual cause of every interaction (hover, click, drag) going
  // wrong specifically *after* a search/group-by re-render, not just one
  // of them: something about repeated setData() calls on the same instance
  // left stale internal state (mouse/canvas coordinate handling, physics,
  // or both -- this old vis@4.20 build's lack of a changelog or .d.ts made
  // it impractical to pin down further without a real browser). destroy()
  // tears down its canvas/DOM/event bindings cleanly, so every render
  // starts from the exact same known-good state the very first render
  // does. See MEMORY.md's "Discovery result 'Star Topology' view" entry
  // for the three narrower attempts this replaced.
  if (visNetwork !== null) {
    visNetwork.destroy();
    visNetwork = null;
  }

  visNetwork = new vis.Network(container, data, options);
  visNetwork.on('click', function (params: any) {
    // params.nodes (hit-testing done once, at mousedown/mouseup time) is
    // not enough on its own -- a click landing while the layout is still
    // mid-stabilization can resolve against nodes that haven't settled
    // into their final positions yet. getNodeAt() re-queries against
    // wherever nodes *actually* are right now, at click time, so this
    // only ever acts when a node is truly under the pointer -- doesn't
    // touch dragging/panning at all, only gates whether a click selects a
    // device.
    if (params.nodes.length === 0) return;
    var nodeId = visNetwork.getNodeAt(params.pointer.DOM);
    if (nodeId === undefined || nodeId === null) return;
    nodeId = String(nodeId);
    if (nodeId.indexOf('hub:') === 0) return; // hubs are a derived grouping, not a selectable device
    var row = dataSet.find(function (r) { return r[1] === nodeId; });
    if (row) applyDiscoveredDeviceSelection(row);
  });
  // Fit-and-freeze together, both gated on physics having actually
  // finished moving nodes to their final resting positions -- fit()
  // used to run synchronously right after setData(), which could land
  // *before* an async stabilization pass had finished: the camera would
  // lock onto the graph's bounds while nodes were still physically
  // drifting into place underneath it. Tying both to this event means the
  // camera only ever settles once the layout has too. This fires again on
  // every fresh render since it's a brand-new Network instance each time.
  visNetwork.on('stabilizationIterationsDone', function () {
    visNetwork.stopSimulation();
    visNetwork.setOptions({ physics: { enabled: false } });
    visNetwork.fit({ animation: { duration: 300, easingFunction: 'easeInOutQuad' } });
  });
}

function setDiscoveryViewType(viewType: string) {
  discoveryViewType = viewType;
  var tableScroll = document.querySelector('.datatable-scroll') as HTMLElement;
  var topologyContainer = document.getElementById('datatable_topology');
  var infoElement = document.getElementById('datatable_info');
  var groupByWrap = document.getElementById('discovery_topology_group_by_wrap');
  if (viewType === 'topology') {
    tableScroll.style.display = 'none';
    infoElement.style.display = 'none';
    topologyContainer.style.display = 'block';
    groupByWrap.style.display = '';
    renderDiscoveryTopology();
  } else {
    tableScroll.style.display = '';
    infoElement.style.display = '';
    topologyContainer.style.display = 'none';
    groupByWrap.style.display = 'none';
  }
}

function updateDiscoverySortIndicator() {
  document.querySelectorAll('#datatable thead th').forEach(function (th) {
    th.classList.remove('sort-asc', 'sort-desc');
  });
  var activeHeader = document.querySelector('#datatable thead th[data-column="' + discoverySortColumn + '"]');
  if (activeHeader !== null) {
    activeHeader.classList.add(discoverySortAscending ? 'sort-asc' : 'sort-desc');
  }
}

document.addEventListener("DOMContentLoaded", function() {
  console.log('document.ready');

  document.querySelectorAll('#datatable thead th').forEach(function (th) {
    th.addEventListener('click', function () {
      var column = Number((th as HTMLElement).dataset.column);
      if (discoverySortColumn === column) {
        discoverySortAscending = !discoverySortAscending;
      } else {
        discoverySortColumn = column;
        discoverySortAscending = true;
      }
      updateDiscoverySortIndicator();
      renderDiscoveryTable();
    });
  });
  updateDiscoverySortIndicator();
  renderDiscoveryTable();

  document.getElementById('datatable_search').addEventListener('input', function (this: HTMLInputElement) {
    discoverySearchText = this.value.trim().toLowerCase();
    renderDiscoveryTable();
    if (discoveryViewType === 'topology') renderDiscoveryTopology();
  });

  document.getElementById('discovery_view_type').addEventListener('change', function (this: HTMLSelectElement) {
    setDiscoveryViewType(this.value);
  });

  document.getElementById('discovery_topology_group_by').addEventListener('change', function (this: HTMLSelectElement) {
    discoveryTopologyGroupBy = this.value;
    renderDiscoveryTopology();
  });

  document.getElementById("drag").addEventListener('mousedown', function(event) {
    isResizing = true;
  });

  document.getElementById("web").addEventListener('click', function(event) {
    if ( document.getElementById("webdiv").style.display == 'none' || document.getElementById("webdiv").style.visibility == "hidden"){
        document.getElementById("webdiv").style.display = 'block';
    } else {
        document.getElementById("webdiv").style.display = 'none';
    }
  });

  document.addEventListener("mouseover", function(e) {
    // we don't want to do anything if we aren't resizing.
    console.log("isResizing:" + isResizing);
    if (!isResizing) {
      return;
    }

    console.log("container offset left:" + document.getElementById("container").getBoundingClientRect().left);

    var offsetRight = document.getElementById("container").clientWidth - (e.clientX - document.getElementById("container").getBoundingClientRect().left);

    console.log("offset:" + offsetRight);

    document.getElementById("left_panel").style.right = offsetRight + "px";
    document.getElementById("right_panel").style.width = offsetRight + "px";
  //   left.style.right = ;
  //   right.style.width = offsetRight + "px";
  });

  document.addEventListener("mouseup", function(e) {
    // stop resizing
    isResizing = false;
  });

  document.querySelector('#datatable tbody').addEventListener('click', function (event) {
    var tr = (event.target as HTMLElement).closest('tr');
    if (tr === null) return;

    if ( tr.classList.contains('selected') ) {
      tr.classList.remove('selected');
      document.getElementById("web").disabled = true;
    } else {
      document.querySelectorAll('#datatable tbody tr.selected').forEach(function (selectedRow) {
        selectedRow.classList.remove('selected');
      });
      tr.classList.add('selected');

      var cells = tr.querySelectorAll('td');
      var row_data = [cells[0].textContent, cells[1].textContent, cells[2].textContent, cells[3].textContent, cells[4].textContent, cells[5].textContent];
      applyDiscoveredDeviceSelection(row_data);
    }
  } );

  on_player_select();

  initModal();
} );

function popupWindow(url, title, w, h) {
  var left = (screen.width / 2) - (w / 2);
  var top = (screen.height / 2) - (h / 2);
  var win = window.open(url, title, 'toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=' + w + ', height=' + h + ', top=' + top + ', left=' + left);
  win.focus();
}

function addDiscoveredDeviceRow(data) {
  var pk = data.IPAddress;

  // item be added when data is empty or ip address do not searching on address column
  var exists = dataSet.some(function (row) { return row[1] === pk; });
  if (!exists) {
    dataSet.push([data.DeviceName, data.IPAddress, data.MACAddress, data.Port, data.URL, data.Protocol]);
    renderDiscoveryTable();
    if (discoveryViewType === 'topology') renderDiscoveryTopology();
  }
}

var messageHandler = function(event) {
  try {
    if(event.type === 'discover' && event.detail !== null) {
      addDiscoveredDeviceRow(event.detail.data);
    }
  } catch(error) {
    console.log("Error on postMessage back to APP" + error);
  }
};

window.addEventListener('discover', messageHandler, false);

// Results forwarded by scripts/socket.js's displayResult() from another
// context of this same extension — used when discovery is actually
// running in the service worker (automatic mode, see background.js)
// rather than in this window. Extension-only (there's no chrome.runtime
// outside the extension — see IS_EXTENSION in socket.ts): the WS
// transport's single open connection already delivers everything the
// nodejs example server finds, live, via the 'discover' event listener
// above — no second channel needed there.
if (IS_EXTENSION) {
  chrome.runtime.onMessage.addListener(function (message) {
    if (message && message.type === 'wisenet-discover-result' && message.detail) {
      addDiscoveredDeviceRow(message.detail);
    }
  });
}

var changeusername = function () {
  try {
    if (getSelectedPlayer() !== null) {
      getSelectedPlayer().username = this.value;
      if(document.getElementById("use_sunapi_client_checkbox").checked == true) {
        initSunapiManager();
      }
    }
  } catch (error) {
    console.error(error);
  }
}

var changepassword = function () {
  try {
    if (getSelectedPlayer() !== null) {
      getSelectedPlayer().password = this.value;
      // elementPlayer.password = document.getElementById('password').value;
      if(document.getElementById("use_sunapi_client_checkbox").checked == true) {
        initSunapiManager();
      }
    }
  } catch (error) {
    console.error(error);
  }
}

var onchangehostname = function (event) {
  try {
    changedebug("onchangehostname: " + fastJsonStringfy(event.detail));
  } catch (error) {
    console.error(error);
  }
}

var changehostname = function () {
  try {
    getSelectedPlayer().hostname = document.getElementById("hostname").value;

    if(document.getElementById("use_sunapi_client_checkbox").checked == true) {
      initSunapiManager();
    }
  } catch (error) {
    console.error(error);
  }
}

var onchangeport = function (event) {
  try {
    changedebug("onchangeport: " + fastJsonStringfy(event.detail));

    if(event.detail.port == '443') {
      getSelectedPlayer().https = true;
    } else {
      getSelectedPlayer().https = false;
    }
  } catch (error) {
    console.error(error);
  }
}

var onchangeprotocol = function (event) {
  try {
    changedebug("onchangeprotocol: " + fastJsonStringfy(event.detail));

    if(event.detail.https) {
      document.getElementById("https_radio").checked = true;
      // document.getElementById("https_radio").attr('checked');
      // document.getElementById("https_radio").checked = true;
      // document.getElementById("https_radio").attr('checked');
      // document.getElementById("http_radio").removeAttribute('checked');
    } else {
      // document.getElementById("http_radio").checked = 'checked';
      document.getElementById("http_radio").checked = true;
      // document.getElementById("http_radio").attr('checked');
      // document.getElementById("https_radio").removeAttribute('checked');
    }
  } catch (error) {
    console.error(error);
  }
}

var onchangeevent = function (event) {
  try {
    changedebug("onchangeevent event!!!: "+ fastJsonStringfy(event.detail));
  } catch (error) {
    console.error(error);
  }
  // switch(Object.keys(event.type)) {
  //   case 'bestshot':
  //   break;
  //   case 'bestshotfilter':bestshotfilter
  //   break;
  // }
}

var changeport = function () {
  try {
    getSelectedPlayer().port = document.getElementById("port").value;

    if(document.getElementById("use_sunapi_client_checkbox").checked == true) {
      initSunapiManager();
    }
  } catch (error) {
    console.error(error);
  }
}

// http_radio/https_radio's change handler — defaults the Port field to
// the protocol's standard port (80/443) whenever the user manually
// switches protocol. Only wired to the radios' own 'change' event, not
// invoked when this codebase sets .checked programmatically (row
// selection below, onchangeprotocol()) — those already set the device's
// actual discovered/reported port, which is more accurate than this
// generic default and shouldn't be clobbered by it.
var changehttptype = function () {
  try {
    var checkedHttpType = document.querySelector('input[type="radio"][name="http_type"]:checked') as HTMLInputElement | null;
    document.getElementById("port").value = (checkedHttpType && checkedHttpType.value === 'https') ? '443' : '80';
    getSelectedPlayer().port = document.getElementById("port").value;

    if(document.getElementById("use_sunapi_client_checkbox").checked == true) {
      initSunapiManager();
    }
  } catch (error) {
    console.error(error);
  }
}

var onchangechannel = function (event) {
  try {
    changedebug("onchangechannel: " + fastJsonStringfy(event.detail));
  } catch (error) {
    console.error(error);
  }
}

var changechannel = function() {
  try {
    getSelectedPlayer().channel = document.getElementById("channel").value;

    // Re-render immediately from whatever's already cached in
    // deviceInformation.channels (populated by initSunapiManager()'s
    // getVideoSource/getVideoProfilePolicyAll/getVideoProfile chain) so the
    // video source/profile panel updates without waiting on a network
    // round trip; initSunapiManager() below (if SUNAPI is in use) re-fetches
    // and calls this again once fresh data is back.
    renderVideoProfileInfo();

    if(document.getElementById("use_sunapi_client_checkbox").checked == true) {
      initSunapiManager();
    }
  } catch (error) {
    console.error(error);
  }
}

// Populates #channel's <option>s from deviceInformation.channels (each
// entry's `Channel` field, as returned by SUNAPI's videosource endpoint —
// see initSunapiManager()) and re-renders the video source/profile panel
// for whichever channel ends up selected. Called once deviceInformation.
// channels is fully assembled; safe to call again on repeat SUNAPI inits.
//
// #channel swaps between a plain <input> (default — free-text channel
// number, no SUNAPI channel list to choose from) and a <select> (once
// SUNAPI's videosource list is available) via setChannelWidgetMode()
// below, replacing the element outright so every existing `document.getElementById("channel")`
// call site elsewhere in this file (changechannel's own binding included)
// keeps working unchanged — only one element ever has id="channel" at a
// time.
var setChannelWidgetMode = function (useSelect) {
  try {
    var current = document.getElementById("channel") as HTMLInputElement | HTMLSelectElement;
    var isSelect = current.tagName === 'SELECT';
    if (useSelect === isSelect) {
      return current;
    }

    var currentValue = (current as HTMLInputElement).value;
    var replacement: HTMLInputElement | HTMLSelectElement;
    if (useSelect) {
      replacement = document.createElement('select');
      replacement.id = 'channel';
    } else {
      replacement = document.createElement('input');
      replacement.type = 'text';
      replacement.id = 'channel';
      (replacement as HTMLInputElement).size = 4;
      replacement.value = currentValue || '1';
    }

    current.replaceWith(replacement);
    replacement.addEventListener('change', changechannel);
    return replacement;
  } catch (error) {
    console.error(error);
    return document.getElementById("channel");
  }
};

var populateChannelSelect = function () {
  try {
    var channels = deviceInformation.channels;
    if (!channels || !channels.length) {
      return;
    }

    var channelSelect = setChannelWidgetMode(true) as HTMLSelectElement;
    var previousValue = channelSelect.value;

    channelSelect.replaceChildren();
    channels.forEach(function (channelInfo) {
      // SUNAPI's videosource/videoprofile(policy) responses number channels
      // from 0, but <rtsp-over-websocket>'s `channel` property setter
      // rejects anything below 1 ("invalid channel number... at least over
      // 1") — matching this app's own 1-based convention elsewhere (the
      // #channel field's original default was "1"). +1 here so the
      // dropdown/player always deal in the 1-based number; only the
      // SUNAPI-facing lookup in renderVideoProfileInfo() below converts
      // back to the device's own 0-based Channel to find this entry again.
      var option = document.createElement('option');
      option.value = String(channelInfo.Channel + 1);
      option.textContent = 'Channel ' + (channelInfo.Channel + 1);
      channelSelect.append(option);
    });

    if (previousValue !== null && channelSelect.querySelector('option[value="' + previousValue + '"]') !== null) {
      channelSelect.value = previousValue;
    }

    renderVideoProfileInfo();
  } catch (error) {
    console.error(error);
  }
};

// Renders #video_source_summary/#video_profile_list for whichever channel
// is currently selected in #channel, from the cached
// deviceInformation.channels (see populateChannelSelect() above) — no
// network request of its own. Each profile row shows Default/Event/Record
// badges from the channel's videoprofilepolicy response, and clicking a
// row copies that profile's Name into the #profile field (the value the
// <rtsp-over-websocket> element's `profile` attribute expects).
var renderVideoProfileInfo = function () {
  try {
    var summaryEl = document.getElementById("video_source_summary");
    var listEl = document.getElementById("video_profile_list");
    summaryEl.replaceChildren();
    listEl.replaceChildren();

    var channels = deviceInformation.channels;
    if (!channels || !channels.length) {
      summaryEl.textContent = 'No video source information yet — check "Use SUNAPI" first.';
      return;
    }

    // #channel's <option>s are 1-based (see populateChannelSelect()); SUNAPI's
    // own Channel numbering is 0-based, so convert back to look this entry up.
    var selectedChannel = Number((document.getElementById("channel") as HTMLInputElement).value) - 1;
    var channelInfo = channels.filter(function (c) { return c.Channel === selectedChannel; })[0];
    if (!channelInfo) {
      summaryEl.textContent = 'No video source information for this channel.';
      return;
    }

    summaryEl.textContent =
      'Video Source Token: ' + (channelInfo.VideoSourceToken || '-') +
      '  /  Sensor Capture Frame Rate: ' + (channelInfo.SensorCaptureFrameRate || '-');

    var policy = channelInfo.ProfilePolicy || {};
    var profiles = (channelInfo.Profile && channelInfo.Profile.Profiles) || [];
    var selectedProfileName = (document.getElementById("profile") as HTMLInputElement).value;

    profiles.forEach(function (profile) {
      var row = document.createElement('div');
      row.className = 'profile-row';
      if (profile.Name === selectedProfileName) {
        row.classList.add('selected');
      }

      var badges = document.createElement('div');
      badges.className = 'profile-badges';
      if (profile.Profile === policy.DefaultProfile) {
        var defaultBadge = document.createElement('span');
        defaultBadge.className = 'profile-badge default';
        defaultBadge.textContent = 'Default';
        badges.append(defaultBadge);
      }
      if (profile.Profile === policy.EventProfile) {
        var eventBadge = document.createElement('span');
        eventBadge.className = 'profile-badge event';
        eventBadge.textContent = 'Event';
        badges.append(eventBadge);
      }
      if (profile.Profile === policy.RecordProfile) {
        var recordBadge = document.createElement('span');
        recordBadge.className = 'profile-badge record';
        recordBadge.textContent = 'Record';
        badges.append(recordBadge);
      }

      var nameSpan = document.createElement('span');
      nameSpan.className = 'profile-name';
      nameSpan.textContent = profile.Profile + '. ' + profile.Name;
      row.append(nameSpan);

      var metaSpan = document.createElement('span');
      metaSpan.className = 'profile-meta';
      metaSpan.textContent = [profile.EncodingType, profile.Resolution, profile.FrameRate + 'fps', profile.Bitrate + 'kbps'].join(' · ');
      row.append(metaSpan);

      row.append(badges);

      row.addEventListener('click', function () {
        (document.getElementById("profile") as HTMLInputElement).value = profile.Name;
        listEl.querySelectorAll('.profile-row').forEach(function (el) { el.classList.remove('selected'); });
        row.classList.add('selected');
      });

      listEl.append(row);
    });
  } catch (error) {
    console.error(error);
  }
};

var onchangeprofile = function (event) {
  try {
    changedebug("onchangeprofile: " + fastJsonStringfy(event.detail));
  } catch (error) {
    console.error(error);
  }
}

var onchangeprofilenumber = function (event) {
  try {
    changedebug("onchangeprofilenumber: " + fastJsonStringfy(event.detail));
  } catch (error) {
    console.error(error);
  }
}

var changeprofile = function () {
  try {
    if(!isNaN(parseInt(document.getElementById("profile").value, 10))) {
      getSelectedPlayer().profile = null;
      getSelectedPlayer().profile_number = document.getElementById("profile").value;
    } else {
      getSelectedPlayer().profile_number = null;
      getSelectedPlayer().profile = document.getElementById("profile").value;
    }
  } catch (error) {
    console.error(error);
  }
}

var onchangedevicetype = function (event) {
  try {
    changedebug("onchangeprofilenumber: " + fastJsonStringfy(event.detail));
  } catch (error) {
    console.error(error);
  }
}

var onstatechange = function (evt) {
  changedebug("onstatechange: " + fastJsonStringfy(evt.detail));

  switch (evt.detail.readyState) {
    case RTSPOverWebSocketPlayState.PLAYING:
      console.log("state changed: elementId [", evt.detail.elementId, "], play start");

      document.getElementById("play_button").disabled = true;
      document.getElementById("stop_button").disabled = false;
      document.getElementById("pause_button").disabled = false;
      document.getElementById("resume_button").disabled = true;
      document.getElementById("capture_button").disabled = false;
      document.getElementById("capture2_button").disabled = false;

      document.getElementById("minimap").disabled = false;

      try {
        if (document.getElementById(evt.detail.elementId).playType !== RTSPOverWebSocketPlayType.BACKUP && document.getElementById(evt.detail.elementId).ismute) {
          document.getElementById("unmute").disabled = false;
          // document.getElementById("unmute").disabled = false;
        }
      } catch (error) {
        console.error(error);
      }

      if (document.getElementById(evt.detail.elementId).playType === RTSPOverWebSocketPlayType.PLAYBACK) {
        document.getElementById("forward").disabled = false;
        document.getElementById("backward").disabled = false;
        document.getElementById("speed").disabled = false;
      }
      break;
    case RTSPOverWebSocketPlayState.STOPPED:
      document.getElementById("timestamp_date").remove();
      document.getElementById("timestamp_time").remove();

      console.log("state changed: elementId [", evt.detail.elementId, "], play stop");

      document.getElementById("play_button").disabled = false;
      document.getElementById("stop_button").disabled = true;
      document.getElementById("pause_button").disabled = true;
      document.getElementById("resume_button").disabled = true;
      document.getElementById("capture_button").disabled = true;
      document.getElementById("capture2_button").disabled = true;

      document.getElementById("unmute").disabled = true;
      document.getElementById("mute").disabled = true;
      document.getElementById("volume").disabled = true;
      document.getElementById("getaudiovolume").disabled = true;
      document.getElementById("talk").disabled = true;

      document.getElementById("minimap").disabled = true;
      document.getElementById("unmute").disabled = false;

      if (document.getElementById(evt.detail.elementId).playType === RTSPOverWebSocketPlayType.PLAYBACK) {
        document.getElementById("forward").disabled = false;
        document.getElementById("backward").disabled = false;
        document.getElementById("speed").disabled = true;
      }

      // check reconnect checkbox state
      if(document.getElementById("reconnect").checked == true) {
        getSelectedPlayer().play();
      }
      break;
    case RTSPOverWebSocketPlayState.PAUSED:
      console.log("state changed: elementId [", evt.detail.elementId, "], play pause");

      document.getElementById("play_button").disabled = true;
      document.getElementById("stop_button").disabled = false;
      document.getElementById("pause_button").disabled = true;
      document.getElementById("resume_button").disabled = false;
      document.getElementById("capture_button").disabled = false;
      document.getElementById("capture2_button").disabled = false;

      if (document.getElementById(evt.detail.elementId).playType === RTSPOverWebSocketPlayType.PLAYBACK) {
        document.getElementById("forward").disabled = false;
        document.getElementById("backward").disabled = false;
        document.getElementById("speed").disabled = true;
      }
      break;
    case RTSPOverWebSocketPlayState.STEP:
      console.log("state changed: elementId [", evt.detail.elementId, "], step play");
      document.getElementById("resume_button").disabled = false;
      document.getElementById("capture_button").disabled = false;
      document.getElementById("capture2_button").disabled = false;
      break;
  }
}

var onstatechangebackup = function () {
  var elementPlayer = getSelectedPlayer();
  var elementBackupFilename = document.getElementById('backup_filename');
  var elementBackupCheckbox = document.getElementById("backup_checkbox");
  var elementPlaybackRadio = document.getElementById('playback_radio');

  if (elementBackupFilename !== undefined &&
    elementPlayer !== undefined &&
    elementBackupCheckbox !== undefined &&
    elementPlaybackRadio !== undefined) {

    var filename = elementBackupFilename.value;

    if ((!filename || /^\s*$/.test(filename)) && elementPlaybackRadio.checked !== true) {
      alert("Backup file name is empty!!!");
      elementBackupCheckbox.checked = false;
      return;
    }

    var value = elementPlaybackRadio.checked;
    if (value) {
      document.getElementById("speed").disabled = false;
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


var onstatechangeinstantplayback = function () {
  var elementPlayer = getSelectedPlayer();
  var elementInstantplaybackCheckbox = document.getElementById("instantplayback_checkbox");

  if (elementPlayer !== undefined &&
    elementInstantplaybackCheckbox !== undefined) {

    if (elementInstantplaybackCheckbox.checked) {
      //elementPlayer.mode = 'instantplayback';
      elementPlayer.playType = RTSPOverWebSocketPlayType.INSTANTPLAYBACK;
    } else {
      //elementPlayer.mode = 'live';
      elementPlayer.playType = RTSPOverWebSocketPlayType.LIVE;
    }
  }
}

var play = function () {
  // play media

  try {
    if (getSelectedPlayer().device === 'camera') {
      getSelectedPlayer().play();
    } else {
      // var checked = document.getElementById("use_sunapi_client_checkbox").checked;
      // if(checked) {
      //   sessionPromise = sunapiMng.getSessionKey();
      //   sessionPromise.then(function (sessionKey) {
      //     if (typeof sessionKey.SessionKey !== 'undefined') {
      //       var element = document.getElementById(selectedChannel);
      //       if (element !== undefined) {
      //         //              element.setSunapiClient(sunapiMng.getSunapiClient());
      //         element.sessionKey = sessionKey.SessionKey;
      //         element.play();
      //       }
      //     }
      //   }).catch(function (error) {
      //     if (toHex(error.errorCode) === '0x0700') {
      //       alert("If you find this message, I recommand to use with the web server.")
      //     }
      //     element.play();
      //   });
      // } else {
      //   var element = document.getElementById(selectedChannel);
      //   if (element !== undefined) {
      //     //              element.setSunapiClient(sunapiMng.getSunapiClient());
      //     element.sessionKey = 1000;
      //     element.play();
      //   }
      // }
    }
  } catch (error) {
    changedebug("play error: " + fastJsonStringfy(error));
    // AuthError extends the library's common RTSPOverWebSocketBaseError —
    // else-if here so an AuthError isn't also handled a second time by
    // the generic base-class branch below.
    if(error instanceof AuthError) {
      // document.querySelector('input[id="use_sunapi_client_checkbox"]').checked = false;
      var strMessage = "<div><h4>Error Code: " + toHex(error.errorCode) + "<br>Error: " + error.message + "</h4></div>";
      window.popup(strMessage);
    } else if(error instanceof RTSPOverWebSocketBaseError) {
      var strMessage = "<div><h4>Error Code: " + toHex(error.errorCode) + "<br>Error: " + error.message + "</h4></div>";
      window.popup(strMessage);
    }
  }
}

var onStopClick = function () {
  try {
    getSelectedPlayer().stop();
  } catch (error) {
    console.error("stop error:", error);
  }
}

var pause = function () {
  try {
    getSelectedPlayer().pause();
  } catch (error) {
    console.error("pause error:", error);
  }
}

var resume = function () {
  try {
    getSelectedPlayer().resume();
  } catch (error) {
    console.error("resume error:", error);
  }
}

var on_player_select = function() {
  try {
    selected_player_id = document.getElementById("player_list").value;
    console.log("Selected Player:", selected_player_id);

    // console.log("", getSelectedPlayer().username, getSelectedPlayer().password);
    if( !getSelectedPlayer().username || !getSelectedPlayer().password) {
      document.getElementById("user").style.display = "block";
    } else {
      document.getElementById("user").style.display = "none";
      if(document.getElementById("use_sunapi_client_checkbox").checked == true) {
        initSunapiManager();
      }
    }

    // set username and password from rtsp-over-websocket attribute
    if (typeof(getSelectedPlayer().username) !== 'undefined' ||
        getSelectedPlayer().username == null ||
        getSelectedPlayer().username == '') {
      document.getElementById("username").value = getSelectedPlayer().username;
    }
    if (typeof(getSelectedPlayer().password) !== 'undefined' ||
        getSelectedPlayer().password == null ||
        getSelectedPlayer().password == '') {
      document.getElementById("password").value = getSelectedPlayer().password;
    }

    // set channel number from rtsp-over-websocket attribute
    document.getElementById("channel").value = getSelectedPlayer().channel;


    if (typeof(getSelectedPlayer().statistics) !== 'undefined' ||
        getSelectedPlayer().statistics == null ||
        getSelectedPlayer().statistics == '') {
      document.getElementById("statistics").checked = getSelectedPlayer().statistics;
    }

    if ((typeof(getSelectedPlayer().device) !== 'undefined' || getSelectedPlayer().device == '' || getSelectedPlayer().device == null) ||
        (getSelectedPlayer().hostname == '' || typeof(getSelectedPlayer().hostname) !== 'undefined' || getSelectedPlayer().hostname == null) ||
        (getSelectedPlayer().channel == '' || typeof(getSelectedPlayer().channel) !== 'undefined' || getSelectedPlayer().channel == null) ||
        (getSelectedPlayer().port == '' || typeof(getSelectedPlayer().port) !== 'undefined' || getSelectedPlayer().port == null) ||
        ((getSelectedPlayer().profile_number == '' || typeof(getSelectedPlayer().profile_number) !== 'undefined' || getSelectedPlayer().profile_number == null) ||
         (getSelectedPlayer().profile == '' || typeof(getSelectedPlayer().profile) !== 'undefined' || getSelectedPlayer().profile == null))
       ) {
      document.getElementById("device").style.display = "block";

      console.log("", getSelectedPlayer().device);
      console.log("", getSelectedPlayer().hostname);
      console.log("", getSelectedPlayer().port);
      console.log("", getSelectedPlayer().channel);
      console.log("", getSelectedPlayer().profile_number);
      console.log("", getSelectedPlayer().profile);

      // select device type
      if (getSelectedPlayer().device === 'nvr') {
        (document.getElementById("device_type") as HTMLSelectElement).selectedIndex = 1;
      } else {
        (document.getElementById("device_type") as HTMLSelectElement).selectedIndex = 0;
      }

      // set hostname and port from rtsp-over-websocket attribute
      if (typeof(getSelectedPlayer().hostname) !== 'undefined' ||
                 getSelectedPlayer().hostname == null ||
                 getSelectedPlayer().hostname == '') {
        document.getElementById("hostname").value = getSelectedPlayer().hostname;
      }
      if (typeof(getSelectedPlayer().port) !== 'undefined' ||
                 getSelectedPlayer().port == null ||
                 getSelectedPlayer().port == '') {
        document.getElementById("port").value = getSelectedPlayer().port;
      }

      if (typeof(getSelectedPlayer().channel) !== 'undefined' ||
                 getSelectedPlayer().channel == null ||
                 getSelectedPlayer().channel == '') {
        document.getElementById("channel").value = getSelectedPlayer().channel;
      }

      if (typeof(getSelectedPlayer().profile_number) !== 'undefined' ||
          getSelectedPlayer().profile_number == null ||
          getSelectedPlayer().profile_number == '') {
        document.getElementById("profile").value = getSelectedPlayer().profile_number;
      }

      if (typeof(getSelectedPlayer().profile) !== 'undefined' ||
          getSelectedPlayer().profile == null ||
          getSelectedPlayer().profile == '') {
        document.getElementById("profile").value = getSelectedPlayer().profile;
      }

      // #usegmttime has no corresponding element in window.html (a
      // pre-existing dead reference — see the near-identical #broadcast
      // note above); guarded the same way rather than throwing and
      // aborting the rest of on_player_select().
      if ((typeof(getSelectedPlayer().GMT) !== 'undefined' ||
          getSelectedPlayer().GMT == null ||
          getSelectedPlayer().GMT == '') &&
          document.getElementById("usegmttime") !== null) {
        document.getElementById("usegmttime").value = getSelectedPlayer().GMT + 12;
      }
    } else {
      document.getElementById("device").style.display = "none";
      // if use the sunapi manager
      if(document.getElementById("use_sunapi_client_checkbox").checked == true) {
        initSunapiManager();
      }
    }

    if(typeof(getSelectedPlayer().sunapiClient) !== 'undefined' ||
       getSelectedPlayer().sunapiClient == null) {

      document.getElementById("play_button").disabled = false;
      document.getElementById("stop_button").disabled = true;
      document.getElementById("pause_button").disabled = true;
      document.getElementById("resume_button").disabled = true;
    } else {
      // if (sunapiMng === undefined || sunapiMng === null) {
      //   sunapiMng = new sunapiManager();
      //   sunapiMng.setSunapiClient(element.sunapiClient);
      // } else {
      //   sunapiMng.setSunapiClient(element.sunapiClient);
      // }
    }
  } catch(error) {
    console.log("error" + error);
  }
}

var onchangehttptype = function() {
  try {
    const checkedHttpType = document.querySelector('input[type="radio"][name="http_type"]:checked') as HTMLInputElement | null;
    const httptype = checkedHttpType ? checkedHttpType.value : undefined;
    console.log(httptype);

    if (httptype && httptype === 'https') {
      getSelectedPlayer().https = true;
    } else {
      getSelectedPlayer().https = false;
    }
  } catch (error) {
    console.error(error);
  }
}

var onchangeplaytype = function () {
  try {
    // reference from:
    // https://stackoverflow.com/questions/19141911/toggling-radio-buttons-with-jquery
    // var $radios = $('input[type="radio"][name="speeds"]')

    // reference from:
    // https://stackoverflow.com/questions/18043452/in-jquery-how-do-i-get-the-value-of-a-radio-button-when-they-all-have-the-same
    const checkedPlayType = document.querySelector('input[type="radio"][name="play_type"]:checked') as HTMLInputElement | null;
    const playtype = checkedPlayType ? checkedPlayType.value : undefined;
    console.log(playtype);

    if (playtype && playtype === 'playback') {
      document.getElementById("playback_control").style.display = "block";
      getSelectedPlayer().playType = RTSPOverWebSocketPlayType.PLAYBACK;
      // or elementPlayer.playType = 1;
      //      if(elementPlayer.device === 'camera') {
      var currentTime = new Date();
      //elementPlayer.startTime = dateControl.value + "T00:00:01.000Z";
      //elementPlayer.startTime = "2019-08-26T00:00:00.000Z"
      // elementPlayer.endTime = dateControl.value + "T" + ("0" + (currentTime.getHours())).slice(-2) + ":" + ("0" + (currentTime.getMinutes())).slice(-2) + ":" + ("0" + (currentTime.getSeconds())).slice(-2) + "Z";
      getSelectedPlayer().overlappedId = 0;

      // if (startTimeControl !== null && startTimeControl !== undefined) {
      //   startTimeControl.value = "00:00:01";
      // }

      // if (endTimeControl !== null && endTimeControl !== undefined) {
      //   var strTime = ("0" + (currentTime.getHours())).slice(-2) + ":" + ("0" + (currentTime.getMinutes())).slice(-2) + ":" + ("0" + (currentTime.getSeconds())).slice(-2);
      //   endTimeControl.value = strTime;
      // }

      // if (seekingTimeControl !== null && seekingTimeControl !== undefined) {
      //   var strTime = ("0" + (currentTime.getHours())).slice(-2) + ":" + ("0" + (currentTime.getMinutes())).slice(-2) + ":" + ("0" + (currentTime.getSeconds())).slice(-2);
      //   seekingTimeControl.value = strTime;
      // }
      // //      }

      // var elementSpeed = document.getElementById('speed');
      // var speedValue = elementPlayer.playSpeed;

      // for (var i = 0, j = elementSpeed.options.length; i < j; ++i) {
      //   if (elementSpeed.options[i].value == elementPlayer.playSpeed) {
      //     elementSpeed.selectedIndex = i;
      //     break;
      //   }
      // }
    } else {
      document.getElementById("playback_control").style.display = "none";
      // document.getElementById('live_radio').checked = true;
      // document.getElementById('playback_radio').checked = false;
      getSelectedPlayer().playType = RTSPOverWebSocketPlayType.LIVE;
      //or element.playType = 0;
    }

  } catch (error) {
    console.error(error);
  }
}

var onchangestatistics = function () {
  try {
    getSelectedPlayer().statistics = document.getElementById("statistics").checked;
  } catch (error) {
    console.error(error);
  }
}


let searchObject;

var searchTree = function (elements, matchingTitle){
  if (Array.isArray(elements)) {
    let result = elements.find(function(node) {
      if( typeof(node.attribute.name) !== 'undefined') {
        if(node.attribute.name === matchingTitle) {
          console.log(node.attribute.name);

          if( typeof(node.attribute.type) !== 'undefined') {
            console.log("Type:", node.attribute.type);
          }
          if( typeof(node.attribute.value) !== 'undefined') {
            console.log("Value:", node.attribute.value);
          }
          if( typeof(node.attribute.accesslevel) !== 'undefined') {
            console.log("AccessLevel:", node.attribute.accesslevel);
          }

          return node.attribute.name === matchingTitle;
        }
      }

      if( Array.isArray(node.attribute)) {
        let temp = searchTree(node.attribute, matchingTitle);
        if(typeof(temp) !== 'undefined') {
          searchObject = temp;
        }
      }
      if(typeof(node.category) !== 'undefined') {
        let temp = searchTree(node.category, matchingTitle);
        if(typeof(temp) !== 'undefined') {
          searchObject = temp;
        }
      }
    });

    if(typeof(result) !== 'undefined') {
      console.log(fastJsonStringfy(result.attribute));
      return result.attribute;
    }
  } else {
    // console.log(fastJsonStringfy(elements));
    let temp = searchTree(elements.attribute, matchingTitle);
    if(typeof(temp) !== 'undefined') {
      searchObject = temp;
    }
  }
}

var initSunapiManager = () => {
  if (getSelectedPlayer() !== null) {
    try {
      checkUserAccount();
      let videoChannels = [];

      // `device` here is this file's module-scoped `var device = {...}`
      // singleton (see its own declaration near the top of the file) — not
      // `this.device`. Under the old classic-script compile, this arrow
      // function's top-level `this` was `window`, and `window.device` was
      // the very same object (`var device` at top level implicitly becomes
      // a `window` property in a classic script) — so `this.device` and
      // `device` were interchangeable. Now that this file compiles as a
      // real ES module (see vite.config.ts), top-level `this` is
      // `undefined` per the module spec, so `this.device` would throw;
      // referencing `device` directly (already in scope via closure) is
      // the faithful equivalent, not a behavior change.
      device.user = device.username = document.getElementById("username").value;
      device.password = document.getElementById("password").value;
      device.deviceType = getSelectedPlayer().device;

      if (device.deviceType === 'camera') {
        device.cameraIp = getSelectedPlayer().hostname;
        device.hostname = '';
      } else {
        device.hostname = getSelectedPlayer().hostname;
        device.cameraIp = '';
      }

      device.port = document.getElementById("port").value;

      // Explicit, not derived from window.location.protocol — this page's
      // own origin is chrome-extension://..., never a valid protocol to
      // reach a SUNAPI device on (see SunapiManager.init()'s own guard
      // against exactly this in the rtsp-over-websocket repo).
      var checkedHttpType = document.querySelector('input[type="radio"][name="http_type"]:checked') as HTMLInputElement | null;
      var httptype = checkedHttpType ? checkedHttpType.value : undefined;
      device.protocol = (httptype === 'https') ? 'https' : 'http';

      // rtsp-over-websocket's SunapiManager.init() resolves with the raw
      // /stw-cgi/attributes.cgi response directly — the same endpoint the
      // legacy two-step init()-then-login() flow ended up calling via
      // login() (both `Initialized` and `DeviceInfoReady`/`CgiSectionReady`/
      // `AttributeSectionReady` live on that one response), so this is a
      // single .then() now instead of the old init().then(() => login())
      // chain. Not verified against a real device — see this repo's WSL2
      // networking note in README.md for why that couldn't be tested here.
      //
      // "Bypass Untrusted Certificate (Native Host)" checkbox — see
      // docs/native-https-proxy/DESIGN.md. SunapiManager.init() always
      // builds its own browser-XHR client internally and ignores anything
      // already attach()ed, so working around a self-signed certificate
      // means not calling init() at all here: nativeSunapiClient.initDevice()
      // replicates its device normalization and first request itself
      // (through the native host instead of the browser), then attach()es
      // so every later SunapiManager call in this chain (getVideoSource(),
      // etc.) transparently goes through the same client.
      if (nativeSunapiClient !== null) {
        nativeSunapiClient.close();
        nativeSunapiClient = null;
      }
      var useNativeTlsProxyEl = document.getElementById("use_native_tls_proxy_checkbox");
      var useNativeTlsProxy = IS_EXTENSION && useNativeTlsProxyEl !== null && useNativeTlsProxyEl.checked;
      var initPromise;
      if (useNativeTlsProxy) {
        nativeSunapiClient = new NativeSunapiClient(device);
        getSunapiManager().attach(nativeSunapiClient);
        initPromise = nativeSunapiClient.initDevice(device);
      } else {
        initPromise = getSunapiManager().init(device);
      }

      // Streaming counterpart of the SUNAPI proxy above — wss://.../StreamingServer
      // is a browser WebSocket independent of the SUNAPI REST calls above,
      // and hits the exact same TLS-trust wall on a self-signed camera. See
      // docs/native-https-proxy/DESIGN.md. rtsp-over-websocket's
      // <rtsp-over-websocket> element only builds its internal StreamPlayer
      // once (play()'s own `if (this.player === undefined || this.player
      // === null)` guard), so this must be set before the first play() —
      // setting it again later on an already-playing element is a no-op
      // until the next fresh connection.
      getSelectedPlayer().transportFactory = useNativeTlsProxy ? createNativeTransportFactory() : undefined;

      initPromise.then(attributes => {
        console.log("", attributes);

        // `Initialized` was a JSON-encoded string ("true"/"false") in the
        // legacy two-step API; rtsp-over-websocket's SunapiManager.init()
        // resolves with the raw /stw-cgi/attributes.cgi response, where
        // this field may already be a native boolean (or absent) instead —
        // not verified against a real device (see comment above). Handles
        // both shapes rather than assuming JSON.parse() is still correct.
        var initialized = typeof attributes.Initialized === 'string'
          ? JSON.parse(attributes.Initialized)
          : attributes.Initialized;
        if (initialized === false) {
          var strMessage = "<div><h4>Device is not initialize</h4></div>";
          window.popup(strMessage);
        }

        // console.log("", attributes);
        changedebug("onattributes: " + fastJsonStringfy(attributes));

        // `DeviceInfoReady`/`CgiSectionReady`/`AttributeSectionReady` were
        // never fields the device sends — they were flags a previous,
        // now-removed capabilities-XML parser computed itself while
        // walking the attributes.cgi response with its own ~2500-line
        // parser. rtsp-over-websocket's SunapiManager.init() has no
        // equivalent parser: it resolves with the raw attributes.cgi
        // response as-is (this device's firmware returns XML text rather
        // than JSON, so `attributes` here is a string, not an object),
        // meaning those three fields never exist and this gate always
        // threw regardless of whether the request actually succeeded. A
        // resolved promise (this code running at all) already means the
        // SUNAPI call succeeded, so that's the only check needed now.
        // `deviceInformation.attributes.IsAndroid` etc. below degrade
        // harmlessly to undefined until this response is actually parsed
        // (no XML parser ships with the extension anymore either).
        if (attributes) {
          getSelectedPlayer().sunapiClient = getSunapiManager().getSunapiClient();

          deviceInformation.attributes = attributes;
          document.getElementById("is_android").checked = deviceInformation.attributes.IsAndroid;
          getSelectedPlayer().android = deviceInformation.attributes.IsAndroid;
          return getSunapiManager().getVideoSource();
          // return getSunapiManager().getDeviceInfo();
        } else {
          var strMessage = "<div><h4>Device attributes not ready.</h4></div>";
          window.popup(strMessage);
          throw new Error("Device attributes not ready");
        }
      })
      // .then(device_info => {
      //   console.log("", device_info);
      //   if (typeof device_info !== 'undefined') {
      //     return getSunapiManager().getVideoSource();
      //   }
      // })
      .then(VideoSource => {
        console.log("", VideoSource);
        if (typeof VideoSource !== 'undefined') {
          videoChannels = VideoSource;
          // return getSunapiManager().getDeviceInfo();
          return getSunapiManager().getVideoProfilePolicyAll();
        } else {
          var strMessage = "<div><h4>Video Source is not defined.</h4></div>";
          window.popup(strMessage);
        }
      })
      // .then(deviceInfo => {
      //   console.log("", deviceInfo);
      //   deviceInformation.device = deviceInfo;
      //   return getSunapiManager().getVideoProfilePolicyAll();
      // })
      .then(videoProfilePolicies => {
        console.log("", videoProfilePolicies);
        if (typeof videoProfilePolicies !== 'undefined') {
          videoProfilePolicies.forEach(policy => {
              console.log(fastJsonStringfy(policy));
              videoChannels[policy.Channel].ProfilePolicy = policy;
          });
          return getSunapiManager().getVideoProfile();
        } else {
          var strMessage = "<div><h4>Video Profile policy is not defined.</h4></div>";
          window.popup(strMessage);
        }
      })
      .then(videoProfile => {
        console.log("", videoProfile);
        if (typeof videoProfile !== 'undefined') {
          videoProfile.forEach(profile => {
              console.log(fastJsonStringfy(profile));
              videoChannels[profile.Channel].Profile = profile;
          });

          deviceInformation.channels = videoChannels;
          populateChannelSelect();
        }
        return getSunapiManager().getTimezoneInfo();
        // return getSunapiManager().getStorageInfo();
      })
      // .then(StorageInfo => {
      //   if (typeof StorageInfo !== 'undefined') {
      //     console.log("StorageInfo:" + fastJsonStringfy(StorageInfo));
      //     deviceInformation.storage = StorageInfo;
      //   } else {
      //     var strMessage = "<div><h4>Storage infomation can not get.</h4></div>";
      //     window.popup(strMessage);
      //   }
      //   return getSunapiManager().getTimezoneInfo();
      // })
      .then(timezoneList => {
        if (typeof timezoneList !== 'undefined') {
          console.log("Timezone List:", fastJsonStringfy(timezoneList));
          deviceInformation.timezoneList = timezoneList;
        } else {
          var strMessage = "<div><h4>timezone list infomation can not get.</h4></div>";
          window.popup(strMessage);
        }
        return getSunapiManager().getDateInfo();
      })
      .then(dateInfo => {
        if(typeof dateInfo.TimeZoneIndex !== 'undefined' && getSelectedPlayer().device === 'camera') {
          deviceInformation.dateInfo = dateInfo;
          deviceInformation.timezone = deviceInformation.timezoneList.TimeZones[dateInfo.TimeZoneIndex];
          // var timezone = deviceInformation.timezoneList.TimeZones[dateInfo.TimeZoneIndex];
          var dateArray = deviceInformation.timezone.TimeZone.match(/\(([A-Za-z\s].*)\)/)[1];
          var tmpTimezone = dateArray.replace('GMT', '');

          if(!document.getElementById("use_gmt").checked) {
            document.getElementById("use_gmt").checked = true;
            document.getElementById("timezone").disabled = false;
          }

          if (tmpTimezone.indexOf(':') !== -1) {
            var TimezoneHour = parseInt(tmpTimezone.split(':')[0]);
            var TimezoneMinute = parseInt(tmpTimezone.split(':')[1]);

            if(TimezoneMinute !== 0) {
              TimezoneHour += 0.5;
            }

            // set timezone value
            getSelectedPlayer().GMT = TimezoneHour;
            document.getElementById("timezone").value = TimezoneHour;
          }

        } else if (element.device === 'nvr') {
          deviceInformation.dateInfo = dateInfo;
        } else {
          var strMessage = "<div><h4>dateInfo infomation can not get.</h4></div>";
          window.popup(strMessage);
        }
      })
      .then(() => {
        getSelectedPlayer().sunapiClient = getSunapiManager().getSunapiClient();

        // .volume's getter (getAudioVolume()) throws "player object is not
        // exist" until playback has actually started — correctly so (a
        // fabricated value would just hide a real "no player yet" state,
        // see this element library's own notes on the method). No autoplay
        // anymore (see window.html), so a player only exists once `isplay`
        // is true; only read volume then, matching the same condition the
        // play/stop button states below already gate on.
        if (getSelectedPlayer().isplay !== true) {
          document.getElementById("play_button").disabled = false;
          document.getElementById("stop_button").disabled = true;
          document.getElementById("pause_button").disabled = true;
          document.getElementById("resume_button").disabled = true;
        } else {
          document.getElementById("play_button").disabled = true;
          document.getElementById("stop_button").disabled = false;
          document.getElementById("pause_button").disabled = false;
          document.getElementById("resume_button").disabled = false;

          document.getElementById("getaudiovolume").value = getSelectedPlayer().volume;
          document.getElementById("volume").value = getSelectedPlayer().volume;
        }

        document.getElementById("use_sunapi_client_checkbox").checked = true;
      })
      .catch(error => {
        console.error("error", error);
        // SunapiError extends the library's common RTSPOverWebSocketBaseError
        // now (was two unrelated legacy classes) — most-specific check
        // first, generic base last via else-if, so a SunapiError doesn't
        // also get handled (and popped up) a second time by the generic
        // branch. DOMException is a separate, unrelated hierarchy.
        if(error instanceof SunapiError) {
          console.error("error", error);
          // document.querySelector('input[id="use_sunapi_client_checkbox"]').checked = false;
          document.getElementById("use_sunapi_client_checkbox").checked = false;

          var strMessage = "<div><h4>Error Code: " + toHex(error.errorCode) + "<br>Error: " + error.message + "</h4></div>";
          window.popup(strMessage);
        } else if(error instanceof RTSPOverWebSocketBaseError) {
          console.error("error", error);
          var strMessage = "<div><h4>getOverlappedIdList error: " + error.errorCode + "<br>message: " + error.message + "</h4></div>";
          window.popup(strMessage);
        } else if(error instanceof DOMException) {
          console.error("error", error);
          // document.querySelector('input[id="use_sunapi_client_checkbox"]').checked = false;
          document.getElementById("use_sunapi_client_checkbox").checked = false;

          var strMessage = "<div><h4>Error Code: " + toHex(error.errorCode) + "<br>Error: " + error.message + "</h4></div>";
          window.popup(strMessage);
        }

        document.getElementById("use_sunapi_client_checkbox").checked = false;
      });
    } catch (error) {
      changedebug("initSunapiManager: " + fastJsonStringfy(error));

      if(error instanceof AuthError) {
        console.error("error", error);
        document.querySelector('input[id="use_sunapi_client_checkbox"]').checked = false;

        var strMessage = "<div><h4>Error Code: " + toHex(error.errorCode) + "<br>Error: " + error.message + "</h4></div>";
        window.popup(strMessage);
      }

      //   document.getElementById("getaudiovolume").setAttribute('value', 0);

      //   document.getElementById("play_button").disabled = false;
      //   document.getElementById("stop_button").disabled = true;
      //   document.getElementById("pause_button").disabled = true;
      //   document.getElementById("resume_button").disabled = true;

      return false;
    }
  }
};

var on_change_use_sunapi_client = function () {
  if(document.getElementById("use_sunapi_client_checkbox").checked == false) {
    getSelectedPlayer().sunapiClient = null;

    // No SUNAPI channel list to choose from anymore — back to a plain,
    // freely-editable channel number field, and clear the now-stale
    // video source/profile display.
    setChannelWidgetMode(false);
    deviceInformation.channels = undefined;
    renderVideoProfileInfo();
  } else {
    getSelectedPlayer().sunapiClient = null;
    initSunapiManager();
  }
}

var checkUserAccount = function () {
  var username = document.getElementById("username").value;
  var password = document.getElementById("password").value;
  var hostname = document.getElementById("hostname").value;
  var port = document.getElementById("port").value;

  if (typeof username !== 'string' || username === '') {
    throw new AuthError({
      errorCode: fromHex('0x0402'),
      place: 'rtsp-over-websocket-example.html:checkUserAccount',
      message: "Invalid User Name"
    });
  }

  if (typeof password !== 'string' || password === '') {
    throw new AuthError({
      errorCode: fromHex('0x0403'),
      place: 'rtsp-over-websocket-example.html:checkUserAccount',
      message: "Invalid User Password"
    });
  }

  if (typeof hostname !== 'string' || hostname === '') {
    throw new AuthError({
      errorCode: fromHex('0x0401'),
      place: 'rtsp-over-websocket-example.html:checkUserAccount',
      message: "Invalid hostname"
    });
  }

  if (port === '' || Number.isInteger(port)) {
    throw new AuthError({
      errorCode: fromHex('0x040F'),
      place: 'rtsp-over-websocket-example.html:checkUserAccount',
      message: "Invalid port number"
    });
  }

}

var changespeed = function () {
  // var elementPlayer = document.getElementById(selectedChannel);  // var elementPlayer = document.getElementById(selectedChannel);
  //var selectedSpeed = document.getElementById("speed");
  // var speed = document.getElementById("speed").value;

  // if (elementPlayer !== undefined) {
  //   console.log('speed', speed);
  //   elementPlayer.playSpeed = speed;
  // }
  //    var element = document.getElementById(selectedChannel);
  //    var x = document.getElementById("getaudiovolume").setAttribute('value', element.getAudioVolume());
  try {
    getSelectedPlayer().playSpeed = document.getElementById("speed").value;
  } catch (error) {
    console.error(error);
  }
}


var onmeta = function (evt) {
  changedebug("onmeta: " + fastJsonStringfy(evt.detail.json));

}

var onClose = function (message) {
  changedebug("onclose: " + fastJsonStringfy(message.detail));
}


var onError = function (error) {
  if(_useDebug) {
    var str = document.getElementById("debug").value;
    if(typeof(error) === "object") {
      str += "onerror: " + fastJsonStringfy(error.detail) + "\r\n";
    } else {
      str += "onerror: " + error + "\r\n";
    }
    document.getElementById("debug").value = str;
    scrollbottom();
  }
}

function onstatistics(statistics) {
  // changedebug("onstatistics: " + fastJsonStringfy(statistics.detail));
}

var onResize = function (resize) {
  changedebug("onresize: " + fastJsonStringfy(resize.detail));

  if(typeof(resize.detail) !== 'undefined') {
    if (typeof(resize.detail.width) !== 'undefined' && resize.detail.width !== null &&
        typeof(resize.detail.height) !== 'undefined' && resize.detail.height !== null) {
      var element = document.getElementById(resize.detail.elementId)
      // var element = document.getElementById();

      // resizne element
      if (typeof(resize.detail.width) !== 'undefined' && resize.detail.width !== null &&
          typeof(resize.detail.height) !== 'undefined' && resize.detail.height !== null) {
        element.setAttribute("width", resize.detail.width);
        element.setAttribute("height", resize.detail.height);
      }
    }
  }
}

var capture = function () {
  try {
    var filename = document.getElementById("backup_filename").value;

    if (!filename || /^\s*$/.test(filename)) {
      var rightNow = new Date();
      filename = rightNow.toISOString().replace(/-/g, "");
    }

    getSelectedPlayer().filename = filename;
    getSelectedPlayer().capture(filename);
  } catch (error) {
    console.error(error);
  }
}

function capture2() {
  try {
    getSelectedPlayer().filename = null;
    getSelectedPlayer().capture();
  } catch (error) {
    console.error(error);
  }
}

var oncapture = function (capture) {
  changedebug("onresize: " + fastJsonStringfy(capture.detail));

  //var image = new Image();
  var image = document.getElementById('capture');
  image.src = URL.createObjectURL(capture.detail.blob);

  window.capture();
}

var onchangeminimap = function () {
  try {
    getSelectedPlayer().minimap = document.getElementById("minimap").checked;
  } catch (error) {
    console.error(error);
  }
}

var onchangeframedrop = function () {
  try {
    getSelectedPlayer().framedrop = document.getElementById("framedrop").checked;
  } catch (error) {
    console.error(error);
  }
}

var onchangeiframeonly = function () {
  try {
    getSelectedPlayer().iframe = document.getElementById("iframe").checked;
  } catch (error) {
    console.error(error);
  }
}

var onchangebestshot = function () {
  try {
    getSelectedPlayer().bestshot = document.getElementById("bestshot").checked;
  } catch (error) {
    console.error(error);
  }
}

function setdevicetype() {
  try {
    getSelectedPlayer().device = document.getElementById("device_type").value;
  } catch (error) {
    console.error(error);
  }

}

var setrenderertype = function () {
  try {
    getSelectedPlayer().type = (document.getElementById("renderer_type") as HTMLSelectElement).value;
  } catch (error) {
    console.error(error);
  }
}

var changeusegmt = function () {
  try {
    if(document.getElementById("use_gmt").checked) {
      document.getElementById("timezone").disabled = false;
      // get value of select object, not use select index
      // if you set null value to GMT property, the player does not use the GMT time zone.
      getSelectedPlayer().GMT = document.getElementById("timezone").value;
    } else {
      document.getElementById("timezone").disabled = true;
      getSelectedPlayer().GMT = null;
    }
  } catch (error) {
    console.error(error);
  }
}

var changetimezone = function () {
  try {
    getSelectedPlayer().GMT = document.getElementById("timezone").value;
  } catch (error) {
    console.error(error);
  }
}

var onchangetimezone = function (timezone) {
  try {
    document.getElementById("timezone").value = timezone.detail.timezone;
    document.getElementById("timezone").disabled = false;

    document.getElementById("use_gmt").checked = false;
  } catch (error) {
    console.error(error);
  }
}

var onchangefullscreen = function () {
  try {
    getSelectedPlayer().fullscreen = !(getSelectedPlayer().fullscreen);
    // if(getSelectedPlayer().fullscreen) {
    //   document.getElementById("discovery").classList.remove('discovery-full');
    //   document.getElementById("container").classList.remove('container-full');
    //   $("#" + selected_player_id).removeClass('rtsp-over-websocket-full');
    //   getSelectedPlayer().fullscreen = false;
    // } else {
    //   document.getElementById("discovery").toggleClass('discovery discovery-full');
    //   document.getElementById("container").toggleClass('container container-full');
    //   $("#" + selected_player_id).toggleClass('rtsp-over-websocket rtsp-over-websocket-full');
    //   getSelectedPlayer().fullscreen = true;
    // }
  } catch (error) {
    console.error(error);
  }
}

var ontimestamp = function (timestamp) {
  // changedebug("ontimestamp: " + fastJsonStringfy(timestamp.detail));
  var elementPlayer = getSelectedPlayer();

  try {
    switch(timestamp.detail.mode) {
      case 'live':
        if(document.getElementById("timestamp_date") === null) {

          // add append child to play control
          document.getElementById("live_control").append(
            createEl('input', {
              id: 'timestamp_date',
              type: "date",
              // value: timestamp.detail.timestamp,
              style: "min-width: 100px;width: 100px !important;",
              //각 태그의 속성값이 들어오는 자리
            })
          );
          document.getElementById("live_control").append(
            createEl('input', {
              id: 'timestamp_time',
              type: "time",
              step: "0.001",
              min: "00:00:00.000",
              max: "23:59:59.999",
              // value: timestamp.detail.timestamp,
              style: "min-width: 130px;width: 100px !important;",
              //각 태그의 속성값이 들어오는 자리
            })
          );
          document.getElementById("timestamp_date").disabled = true;
          document.getElementById("timestamp_time").disabled = true;
        }

        if(timestamp.detail.local !== undefined && timestamp.detail.local !== null) {
          document.getElementById("timestamp_date").value = new Date(timestamp.detail.local).toISOString().split('T')[0];
          document.getElementById("timestamp_time").value = new Date(timestamp.detail.local).toISOString().split('T')[1].replace(/Z/gi, "");
        } else {
          document.getElementById("timestamp_date").value = new Date(new Date(timestamp.detail.timestamp)).toISOString().split('T')[0];
          document.getElementById("timestamp_time").value = new Date(new Date(timestamp.detail.timestamp)).toISOString().split('T')[1].replace(/Z/gi, "");
        }
        break;
      case 'playback':
        if(timestamp.detail.local !== undefined && timestamp.detail.local !== null) {
          document.getElementById("seeking_date").value = new Date(timestamp.detail.local).toISOString().split('T')[0];
          document.getElementById("seeking_time").value = new Date(timestamp.detail.local).toISOString().split('T')[1].replace(/Z/gi, "");
        } else {
          document.getElementById("seeking_date").value = new Date(new Date(timestamp.detail.timestamp)).toISOString().split('T')[0];
          document.getElementById("seeking_time").value = new Date(new Date(timestamp.detail.timestamp)).toISOString().split('T')[1].replace(/Z/gi, "");
        }

        var currentTimeBar;
        if(document.getElementById("use_gmt").checked) {
          var temp = "";
          temp += (timestamp.detail.timezone > 0) ? "+" : "";
          temp += pad(timestamp.detail.timezone / 60, 2) + ":00";
          currentTimeBar = vis.moment(timestamp.detail.timestamp).utcOffset(temp);
        } else {
          if(elementPlayer.device === 'camera') {
            currentTimeBar = vis.moment(timestamp.detail.local).utc();
          } else {
            currentTimeBar = vis.moment(timestamp.detail.timestamp).utc();
          }
        }

        if(typeof visTimeline !== 'undefined' && visTimeline !== null) {
          visTimeline.setCustomTime(currentTimeBar);
        }
        break;
    }

    // if(elementSeekingTimeElement !== undefined && elementSeekingTimeElement !== null) {
    // }

  } catch (error) {
    console.error(error);
  }
}

var set_use_universal_time = function () {
  try {
    getSelectedPlayer().GMT.coordinatedUniversalTime = document.getElementById("universaltime_checkbox").checked;
  } catch (error) {
    console.error(error);
  }
}

var onchangestarttime = function () {
  try {
    let startDate = document.getElementById("start_date").value;
    let startTime = document.getElementById("start_time").value;

    getSelectedPlayer().startTime = startDate + 'T' + startTime + "Z";
  } catch (error) {
    console.error(error);
  }
}

var onchangeendtime = function () {
  try {
    let endDate = document.getElementById("end_date").value;
    let endTime = document.getElementById("start_time").value;

    getSelectedPlayer().endTime = endDate + 'T' + endTime + "Z";
  } catch (error) {
    console.error(error);
  }
}

Number.prototype.pad = function(size) {
  var sign = Math.sign(this) === -1 ? '-' : '';
  return sign + new Array(size).concat([Math.abs(this)]).join('0').slice(-size);
}

// var getStartDate = function () {
//   var element = document.getElementById(selectedChannel);
//   var startDateControl = document.querySelector('input[id="start_date"]');

//   var year = new Date(startDateControl.value).getFullYear();
//   var month = new Date(startDateControl.value).getMonth() + 1;
//   var date = new Date(startDateControl.value).getDate();

//   if(typeof element === 'undefined' || element === null) {
//     return null;
//   }

//   return [year, pad(month ,2), pad(date, 2)].join('-') + ' 00:00:00';
// }

// var getEndDate = function () {
//   var element = document.getElementById(selectedChannel);
//   var endDateControl = document.querySelector('input[id="end_date"]');

//   var year = new Date(endDateControl.value).getFullYear();
//   var month = new Date(endDateControl.value).getMonth() + 1;
//   var date = new Date(endDateControl.value).getDate();

//   if(typeof element === 'undefined' || element === null) {
//     return null;
//   }

//   // if (!document.querySelector('input[id="usegmt_checkbox"]').checked  &&
//   //     element.device === 'camera') {
//     return [year, pad(month ,2), pad(date, 2)].join('-') + ' 23:59:59';
//   // } else {
//   //   return [year, pad(month ,2), pad(date, 2)].join('-') + 'T23:59:59Z';
//   // }
// }

var gettimezonestring = function (timezone) {
  var temp = "";
  // console.log("timezone value:", timezone);
  temp += (timezone >= 0) ? "+" : "";
  temp += (timezone > 0) ? Math.floor(parseFloat(timezone)).pad(2) : Math.round(parseFloat(timezone)).pad(2) + ':';// +
  temp += (timezone.toString().match(/\d*.?(\w{2})?/)) ? "00" : "30";
  // console.log("timezone string:", temp);
  return temp;
}

var search_overlapped_id = function () {
  try {
    if(!getSelectedPlayer().sunapiClient) {
      initSunapiManager();
    }

    // var strSearchStartTime = getStartDate(),
    //     strSearchEndTime = getEndDate();

    let startDate = document.getElementById("start_date").value;
    let endDate = document.getElementById("end_date").value;

    var strSearchStartTime = startDate + ' 00:00:00',
        strSearchEndTime = endDate + ' 23:59:59';

    if(document.getElementById("use_gmt").checked) {
      var timezone = gettimezonestring(document.getElementById("timezone").value);
      strSearchStartTime = moment(strSearchStartTime).utcOffset(timezone).format('YYYY-MM-DD[T]HH:mm:ss[Z]');
      strSearchEndTime = moment(strSearchEndTime).utcOffset(timezone).format('YYYY-MM-DD[T]HH:mm:ss[Z]');
    }

    console.log("onSearchOverlappedId, Search start:", strSearchStartTime, "end:", strSearchEndTime);

    // channel number start from index 0
    var overlappedIDList;
    if (getSelectedPlayer().device === 'camera' && Number(deviceInformation.attributes.MaxChannel) === 1) {
      overlappedIDList = getSunapiManager().getOverlappedIdList(strSearchStartTime, strSearchEndTime);
    } else {
      overlappedIDList = getSunapiManager().getOverlappedIdList(strSearchStartTime, strSearchEndTime, Number(getSelectedPlayer().channel) - 1);
    }

    overlappedIDList.then((overlapped_id_list) => {
      console.log("Overlapped Id List: ", overlapped_id_list);

      if(document.getElementById("overlapped_id") !== null) {
        document.getElementById("overlapped_id").remove();
      }

      if(document.getElementById("overlapped_id_span") !== null) {
        document.getElementById("overlapped_id_span").remove();
      }

      // document.getElementById("overlapped_id_area").remove(document.getElementById("overlapped_id"))
      // document.getElementById("overlapped_id_area").remove(document.getElementById("overlapped_id_span"))

      console.log("olverlapped response type:", typeof overlapped_id_list.OverlappedIDList, ", length:", overlapped_id_list.OverlappedIDList.length);

      if (typeof overlapped_id_list.OverlappedIDList !== 'undefined' &&
          overlapped_id_list.OverlappedIDList.length > 0) {

        // var txt1 = "<p>Text.</p>";               // Create element with HTML
        // var txt2 = $("<p></p>").text("Text.");   // Create with jQuery
        // var txt3 = document.createElement("p");  // Create with DOM
        // txt3.innerHTML = "Text.";
        // $("body").append(txt1, txt2, txt3);      // Append the new elements

        var span = document.createElement("span");
        span.id = "overlapped_id_span";
        span.innerHTML = "Overlapped Id:";
        document.getElementById("overlapped_id_area").append(span);

        // generate overlapped id select box
        var selectbox = document.createElement("select");
        selectbox.id = "overlapped_id";
        selectbox.style = "width:50px;margin-left: 5px;";
        for(var i = (overlapped_id_list.OverlappedIDList.length - 1); i >= 0 ; i--) {
          var opt = overlapped_id_list.OverlappedIDList[i];
          var el = document.createElement("option");
          el.textContent = opt;
          el.value = opt;
          selectbox.appendChild(el);
        }
        document.getElementById("overlapped_id_area").append(selectbox);

        getSelectedPlayer().overlappedId = document.getElementById("overlapped_id").value;

        document.getElementById("search_aitimeline").disabled = false;
      }

    })
    .catch(error => {
        if ((typeof index === 'number')) {
          console.error('Http Error: ' + HTTP_STATUS_CODES[error]);
        }

        // SunapiError extends RTSPOverWebSocketBaseError now — most-specific
        // first, generic base last via else-if (see the similar comment
        // above in initSunapiManager's catch).
        if(error instanceof SunapiError) {
          var strMessage = "<div><h4>getOverlappedIdList error: " + error.errorCode + "<br>message: " + error.message + "<br>URI: " + error.uri+ "</h4></div>";
          window.popup(strMessage);
        } else if(error instanceof RTSPOverWebSocketBaseError) {
          var strMessage = "<div><h4>getOverlappedIdList error: " + error.errorCode + "<br>message: " + error.message + "</h4></div>";
          window.popup(strMessage);
        }
    });

  } catch (error) {
    console.error(error);
  }
}

var search_date = function () {
  try {
    if(!getSelectedPlayer().sunapiClient) {
      initSunapiManager();
    }

    let startDate = document.getElementById("start_date").value;
    let startTime = document.getElementById("start_time").value;
    let endDate = document.getElementById("end_date").value;
    let endTime = document.getElementById("end_time").value;

    var strSearchStartTime = startDate + " " + startTime,
        strSearchEndTime = endDate + " " + endTime;

    if(document.getElementById("use_gmt").checked) {
      var timezone = gettimezonestring(document.getElementById("timezone").value);
      strSearchStartTime = moment(strSearchStartTime).utcOffset(timezone).format('YYYY-MM-DD[T]HH:mm:ss[Z]');
      strSearchEndTime = moment(strSearchEndTime).utcOffset(timezone).format('YYYY-MM-DD[T]HH:mm:ss[Z]');
    }

    // channel number start from index 0
    var requestPromise;
    if (getSelectedPlayer().device === 'camera') {
      if(Number(getSelectedPlayer().channel) !== null) {
        requestPromise = getSunapiManager().getCalendarSearch(strSearchStartTime, Number(getSelectedPlayer().channel) - 1);
      } else {
        requestPromise = getSunapiManager().getCalendarSearch(strSearchStartTime);
      }
    } else {
      requestPromise = getSunapiManager().getCalendarSearch(strSearchStartTime, Number(getSelectedPlayer().channel) - 1);
    }

    requestPromise.then(function (calendar: any) {
      console.log(fastJsonStringfy(calendar));
      for (var dates in calendar.CalenderSearchResults) {
        console.log("Channel: " + calendar.CalenderSearchResults[dates].Channel + ", Result: " + calendar.CalenderSearchResults[dates].Result);
        //calendarSearchCallback(calendar.CalenderSearchResults);
        if (calendar.CalenderSearchResults[dates].Result !== 'undefined') {
          var recordedDates = [];
          var record_dates: any[] = Array.from(calendar.CalenderSearchResults[dates].Result);

          for (var i = 0; i < record_dates.length; i++) {
            if (parseInt(record_dates[i]) === 1) {
              // add event dates from
              recordedDates.push(i + 1);
              //console.log(recordedDates);
            }
          }
          console.log(recordedDates, Math.min.apply(Math, recordedDates), Math.max.apply(Math, recordedDates));

          pad = function (val, len) {
            val = String(val);
            len = len || 2;
            while (val.length < len) val = "0" + val;
            return val;
          };

          // var temp = pad(new Date(document.getElementById("start_date").value).getFullYear(), 4);

          var year = pad(new Date(document.getElementById("start_date").value).getFullYear(), 4);
          var month = pad(new Date(document.getElementById("start_date").value).getMonth() + 1, 2);
          var day;
          var min, max;

          if(recordedDates.length < 1) {
            day = pad(new Date(document.getElementById("start_date").value).getDate(), 2);
          } else {
            day = pad(new Date(document.getElementById("start_date").value).getDate(), 2);
            max = pad(Math.max.apply(Math, recordedDates), 2);
            min = pad(Math.min.apply(Math, recordedDates), 2);
          }

          document.getElementById("start_date").value = [year, month, min].join('-');
          document.getElementById("end_date").value = [year, month, max].join('-');

          document.getElementById("start_date").min = [year, month, min].join('-');
          document.getElementById("start_date").max = [year, month, max].join('-');

          document.getElementById("end_date").min = [year, month, min].join('-');
          document.getElementById("end_date").max = [year, month, max].join('-');

          document.getElementById("search_timeline").disabled = false;
          document.getElementById("search_three_month_timeline").disabled = false;
        } // end if (calendar.CalenderSearchResults[dates].Result !== 'undefined') {
      } // end for (dates in calendar.CalenderSearchResults) {
    }).catch(function (error) {
      console.error("getTimeline error: ", fastJsonStringfy(error));
      // alert(fastJsonStringfy(error));
    });// end requestPromise.then(function (calendar) {
  } catch (error) {
    console.error(error);
  }
}

var search_oneday_timeline = function () {
  try {
    if(!getSelectedPlayer().sunapiClient) {
      initSunapiManager();
    }

    if (document.getElementById("timeline_picker") !== null){
      // do something here
      document.getElementById("timeline_picker").remove();
    }

    let startDate = document.getElementById("start_date").value;
    let startTime = document.getElementById("start_time").value;
    let endDate = document.getElementById("end_date").value;
    let endTime = document.getElementById("end_time").value;

    var strSearchStartTime = startDate + " " + startTime,
        strSearchEndTime = endDate + " " + endTime;

    if(document.getElementById("use_gmt").checked) {
      var timezone = gettimezonestring(document.getElementById("timezone").value);
      strSearchStartTime = moment(strSearchStartTime).utcOffset(timezone).format('YYYY-MM-DD[T]HH:mm:ss[Z]');
      strSearchEndTime = moment(strSearchEndTime).utcOffset(timezone).format('YYYY-MM-DD[T]HH:mm:ss[Z]');
    }
    console.log("onSearchOneDayTimeline, Search start:", strSearchStartTime, "end:", strSearchEndTime);

    // channel number start from index 0
    var requestPromise;
    if (getSelectedPlayer().device === 'camera') {
      if(Number(getSelectedPlayer().channel) !== null) {
        requestPromise = getSunapiManager().getTimeline(
          strSearchStartTime,
          strSearchEndTime,
          Number(getSelectedPlayer().channel) - 1,
          document.getElementById("overlapped_id") !== null ? document.getElementById("overlapped_id").value : undefined
        );
      } else {
        requestPromise = getSunapiManager().getTimeline(
          strSearchStartTime,
          strSearchEndTime,
          undefined,
          document.getElementById("overlapped_id") !== null ? document.getElementById("overlapped_id").value : undefined
        );
      }
    } else {
      var start = vis.moment(strSearchStartTime).utc().toISOString(); //format('YYYY-MM-DDTHH:mm:ss.SSSZ');
      var end = vis.moment(strSearchEndTime).utc().toISOString(); //format('YYYY-MM-DDTHH:mm:ss.SSSZ');
      requestPromise = getSunapiManager().getTimeline(
        strSearchStartTime,
        strSearchEndTime,
        Number(getSelectedPlayer().channel) - 1,
        document.getElementById("overlapped_id") !== null ? document.getElementById("overlapped_id").value : undefined
      );
    }
    requestPromise.then(function (timeline: any) {
      if (typeof timeline !== 'undefined') {
        console.log("Timeline: ", fastJsonStringfy(timeline.TimeLineSearchResults));
        updateTimeline(timeline.TimeLineSearchResults);
        document.getElementById("timeline").style.display = "block";
      } else {
        // alert("Error:", timeline.Error.Details);
        throw new Error((timeline as any).Error.Details);
      }
    }).catch(function (error) {
      if (Number.isInteger(error)) {
        console.error('' + HTTP_STATUS_CODES[Number(error)]);
        // alert(HTTP_STATUS_CODES[Number(error, 10)]);
      } else {
        console.error("getTimeline error: ", errorDetails(error), error);
        // alert("getTimeline error: " + fastJsonStringfy(error));
      }
    });
  } catch (error) {
    console.error(error);
  }
}

var checkEventSubGroup = function (element) {
  var rtn: any = {};
  switch(element.toLowerCase()) {
  case 'normal':
    rtn.value = 1;
    rtn.group = "Normal";
    // rtn.type = 'background';
    rtn.class = 'normal';
    break;
  case 'motiondetection':
    rtn.value = 2;
    // rtn.type = 'box';
    // rtn.type = 'background';
    rtn.group = "Event";
    rtn.subgroup = 'motiondetection';
    rtn.class = 'motiondetection';
    break;
  case 'audiodetection':
    rtn.value = 3;
    // rtn.type = 'background';
    rtn.group = "Event";
    rtn.subgroup = 'audiodetection';
    rtn.class = 'audiodetection';
    break;
  case 'facedetection':
    rtn.value = 4;
    // rtn.type = 'background';
    rtn.group = "Event";
    rtn.subgroup = 'facedetection';
    rtn.class = 'facedetection';
    break;
  case 'audioanalysis':
    rtn.value = 5;
    // rtn.type = 'background';
    rtn.group = "Event";
    rtn.subgroup = 'audioanalysis';
    rtn.class = 'audioanalysis';
    break;
  case 'videoanalysis':
    rtn.value = 6;
    // rtn.type = 'background';
    rtn.group = "Event";
    rtn.subgroup = 'videoanalysis';
    rtn.class = 'videoanalysis';
    break;
  case 'defocusdetection':
    rtn.value = 7;
    // rtn.type = 'background';
    rtn.group = "Event";
    rtn.subgroup = 'defocusdetection';
    rtn.class = 'defocusdetection';
    break;
  default:
    rtn.value = 8;
    // rtn.type = 'background';
    rtn.group = "Event";
    rtn.subgroup = 'unknown';
    rtn.class = 'unknown';
    break;
  }

  return rtn;
}

var checkAIEventSubGroup = function (element) {
  var rtn: any = {};
  switch(element.toLowerCase()) {
  case 'person':
    rtn.value = 1;
    rtn.group = "Event";
    // rtn.type = 'background';
    rtn.subgroup = 'person';
    rtn.class = 'ai';
    break;
  case 'face':
    rtn.value = 2;
    // rtn.type = 'box';
    // rtn.type = 'background';
    rtn.group = "Event";
    rtn.subgroup = 'face';
    rtn.class = 'ai';
    break;
  case 'facerecognition':
    rtn.value = 3;
    // rtn.type = 'background';
    rtn.group = "Event";
    rtn.subgroup = 'facerecognition';
    rtn.class = 'ai';
    break;
  case 'vehicle':
    rtn.value = 4;
    // rtn.type = 'background';
    rtn.group = "Event";
    rtn.subgroup = 'vehicle';
    rtn.class = 'ai';
    break;
  case 'licenseplate':
    rtn.value = 5;
    // rtn.type = 'background';
    rtn.group = "Event";
    rtn.subgroup = 'licenseplate';
    rtn.class = 'ai';
    break;
  default:
    rtn.value = 8;
    // rtn.type = 'background';
    rtn.group = "Event";
    rtn.subgroup = 'unknown';
    rtn.class = 'unknown';
    break;
  }

  return rtn;
}

var updateTimeline = function (results) {
  if(results.length > 0 && results[0].Results.length > 0) {

    // reference from https://github.com/visjs/vis-timeline
    // https://visjs.github.io/vis-timeline/examples/timeline/
    // DOM element where the Timeline will be attached
    document.getElementById('timeline').innerHTML = "";
    var container = document.getElementById('timeline');
    var startTime, endTime;

    // if(typeof element.GMT !== 'undefined' &&
    // element.GMT !== null) {
    //   startTime = new Date(new Date().setHours(0,0,0,0).valueOf() - ((element.GMT * 60) * 60000));
    //   endtTime = new Date(new Date().setHours(23,59,59,999).valueOf() - ((element.GMT * 60) * 60000));
    // } else {
    //   startTime = new Date().setHours(0,0,0,0);
    //   endtTime = new Date().setHours(23,59,59,999);
    // }
    // https://motocal.com/
    // http://jsfiddle.net/api/post/library/pure/
    var groups = new vis.DataSet([
      {
        content: "Normal",
        id: "Normal",
        // value: 1,
      },
      {
        content: "Event",
        id: "Event",
        value: 2,
        subgroupVisibility: {
          motiondetection: true,
          audiodetection: true,
          facedetection: true,
          audioanalysis: true,
          videoanalysis: true,
          defocusdetection: true,
          unknown: true
        }
      },
      // { content: "MotionDetection", id: "AudioDetection", value: 3},
      // { content: "AudioDetection", id: "AudioDetection", value: 3},
      // { content: "FaceDetection", id: "FaceDetection", value: 4},
      // { content: "AudioAnalysis", id: "AudioAnalysis", value: 5},
      // { content: "DefocusDetection", id: "DefocusDetection", value: 6},
      // { content: "Unknown", id: "Unknown", value: 7}
    ]);

    // Configuration for the Timeline
    var options = {
      moment: function (date) {
        // https://github.com/almende/vis/issues/24
        if(!document.getElementById("use_gmt").checked) {
          var timezone = gettimezonestring(document.getElementById("timezone").value);
          return vis.moment(date).utcOffset(timezone);
        } else {
          return vis.moment(date).utcOffset(tz);;
        }
      },
      // template: function (item) {
      //   var template = templates[item.template]; // choose the right template
      //   return template(item); // execute the template
      // },
      // option groupOrder can be a property name or a sort function
      // the sort function must compare two groups and return a value
      //     > 0 when a > b
      //     < 0 when a < b
      //       0 when a == b
      groupOrder: function(a, b) {
        return a.value - b.value;
      },
      groupOrderSwap: function(a, b, groups) {
        var v = a.value;
        a.value = b.value;
        b.value = v;
      },
      groupTemplate: function(group) {
        var container = document.createElement("div");
        var label = document.createElement("span");
        label.innerHTML = group.content + " ";
        label.style.fontSize = "3px";
        container.insertAdjacentElement("afterBegin" as any, label);
        var hide = document.createElement("button");
        hide.innerHTML = "hide";
        hide.style.height = "10px";
        hide.style.fontSize = "3px";
        hide.addEventListener("click", function() {
          groups.update({ id: group.id, visible: false });
        });
        container.insertAdjacentElement("beforeEnd" as any, hide);
        return container;
      },
      orientation: "bottom", // bottom, top, both, none
      editable: {
        // add: true,         // add new items by double tapping
        // updateTime: true,  // drag items horizontally
        // updateGroup: true, // drag items from one group to another
        // remove: true,       // delete an item by tapping the delete button top right
        overrideItems: true  // allow these options to override item.editable
      },
      groupEditable: true,
      showCurrentTime: true,
      selectable: true,
      multiselect: true,
      showTooltips: true,
      stack: false,
      stackSubgroups: false,
      margin: { item: 1, axis: 1 },
      // padding: "1px",
      start: new Date().setHours(0,0,0,0),
      end: new Date().setHours(23,59,59,999),
      // height: "100px",
      maxHeight: "100px",
      showMajorLabels: false,
      showMinorLabels: true,
    };
    var items = new vis.DataSet(options);

    results[0].Results.forEach(function(timeline_element) {
      var start, end;
      try {
        start = new Date(timeline_element.StartTime);
        end = new Date(timeline_element.EndTime);

        var type = checkEventSubGroup(timeline_element.Type);
        var data: any = {
          id: timeline_element.Result,
          content: timeline_element.Type,
          start: start,
          end: end,
          group: type.group,
        }

        if(typeof type.type !== 'undefined' && type.type !== null)  {
          data.type = type.type;
        }

        if(typeof type.subgroup !== 'undefined' && type.subgroup !== null)  {
          data.subgroup = type.subgroup;
        }

        if(typeof type.class !== 'undefined' && type.class !== null)  {
          data.className = type.class;
        }

        items.add(data);
      } catch(error) {
        console.error(error);
      }
    });

    // // Create a DataSet (allows two way data-binding)
    // var items = new vis.DataSet([
    //   {id: 1, content: 'item 1', start: '2014-04-20'},
    //   {id: 2, content: 'item 2', start: '2014-04-14'},
    //   {id: 3, content: 'item 3', start: '2014-04-18'},
    //   {id: 4, content: 'item 4', start: '2014-04-16', end: '2014-04-19'},
    //   {id: 5, content: 'item 5', start: '2014-04-25'},
    //   {id: 6, content: 'item 6', start: '2014-04-27', type: 'point'}
    // ]);

    // Create a Timeline
    //var timeline = new vis.Timeline(container, items, options);
    visTimeline = new vis.Timeline(container);
    visTimeline.setOptions(options);
    visTimeline.setGroups(groups);
    visTimeline.setItems(items);

    var itemMin = visTimeline.getItemRange().min;

    var customTime, today;
    if(!document.getElementById("use_gmt").checked) {
      // #usegmttime has no corresponding element in window.html — same
      // pre-existing dead reference as on_player_select()'s guarded use
      // of it (see MEMORY.md's #broadcast/#usegmttime entry). Unguarded
      // here, this threw `Cannot read properties of null (reading
      // 'value')` on every call, aborting updateTimeline() before it
      // ever reached visTimeline.on("click"/"select", ...) below — the
      // timeline still rendered (setItems() above already ran) but no
      // click ever did anything, and the exception surfaced two levels
      // up as an opaque "getTimeline error: {}" (see errorDetails()).
      // Guarded the same way, falling back to the item range's own local
      // time (no custom offset) rather than deciding whether this field
      // should actually exist.
      var usegmttimeEl = document.querySelector('select[id="usegmttime"]');
      if (usegmttimeEl !== null) {
        var temp = "";
        console.log("" + parseFloat(usegmttimeEl.value),
                    "type:", typeof parseFloat(usegmttimeEl.value),
                    "pad:", parseFloat(usegmttimeEl.value).pad(2));
        temp += (usegmttimeEl.value > 0) ? "+" : "";
        temp += parseFloat(usegmttimeEl.value).pad(2) + ":00";
        today = vis.moment(itemMin).utcOffset(temp);
      } else {
        today = vis.moment(itemMin);
      }
    } else {
      today = vis.moment(itemMin).utc();
    }

    visTimeline.addCustomTime(today);

    visTimeline.on("click", function(properties) {
      console.log('[timeline click] fired', properties);
      visTimeline.setSelection(properties.item);
      // var index = visTimeline.getSelection();
      // alert('selected items: ' + fastJsonStringfy(properties));

      // if(element.readyState === RTSPOverWebSocketPlayState.PLAYING) {
      //   if(document.querySelector('input[id="usegmt_checkbox"]').checked) {
      //     // var temp = "";
      //     // temp += (document.querySelector('select[id="usegmttime"]').value > 0) ? "+" : "";
      //     // temp += pad(document.querySelector('select[id="usegmttime"]').value, 2) + ":00";
      //     element.seekingTime = new Date(properties.time).toISOString();
      //   } else if(element.device === 'camera' && document.querySelector('input[id="usegmt_checkbox"]').checked) {
      //     // var temp = "";
      //     // temp += (document.querySelector('select[id="usegmttime"]').value > 0) ? "+" : "";
      //     // temp += pad(document.querySelector('select[id="usegmttime"]').value, 2) + ":00";
      //     // element.seekingTime = vis.moment(properties.time).utcOffset(temp).toISOString();
      //     element.seekingTime = new Date(properties.time).toISOString();
      //   } else {
      //     element.seekingTime = properties.time.toISOString();
      //     // element.seekingTime = vis.moment(properties.time).utc().toISOString();
      //   }
      // }
      // var item = items.get(properties);
      // alert('selected items: ' + fastJsonStringfy(item));
    });

    visTimeline.on("doubleClick", function(properties) {
      visTimeline.setSelection(properties.item);
      // var index = visTimeline.getSelection();
      // alert('selected items: ' + fastJsonStringfy(properties));

      if(getSelectedPlayer().readyState === RTSPOverWebSocketPlayState.PLAYING) {
        if (!document.getElementById("use_gmt").checked) {
          if(getSelectedPlayer().device === 'camera') {
            getSelectedPlayer().seekingTime = moment(properties.time).utcOffset(tz).format('YYYY-MM-DD[T]HH:mm:ss') + 'Z';
          } else {
            getSelectedPlayer().seekingTime = item[0].start.toISOString();
          }
        } else if(document.getElementById("use_gmt").checked) {
          // var temp = "";
          // temp += (document.querySelector('select[id="usegmttime"]').value > 0) ? "+" : "";
          // temp += pad(document.querySelector('select[id="usegmttime"]').value, 2) + ":00";
          // element.seekingTime = vis.moment(properties.time).utcOffset(temp).toISOString();
          getSelectedPlayer().seekingTime = new Date(properties.time).toISOString();
        }
        //  else {
        //   getSelectedPlayer().seekingTime = properties.time.toISOString();
        //   // element.seekingTime = vis.moment(properties.time).utc().toISOString();
        // }
      }
      // var item = items.get(properties);
      // alert('selected items: ' + fastJsonStringfy(item));
    });

    visTimeline.on('hoverNode', function (e) {
      console.log('hover nodes:', fastJsonStringfy(event));
    });

    // timeline.on('currentTimeTick', function () {
    //   console.log('currentTimeTick')
    // });

    // vid timeline select event
    visTimeline.on('select', function (properties) {
     try {
      console.log('[timeline select] fired', properties, 'readyState:', getSelectedPlayer().readyState);
      if(getSelectedPlayer().readyState === RTSPOverWebSocketPlayState.PLAYING) {
        console.log('[timeline select] skipped: player is PLAYING');
        return;
      }

      var item = items.get(properties.items);
      console.log('[timeline select] item count:', item.length, item);

      if(item.length > 0) {

        var group = (groups.get(item[0].group)).id;
        console.log("data", fastJsonStringfy(item));

        var startDateControl = document.querySelector('input[id="start_date"]');
        var startTimeControl = document.querySelector('input[id="start_time"]');
        var endDateControl = document.querySelector('input[id="end_date"]');
        var endTimeControl = document.querySelector('input[id="end_time"]');

        console.log('[timeline select] controls:', { startDateControl, startTimeControl, endDateControl, endTimeControl, start: item[0].start, end: item[0].end });

        // set start/end time to rtsp-over-websocket
        if (typeof startDateControl !== 'undefined' &&
        typeof startTimeControl !== 'undefined' &&
        typeof endDateControl !== 'undefined' &&
        typeof endTimeControl !== 'undefined' &&
        startDateControl !== null &&
        startTimeControl !== null &&
        endDateControl !== null &&
        endTimeControl !== null &&
        typeof item[0].start !== 'undefined' &&
        typeof item[0].end !== 'undefined' &&
        item[0].start !== null &&
        item[0].end !== null) {
          if(typeof item[0].start === 'string' && typeof item[0].end === 'string') {
            if(!document.getElementById("use_gmt").checked) {
              var timezone = getSelectedPlayer().GMT * 3600 * 1000;
              startDateControl.value = new Date(new Date(item[0].start)).toISOString().split('T')[0];
              startTimeControl.value = new Date(new Date(item[0].start)).toISOString().split('T')[1].replace(/Z/gi, "");
              getSelectedPlayer().startTime = new Date(new Date(item[0].start).getTime() + timezone).toISOString();

              if(group.toLowerCase() !== 'normal') {
                endDateControl.value = new Date(new Date(item[0].end)).toISOString().split('T')[0];
                endTimeControl.value = new Date(new Date(item[0].end)).toISOString().split('T')[1].replace(/Z/gi, "");
                getSelectedPlayer().endTime = new Date(new Date(item[0].end).getTime() + timezone).toISOString();

                endDateControl.disabled = false;
                endTimeControl.disabled = false;
              } else {
                getSelectedPlayer().endTime = null;
                endDateControl.disabled = true;
                endTimeControl.disabled = true;
              }
            } else {
              startDateControl.value = new Date(item[0].start).toISOString().split('T')[0];
              startTimeControl.value = new Date(item[0].start).toISOString().split('T')[1].replace(/Z/gi, "");
              getSelectedPlayer().startTime = new Date(item[0].start).toISOString();

              if(group.toLowerCase() !== 'normal') {
                endDateControl.value = new Date(item[0].end).toISOString().split('T')[0];
                endTimeControl.value = new Date(item[0].end).toISOString().split('T')[1].replace(/Z/gi, "");
                getSelectedPlayer().endTime = new Date(item[0].end).toISOString();

                endDateControl.disabled = false;
                endTimeControl.disabled = false;
              } else {
                getSelectedPlayer().endTime = null;
                endDateControl.disabled = true;
                endTimeControl.disabled = true;
              }
            }
          } else {
            if(!document.getElementById("use_gmt").checked) {
              if(getSelectedPlayer().device === 'camera') {
                getSelectedPlayer().startTime = moment(item[0].start).utcOffset(tz).format('YYYY-MM-DD[T]HH:mm:ss') + 'Z';
              } else {
                getSelectedPlayer().startTime = item[0].start.toISOString();
              }

              if(group.toLowerCase() !== 'normal') {
                if(getSelectedPlayer().device === 'camera') {
                  getSelectedPlayer().endTime = moment(item[0].end).utcOffset(tz).format('YYYY-MM-DD[T]HH:mm:ss') + 'Z';
                } else {
                  getSelectedPlayer().endTime = item[0].end.toISOString();
                }
              } else {
                getSelectedPlayer().endTime = null;
                endDateControl.disabled = true;
                endTimeControl.disabled = true;
              }

              startDateControl.value = getSelectedPlayer().startTime.split('T')[0];
              startTimeControl.value = getSelectedPlayer().startTime.split('T')[1].replace(/Z/gi, "");

              if(getSelectedPlayer().endTime !== null) {
                endDateControl.value = getSelectedPlayer().endTime.split('T')[0];
                endTimeControl.value = getSelectedPlayer().endTime.split('T')[1].replace(/Z/gi, "");
              }
            } else {
              if(getSelectedPlayer().device === 'camera') {
                getSelectedPlayer().startTime = moment(item[0].start).utcOffset(tz).format('YYYY-MM-DD[T]HH:mm:ss') + 'Z';
              } else {
                getSelectedPlayer().startTime = item[0].start.toISOString();
              }

              if(group.toLowerCase() !== 'normal') {
                if(getSelectedPlayer().device === 'camera') {
                  getSelectedPlayer().endTime = moment(item[0].end).utcOffset(tz).format('YYYY-MM-DD[T]HH:mm:ss') + 'Z';
                } else {
                  getSelectedPlayer().endTime = item[0].end.toISOString();
                }
              } else {
                getSelectedPlayer().endTime = null;
                endDateControl.disabled = true;
                endTimeControl.disabled = true;
              }

              startDateControl.value = getSelectedPlayer().startTime.split('T')[0];
              startTimeControl.value = getSelectedPlayer().startTime.split('T')[1].replace(/Z/gi, "");

              if(getSelectedPlayer().endTime !== null) {
                endDateControl.value = getSelectedPlayer().endTime.split('T')[0];
                endTimeControl.value = getSelectedPlayer().endTime.split('T')[1].replace(/Z/gi, "");
              }
            }
          }

        }
      }
     } catch (error) {
       // Was previously unguarded — an exception here (e.g. the
       // <rtsp-over-websocket> element's startTime/endTime setter
       // rejecting an unexpected format) silently aborted the rest of
       // this handler with only a browser "Uncaught" console entry,
       // which could leave startTime never actually set on the element
       // even though the UI's start_date/start_time fields looked
       // populated from lines earlier in this same handler that did run
       // — see the "start time is empty" (0x0411) report this was found
       // from. Logged the same way every other handler in this file
       // reports its own errors, so this is now visible via
       // console.error instead of vanishing.
       console.error("timeline select error:", error);
     }
    });
  } else {
    window.popup("Result is empty" + fastJsonStringfy(results));
  }
}

var onchangemute = function(mute) {
  changedebug("onchangemute: " + fastJsonStringfy(mute.detail));

  try {
    if(!mute.detail.status) {
      document.getElementById("unmute").disabled = true;
      document.getElementById("mute").disabled = false;
      document.getElementById("volume").disabled = false;
      document.getElementById("getaudiovolume").disabled = false;
      document.getElementById("talk").disabled = false;
    } else {
      document.getElementById("unmute").disabled = false;
      document.getElementById("mute").disabled = true;
      document.getElementById("volume").disabled = true;
      document.getElementById("getaudiovolume").disabled = true;
      document.getElementById("talk").disabled = true;
    }

    if (typeof(getSelectedPlayer().volume) !== 'undefined' ||
        getSelectedPlayer().volume == null ||
        getSelectedPlayer().volume == '') {
      document.getElementById("volume").value = getSelectedPlayer().volume;
      document.getElementById("getaudiovolume").value = getSelectedPlayer().volume;
    }
  } catch (error) {
    console.log(error);
  }
}

var unmute = function () {
  try {
    if (getSelectedPlayer().ismute === true &&
        getSelectedPlayer().isplay) {
      getSelectedPlayer().unmute();
    }
  } catch (error) {
    console.error(error);
  }
}

var mute = function () {
  try {
    if (getSelectedPlayer().ismute === false &&
        getSelectedPlayer().isplay) {
      getSelectedPlayer().mute();
    }
  } catch (error) {
    console.error(error);
  }
}

var setvolume = function () {
  try {
    if (getSelectedPlayer().ismute === false &&
        getSelectedPlayer().isplay) {
      getSelectedPlayer().volume = document.getElementById("volume").value;
    }
  } catch (error) {
    console.error(error);
  }
}

var onchangevolume = function(volume) {
  changedebug("onchangevolume: " + fastJsonStringfy(volume.detail));

  try {
    document.getElementById("getaudiovolume").value = volume.detail.volume;
    document.getElementById("volume").value = volume.detail.volume;
  } catch (error) {
    console.error(error);
  }
}

// reference from
// https://blog.naver.com/PostView.naver?blogId=minhyupp&logNo=222371221571&from=search&redirect=Log&widgetTypeCall=true&directAccess=false
var changedarkmode = function(e) {
  console.log(e.target.checked);
  const isDark = e.target.checked;

  const themeIcon = document.querySelector(".theme-icon img");
  const themeText = document.querySelector(".theme-icon em");
  // window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
  //   const newColorScheme = e.matches ? "dark" : "light";
  // });

//   if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
//     // dark mode
// }
  if (isDark) {
    // 다크모드
    window.matchMedia('(prefers-color-scheme: dark)');
    document.documentElement.setAttribute("data-theme", "dark");

    themeIcon.src = "https://img.icons8.com/emoji/32/000000/crescent-moon-emoji.png";
    themeText.innerText = "Dark Mode";
  } else {
    // light 모드
    window.matchMedia('(prefers-color-scheme: light)');
    document.documentElement.setAttribute("data-theme", "light");
    themeIcon.src = "https://img.icons8.com/offices/32/ffffff/sun.png";
    themeText.innerText = "Light Mode";
  }
}

var onchangeandroid = function() {
  getSelectedPlayer().android = document.getElementById("is_android").checked;
}

var oncleardebug = function() {
  // document.getElementById("debug").value = "";
  document.getElementById("debug").value = "";
  scrollbottom();
}

var onchangeusedebug = function () {
  _useDebug = document.getElementById("use_debug").checked;
}

var onWaiting = function (waiting) {
  changedebug("onwaiting: " + fastJsonStringfy(waiting.detail));
}

var changedebug = function(data) {
  if(_useDebug) {
    var str = document.getElementById("debug").value;
    str += data + "\r\n";
    document.getElementById("debug").value = str;
    scrollbottom();
  }
}

var onrtsp = function (rtsp) {
    changertsp("RTSP: " + rtsp.detail.message);
}

var changertsp = function(data) {
    var str = document.getElementById("rtsp").value;
    str += data + "\r\n";
    document.getElementById("rtsp").value = str;
    scrollbottomrtsp();
}

var initModal = function () {
  // Get the modal
  // document.getElementById("myModal").click(function(){

  // });
  document.querySelectorAll(".close-popup").forEach(function (el) {
    el.addEventListener("click", function(){
      document.getElementById("myModal").style.display = "none";
      document.getElementById("myCapture").style.display = "none";
    });
  });
  // $( ".message" );
  // modalElement = document.getElementById("myModal");
  // // Get the <span> element that closes the modal
  // span = document.getElementsByClassName("close-popup")[0];
  // // Get the <p> element that message the modal
  // messageElement = document.getElementsByClassName("message")[0];

  // When the user clicks on <span> (x), close the modal
  // span.onclick = function () {
  //   modalElement.style.display = "none";
  // }

  // When the user clicks anywhere outside of the modal, close it
  // window.onclick = function (event) {
  //   if (event.target == modalElement) {
  //     modalElement.style.display = "none";
  //   }
  // }

  window.popup = function (message) {
    document.querySelectorAll(".message").forEach(function (el) { el.innerHTML = message; });
    document.getElementById("myModal").style.display = "block";
    // messageElement.innerHTML = message;
    // modalElement.style.display = "block";
  }

  window.capture = function () {
    // $(".message").html(message);
    document.getElementById("myCapture").style.display = "block";
    // messageElement.innerHTML = message;
    // modalElement.style.display = "block";
  }
}

var scrollbottom = function () {
  var psconsole = document.getElementById("debug");
  if(psconsole !== null)
    psconsole.scrollTop = psconsole.scrollHeight - psconsole.clientHeight;
}

var scrollbottomrtsp = function () {
    var psrtsp = document.getElementById("rtsp");
    if(psrtsp !== null)
    psrtsp.scrollTop = psrtsp.scrollHeight - psrtsp.clientHeight;
}