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
  (document.getElementById('port') as HTMLInputElement).value = row_data[3];
  player.port = row_data[3];

  // row_data[5] is the discovered device's Protocol ("http"/"https"). Set
  // directly (not via .click()) so changehttptype()'s 80/443 default-port
  // side effect doesn't immediately overwrite the real discovered port set
  // just above.
  const isHttps = row_data[5] === 'https';
  (document.getElementById('https_radio') as HTMLInputElement).checked = isHttps;
  (document.getElementById('http_radio') as HTMLInputElement).checked = !isHttps;
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
  if (groupBy === 'ip') return key + '.0/24';
  if (groupBy === 'mac') return key + ' (OUI)';
  if (groupBy === 'port') return 'Port ' + key;
  return key;
}

export function renderDiscoveryTopology(): void {
  const container = document.getElementById('datatable_topology');
  if (container === null) return;

  const groupIndex: { [key: string]: number } = {};
  let groupCount = 0;
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

    if (!(groupKey in groupIndex)) {
      groupIndex[groupKey] = groupCount++;
      const hubColors = TOPOLOGY_GROUP_COLORS[groupIndex[groupKey] % TOPOLOGY_GROUP_COLORS.length];
      nodes.push({
        id: 'hub:' + groupKey,
        label: getTopologyHubLabel(groupKey, state.discoveryTopologyGroupBy),
        shape: 'dot',
        size: 16,
        color: hubColors.hub,
        font: { color: '#ffffff' },
      });
    }

    const colors = TOPOLOGY_GROUP_COLORS[groupIndex[groupKey] % TOPOLOGY_GROUP_COLORS.length];
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
// Setup -- registers everything above, plus the drag handle (FR-2.6),
// #web toggle, table sort headers, search box, and the discover/known-
// devices event sources (FR-2.4).
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

  document.getElementById('drag')!.addEventListener('mousedown', () => {
    state.isResizing = true;
  });

  document.getElementById('web')!.addEventListener('click', () => {
    const webdiv = document.getElementById('webdiv') as HTMLElement;
    if (webdiv.style.display === 'none' || webdiv.style.visibility === 'hidden') {
      webdiv.style.display = 'block';
    } else {
      webdiv.style.display = 'none';
    }
  });

  document.addEventListener('mouseover', (e) => {
    if (!state.isResizing) return;
    const container = document.getElementById('container')!;
    const offsetRight = container.clientWidth - (e.clientX - container.getBoundingClientRect().left);
    (document.getElementById('left_panel') as HTMLElement).style.right = offsetRight + 'px';
    (document.getElementById('right_panel') as HTMLElement).style.width = offsetRight + 'px';
  });

  document.addEventListener('mouseup', () => {
    state.isResizing = false;
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
