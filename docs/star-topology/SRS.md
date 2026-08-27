# SRS — Discovery Result Star Topology View

| | |
|---|---|
| Related docs | [PRD](PRD.md) · [MRD](MRD.md) · [DESIGN](DESIGN.md) · [TC](TC.md) |

## Functional requirements

- **FR-1**: `window.html` provides a `#discovery_view_type` `<select>` next to the existing
  `#datatable_search` box, with options `Table` (default, value `table`) and `Star Topology`
  (value `topology`).
- **FR-2**: Selecting `Star Topology` hides `#datatable`'s scroll container and `#datatable_info`,
  and shows `#datatable_topology` (the graph container) and the `#discovery_topology_group_by_wrap`
  selector; selecting `Table` reverses this. Handled by `setDiscoveryViewType()` in `window.ts`.
- **FR-3**: `#discovery_topology_group_by` (inside `#discovery_topology_group_by_wrap`, hidden
  whenever the Table view is active) offers 5 options: `IP Address` (default, value `ip`), `Name`
  (`name`), `MAC Address` (`mac`), `Port` (`port`), `Protocol` (`protocol`). `Http URL` is not a
  grouping option — it's derived from IP+port, not an independent dimension.
- **FR-4**: `getTopologyGroupKey(row, groupBy)` extracts the hub-grouping key from a `dataSet` row
  (`[Name, IPAddress, MACAddress, Port, URL, Protocol]`) per the selected type:

  | `groupBy` | `dataSet` index | key extraction |
  |---|---|---|
  | `ip` | 1 | first 3 dot-segments (`/24` subnet) |
  | `name` | 0 | substring before the first `-` (whole value if none) |
  | `mac` | 2 | first 3 colon-segments (OUI/vendor prefix) |
  | `port` | 3 | exact value, no truncation |
  | `protocol` | 5 | exact value, no truncation |

- **FR-5**: `getTopologyHubLabel(key, groupBy)` formats the hub node's label: `"{key}.0/24"` for
  `ip`, `"{key} (OUI)"` for `mac`, `"Port {key}"` for `port`, and `"{key}"` unchanged for `name`/
  `protocol`.
- **FR-6**: A leaf node's `id` is always the device's `IPAddress` (`dataSet` row index 1),
  regardless of `groupBy` — the same value `addDiscoveredDeviceRow()` already uses as its dedup
  key. Only which hub a leaf's edge points to changes with `groupBy`; the leaf's own identity does
  not.
- **FR-7**: Hub nodes are never linked to each other by an edge — see [MRD.md](MRD.md)/
  [DESIGN.md](DESIGN.md) for why (grouping is a derived convenience, not real topology).
- **FR-8**: `renderDiscoveryTopology()` filters which rows become leaves using the exact same
  per-row predicate `renderDiscoveryTable()` already uses for `discoverySearchText` (any cell,
  case-insensitive substring match) — not a second, `groupBy`-specific matching rule. A hub is
  included whenever at least one of its leaves passed the filter. An empty search text includes
  everything (unchanged from today's table behavior).
- **FR-9**: The `#datatable_search` `input` listener re-runs `renderDiscoveryTopology()` (in
  addition to its existing `renderDiscoveryTable()` call) whenever `discoveryViewType === 
  'topology'`. `#discovery_topology_group_by`'s `change` listener sets `discoveryTopologyGroupBy`
  and re-renders. `addDiscoveredDeviceRow()` re-renders the topology view too (in addition to the
  table) whenever a new device arrives while that view is active.
- **FR-10**: Every call to `renderDiscoveryTopology()` destroys the existing `vis.Network` instance
  (if any) and constructs a new one from scratch, rather than reusing it via `setOptions()`/
  `setData()` — see [DESIGN.md](DESIGN.md)'s "Interaction stability" section for why reuse was
  tried first and rejected.
- **FR-11**: Clicking a leaf node calls `applyDiscoveredDeviceSelection(row)` — the same function
  the table's row-click handler calls — populating the Device panel's hostname/port/HTTPS-bypass
  fields identically regardless of which view was clicked in. Clicking a hub node, or empty canvas,
  does nothing. A click's node-hit is re-verified via `visNetwork.getNodeAt(params.pointer.DOM)`
  at click time (not trusted from `params.nodes` alone) — see [DESIGN.md](DESIGN.md).
- **FR-12**: Node color changes on hover using `vis.Network`'s own built-in string-color hover
  derivation (no custom hover-state code) — see [DESIGN.md](DESIGN.md)'s "Interaction stability"
  section for why a custom implementation was tried first and reverted.
- **FR-13**: The camera is fit (zoomed/centered) to the current node set only once that render's
  physics layout has actually finished settling (`stabilizationIterationsDone`), not synchronously
  after `setData()` — see [DESIGN.md](DESIGN.md). Physics is disabled once settled and re-enabled
  automatically on the next render.

## Non-functional requirements

- **NFR-1 (no new dependency)**: uses `vis.Network`, part of the `vis` package already a
  dependency (for the playback `Timeline`) and already fully bundled via `window.ts`'s `import *
  as vis from 'vis'`. No `package.json` change.
- **NFR-2 (both targets identical)**: this is a `src/shared/` change with no `IS_EXTENSION`
  branching — `dist/chrome-extension/` and `dist/nodejs/examples/public/` behave identically. No
  change to `socket.ts`, `background.ts`, or `examples/server.ts`.
- **NFR-3 (no new discovered-device fields)**: uses only fields already present in `dataSet`
  (`Name`/`IPAddress`/`MACAddress`/`Port`/`URL`/`Protocol`) — no change to
  `socket.ts`'s `displayResult()` or the raw SUNAPI parsing in `src/sunapi/response.ts`.
- **NFR-4 (interaction stability across re-renders)**: hover, click, and drag (node or canvas pan)
  must behave identically whether the graph is on its first render or its Nth
  search/group-by-triggered re-render. This was **not** true of earlier iterations of this feature
  — see [DESIGN.md](DESIGN.md) and `MEMORY.md`'s "Discovery result 'Star Topology' view" entry for
  the specific failure modes found and why FR-10/FR-13 are structured the way they are as a direct
  result.
- **NFR-5 (graceful empty state)**: a search matching zero devices renders an empty canvas (no
  error, no stale previous graph left visible) — consistent with the table's own "Showing 0 to 0 of
  0 entries" behavior for the same input.

## Constraints / known limitations

- **MAC address format assumed, not read from a live device.** The `mac` grouping's OUI extraction
  assumes colon-separated hex octets (`"00:09:18:AB:CD:EF"`), inferred from `chMAC`'s 18-byte
  null-terminated wire-string sizing in `src/sunapi/protocol.ts` (17 chars + a null terminator is
  exactly that format) — not confirmed against a real captured device reply. Re-verify if a future
  change depends on this more critically than a display-grouping key (see `MEMORY.md`).
- **`name` grouping's "prefix before the first `-`" rule is a heuristic**, matching common Wisenet/
  Hanwha model-line codes (`PNM`, `QNO`, `XNO`, ...) — a device name with no `-` groups under its
  whole name unchanged (effectively its own hub), and a name whose vendor/line code doesn't follow
  that convention won't group meaningfully.
- **No manual layout / node position memory.** Every re-render (search, group-by change, new
  device) reconstructs the `vis.Network` from scratch (FR-10) — node positions are not preserved
  across renders, by design (see [DESIGN.md](DESIGN.md)'s trade-off discussion), so a user cannot
  drag a node to a preferred spot and expect it to stay there once anything else changes the data.
- **This old `vis@4.20` build ships no `.d.ts` and no changelog** — several implementation details
  in [DESIGN.md](DESIGN.md) were confirmed by reading `node_modules/vis/dist/vis.js` directly
  rather than documentation, since none exists for this exact version.
