// Discovery result panel (table + Star Topology) -- SRS FR-2. Satisfies
// docs/star-topology/'s SRS too (grouping/search-drilldown behavior),
// reimplemented fresh here rather than copied -- see docs/window-ui/DESIGN.md.

import * as vis from 'vis';
import { state, TOPOLOGY_GROUP_COLORS, TOPOLOGY_GROUP_COLUMN } from './state';
import { onPlayerSelect } from './session';

declare var IS_EXTENSION: boolean;
declare var chrome: any;

// ---------------------------------------------------------------------
// FR-2.5: device selection, shared by the table row click and topology
// leaf-node click handlers.
// ---------------------------------------------------------------------
export function applyDiscoveredDeviceSelection(row_data: string[]): void {
  const player = state.getSelectedPlayer();
  if (player.isplay) {
    player.stop();
  }

  const sunapiCheckbox = document.getElementById('use_sunapi_client_checkbox') as HTMLInputElement;
  if (sunapiCheckbox.checked === true) {
    sunapiCheckbox.checked = false;
    player.sunapiClient = null;
  }
  const isAndroidCheckbox = document.getElementById('is_android') as HTMLInputElement;
  if (isAndroidCheckbox.checked === true) {
    player.android = false;
    isAndroidCheckbox.checked = false;
  }

  (document.getElementById('hostname') as HTMLInputElement).value = row_data[1];
  player.hostname = row_data[1];
  // In the extension, the selected device's own advertised port
  // (row_data[3]) is the default -- unchanged. Outside it, FR-4.10 locks
  // the connection scheme to document.location.protocol, so the port
  // needs the same lock: default to 80/443 for that locked scheme instead
  // of whatever port the device itself advertises (a device on a
  // non-standard HTTPS port would otherwise leave `player.port` set to
  // that port while the scheme is forced to HTTP, or vice versa).
  // Requested directly by the user.
  const lockedPort = !IS_EXTENSION ? (document.location.protocol === 'https:' ? '443' : '80') : row_data[3];
  (document.getElementById('port') as HTMLInputElement).value = lockedPort;
  player.port = lockedPort;

  // row_data[5] is the discovered device's Protocol ("http"/"https"). Set
  // directly (not via .click()) so changehttptype()'s 80/443 default-port
  // side effect doesn't immediately overwrite the real discovered port set
  // just above.
  //
  // Outside the extension, device.ts's setupDevice() locks (and disables)
  // these same two radios to document.location.protocol -- `disabled`
  // only blocks user clicks, not a scripted `.checked` assignment, so
  // without this guard selecting any discovered device silently flipped
  // the "locked" toggle to whatever that device happened to advertise,
  // defeating the lock (and looking like it was backwards, since a device
  // advertising the opposite scheme from the page's own would flip it the
  // instant a row was clicked). Reported directly by the user.
  const isHttps = row_data[5] === 'https';
  if (IS_EXTENSION) {
    (document.getElementById('https_radio') as HTMLInputElement).checked = isHttps;
    (document.getElementById('http_radio') as HTMLInputElement).checked = !isHttps;
  }
  (document.getElementById('use_native_tls_proxy_checkbox') as HTMLInputElement).checked = isHttps;

  (document.getElementById('webviewer') as any).src = row_data[4];
  (document.getElementById('web') as HTMLButtonElement).disabled = false;
}

// ---------------------------------------------------------------------
// FR-2.4: adding a discovered device.
// ---------------------------------------------------------------------
export function addDiscoveredDeviceRow(data: any): void {
  const pk = data.IPAddress;
  const exists = state.dataSet.some((row) => row[1] === pk);
  if (!exists) {
    state.dataSet.push([data.DeviceName, data.IPAddress, data.MACAddress, data.Port, data.URL, data.Protocol]);
    renderDiscoveryTable();
    if (state.discoveryViewType === 'topology') renderDiscoveryTopology();
  }
}

// ---------------------------------------------------------------------
// FR-2.2: table sort/render.
// ---------------------------------------------------------------------
export function renderDiscoveryTable(): void {
  let filtered = state.dataSet.filter((row) => {
    if (state.discoverySearchText === '') return true;
    return row.some((cell) => String(cell).toLowerCase().indexOf(state.discoverySearchText) !== -1);
  });

  const col = state.discoverySortColumn;
  const dir = state.discoverySortAscending ? 1 : -1;
  filtered = filtered.slice().sort((a, b) => String(a[col]).localeCompare(String(b[col]), undefined, { numeric: true }) * dir);

  const tbody = document.querySelector('#datatable tbody')!;
  tbody.replaceChildren();
  filtered.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.className = index % 2 === 1 ? 'odd' : 'even';
    row.forEach((cell) => {
      const td = document.createElement('td');
      td.textContent = cell;
      tr.append(td);
    });
    tbody.append(tr);
  });

  const infoElement = document.getElementById('datatable_info')!;
  if (filtered.length === 0) {
    infoElement.textContent = 'Showing 0 to 0 of 0 entries';
  } else {
    infoElement.textContent =
      'Showing 1 to ' + filtered.length + ' of ' + filtered.length + ' entries' +
      (filtered.length !== state.dataSet.length ? ' (filtered from ' + state.dataSet.length + ' total entries)' : '');
  }
}

function updateDiscoverySortIndicator(): void {
  document.querySelectorAll('#datatable thead th').forEach((th) => {
    th.classList.remove('sort-asc', 'sort-desc');
  });
  const activeHeader = document.querySelector('#datatable thead th[data-column="' + state.discoverySortColumn + '"]');
  if (activeHeader !== null) {
    activeHeader.classList.add(state.discoverySortAscending ? 'sort-asc' : 'sort-desc');
  }
}

// ---------------------------------------------------------------------
// FR-2.3: Star Topology.
// ---------------------------------------------------------------------
function getTopologyGroupKey(row: string[], groupBy: string): string {
  const column = TOPOLOGY_GROUP_COLUMN.hasOwnProperty(groupBy) ? TOPOLOGY_GROUP_COLUMN[groupBy] : 1;
  const value = String(row[column]);
  if (groupBy === 'ip') {
    const ipParts = value.split('.');
    return ipParts.length >= 3 ? ipParts.slice(0, 3).join('.') : value;
  }
  if (groupBy === 'mac') {
    const macParts = value.split(':');
    return macParts.length >= 3 ? macParts.slice(0, 3).join(':') : value;
  }
  if (groupBy === 'name') {
    const dashIndex = value.indexOf('-');
    return dashIndex > 0 ? value.substring(0, dashIndex) : value;
  }
  return value;
}

function getTopologyHubLabel(key: string, groupBy: string): string {
  if (groupBy === 'ip') {
    const octetCount = key.split('.').length;
    if (octetCount === 1) return key + '.0.0.0/8';
    if (octetCount === 2) return key + '.0.0/16';
    return key + '.0/24';
  }
  if (groupBy === 'mac') return key + ' (OUI)';
  if (groupBy === 'port') return 'Port ' + key;
  return key;
}

// ip-only: a /24 group key ("a.b.c") implies real subnet containment in its
// /16 ("a.b") and /8 ("a") ancestors -- unlike every other groupBy's hub,
// which stays a single, unlinked node, these ARE linked hub-to-hub because
// /24 ⊂ /16 ⊂ /8 is a real relationship read off the IP itself, not an
// arbitrary grouping choice. See docs/star-topology/DESIGN.md.
function getIpHubChain(key: string): string[] {
  const octets = key.split('.');
  const chain: string[] = [];
  for (let i = 1; i <= octets.length; i++) {
    chain.push(octets.slice(0, i).join('.'));
  }
  return chain; // "192.168.214" -> ["192", "192.168", "192.168.214"]
}

export function renderDiscoveryTopology(): void {
  const container = document.getElementById('datatable_topology');
  if (container === null) return;

  const groupIndex: { [key: string]: number } = {};
  let groupCount = 0;
  const hubSeen: { [nodeId: string]: boolean } = {};
  const nodes: any[] = [];
  const edges: any[] = [];

  state.dataSet.forEach((row) => {
    if (
      state.discoverySearchText !== '' &&
      !row.some((cell) => String(cell).toLowerCase().indexOf(state.discoverySearchText) !== -1)
    ) {
      return;
    }

    const name = row[0];
    const ip = row[1];
    const groupKey = getTopologyGroupKey(row, state.discoveryTopologyGroupBy);
    const isIp = state.discoveryTopologyGroupBy === 'ip';
    // For ip, color cycles by /8 root (colorKey), not by /24 leaf hub, so an
    // entire subnet-containment chain (getIpHubChain) reads as one visual
    // branch -- pre-hierarchy this used to be a new color per /24.
    const colorKey = isIp ? groupKey.split('.')[0] : groupKey;

    if (!(colorKey in groupIndex)) {
      groupIndex[colorKey] = groupCount++;
    }
    const colors = TOPOLOGY_GROUP_COLORS[groupIndex[colorKey] % TOPOLOGY_GROUP_COLORS.length];

    const hubChain = isIp ? getIpHubChain(groupKey) : [groupKey];
    hubChain.forEach((hubKey, i) => {
      const hubId = 'hub:' + hubKey;
      if (hubSeen[hubId]) return;
      hubSeen[hubId] = true;
      nodes.push({
        id: hubId,
        label: getTopologyHubLabel(hubKey, state.discoveryTopologyGroupBy),
        shape: 'dot',
        size: 16,
        color: colors.hub,
        font: { color: '#ffffff' },
      });
      if (i > 0) {
        edges.push({ from: 'hub:' + hubChain[i - 1], to: hubId, color: { color: '#888888' } });
      }
    });

    nodes.push({
      id: ip,
      label: name || ip,
      title: ip,
      shape: 'dot',
      size: 10,
      color: colors.leaf,
      font: { color: '#ffffff' },
    });
    edges.push({ from: 'hub:' + groupKey, to: ip, color: { color: '#888888' } });
  });

  const data = { nodes: new (vis as any).DataSet(nodes), edges: new (vis as any).DataSet(edges) };
  const options = {
    physics: { barnesHut: { springLength: 90 }, stabilization: { iterations: 150, fit: false } },
    interaction: { hover: true },
    layout: { improvedLayout: false },
  };

  if (state.visNetwork !== null) {
    state.visNetwork.destroy();
    state.visNetwork = null;
  }

  state.visNetwork = new (vis as any).Network(container, data, options);
  state.visNetwork.on('click', (params: any) => {
    if (params.nodes.length === 0) return;
    let nodeId = state.visNetwork.getNodeAt(params.pointer.DOM);
    if (nodeId === undefined || nodeId === null) return;
    nodeId = String(nodeId);
    if (nodeId.indexOf('hub:') === 0) return;
    const row = state.dataSet.find((r) => r[1] === nodeId);
    if (row) applyDiscoveredDeviceSelection(row);
  });
  state.visNetwork.on('stabilizationIterationsDone', () => {
    state.visNetwork.stopSimulation();
    state.visNetwork.setOptions({ physics: { enabled: false } });
    state.visNetwork.fit({ animation: { duration: 300, easingFunction: 'easeInOutQuad' } });
  });
}

export function setDiscoveryViewType(viewType: string): void {
  state.discoveryViewType = viewType as 'table' | 'topology';
  const tableScroll = document.querySelector('.datatable-scroll') as HTMLElement;
  const topologyContainer = document.getElementById('datatable_topology') as HTMLElement;
  const infoElement = document.getElementById('datatable_info') as HTMLElement;
  const groupByWrap = document.getElementById('discovery_topology_group_by_wrap') as HTMLElement;
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

// ---------------------------------------------------------------------
// Setup -- registers everything above, plus #web toggle, table sort
// headers, search box, and the discover/known-devices event sources
// (FR-2.4). The #drag divider (FR-2.6) is set up separately by
// dynamicLayout.ts's setupSplitLayout(), not here -- it moved from a
// simple horizontal-only resize into an orientation-aware row/column
// split, a broader layout concern than this module's own scope.
// ---------------------------------------------------------------------
export function setupDiscovery(): void {
  document.querySelectorAll('#datatable thead th').forEach((th) => {
    th.addEventListener('click', () => {
      const column = Number((th as HTMLElement).dataset.column);
      if (state.discoverySortColumn === column) {
        state.discoverySortAscending = !state.discoverySortAscending;
      } else {
        state.discoverySortColumn = column;
        state.discoverySortAscending = true;
      }
      updateDiscoverySortIndicator();
      renderDiscoveryTable();
    });
  });
  updateDiscoverySortIndicator();
  renderDiscoveryTable();

  document.getElementById('datatable_search')!.addEventListener('input', function (this: HTMLInputElement) {
    state.discoverySearchText = this.value.trim().toLowerCase();
    renderDiscoveryTable();
    if (state.discoveryViewType === 'topology') renderDiscoveryTopology();
  });

  document.getElementById('discovery_view_type')!.addEventListener('change', function (this: HTMLSelectElement) {
    setDiscoveryViewType(this.value);
  });

  document.getElementById('discovery_topology_group_by')!.addEventListener('change', function (this: HTMLSelectElement) {
    state.discoveryTopologyGroupBy = this.value;
    renderDiscoveryTopology();
  });

  document.getElementById('web')!.addEventListener('click', () => {
    const webdiv = document.getElementById('webdiv') as HTMLElement;
    if (webdiv.style.display === 'none' || webdiv.style.visibility === 'hidden') {
      webdiv.style.display = 'block';
    } else {
      webdiv.style.display = 'none';
    }
  });

  document.querySelector('#datatable tbody')!.addEventListener('click', (event) => {
    const tr = (event.target as HTMLElement).closest('tr');
    if (tr === null) return;

    if (tr.classList.contains('selected')) {
      tr.classList.remove('selected');
      (document.getElementById('web') as HTMLButtonElement).disabled = true;
    } else {
      document.querySelectorAll('#datatable tbody tr.selected').forEach((selectedRow) => {
        selectedRow.classList.remove('selected');
      });
      tr.classList.add('selected');

      const cells = tr.querySelectorAll('td');
      const row_data = [
        cells[0].textContent!, cells[1].textContent!, cells[2].textContent!,
        cells[3].textContent!, cells[4].textContent!, cells[5].textContent!,
      ];
      applyDiscoveredDeviceSelection(row_data);
    }
  });

  window.addEventListener(
    'discover',
    (event: any) => {
      try {
        if (event.type === 'discover' && event.detail !== null) {
          addDiscoveredDeviceRow(event.detail.data);
        }
      } catch (error) {
        console.log('Error on postMessage back to APP' + error);
      }
    },
    false,
  );

  if (IS_EXTENSION) {
    chrome.runtime.onMessage.addListener((message: any) => {
      if (message && message.type === 'wisenet-discover-result' && message.detail) {
        addDiscoveredDeviceRow(message.detail);
      }
    });
    chrome.runtime.sendMessage({ type: 'wisenet-request-known-devices' }, (response: any) => {
      if (chrome.runtime.lastError) {
        return;
      }
      if (response && Array.isArray(response.devices)) {
        response.devices.forEach((device: any) => addDiscoveredDeviceRow(device));
      }
    });
  }

  // Explicit startup call, unconditional -- matches the original's own
  // second DOMContentLoaded listener, which calls this once after
  // #player_list already has its options (see session.ts / SRS FR-15.1's
  // corrected note: getSelectedPlayer() is not actually null after load).
  onPlayerSelect();
}
