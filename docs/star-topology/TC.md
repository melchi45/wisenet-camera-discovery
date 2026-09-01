# TC — Discovery Result Star Topology View

| | |
|---|---|
| Title | Discovery Result Star Topology View — Test Cases (TC) |
| Abstract | Manual test procedures covering the view toggle, all 5 Group by types, search filtering, and interaction stability across re-renders. |
| Status | Implemented |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [PRD](PRD.md) · [MRD](MRD.md) · [SRS](SRS.md) · [DESIGN](DESIGN.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-27 | Youngho Kim | Initial TC for the Star Topology view feature. |
| 1.1 | 2026-08-28 | Youngho Kim | Added Title/Abstract/Author/Milestone/History metadata. |
| 1.2 | 2026-09-01 | Youngho Kim | Added TC-21/TC-22 for the `ip` grouping's /8→/16→/24 subnet-containment hub hierarchy; updated TC-3/TC-7 for the ip-only hub-linking exception. |

These are **manual** test procedures, not automated tests. Unlike `docs/native-https-proxy/TC.md`,
this feature needs no real network access of its own — it only renders whatever `dataSet` the
existing discovery pipeline already populated — so these can be run against either
`dist/chrome-extension/` (loaded unpacked) or `dist/nodejs/` (`npm run start`), from WSL or
Windows, with either a real discovery scan or the nodejs example server's cached `knownDevices`
replayed on reconnect. TC-3 onward assume **at least 3–4 discovered devices spanning more than one
`/24` subnet and more than one model-line prefix** (e.g. two `192.168.1.x` devices and one
`192.168.2.x` device; at least one `PNM-...`-named device and one differently-prefixed one) — a
single-device result set can't exercise the multi-group search behavior.

| ID | Title | Preconditions | Steps | Expected result |
|---|---|---|---|---|
| TC-1 | View toggle shows/hides the right elements | Discovery has found ≥1 device | Select `Star Topology` from `#discovery_view_type` | `#datatable`'s scroll container and `#datatable_info` hide; `#datatable_topology` and the `Group by` selector show (FR-2). Select `Table` again — the reverse happens, and the table still shows the same devices. |
| TC-2 | Star Topology renders every discovered device | Same as TC-1 | Enter the topology view | One leaf node per discovered device, grouped under hub nodes per the default `Group by` (`IP Address`); leaf count matches the table's row count. |
| TC-3 | Group by IP Address | ≥2 devices across ≥2 `/24` subnets | Leave `Group by` on `IP Address` | One hub per distinct `/24`, labeled `"{subnet}.0/24"`, plus its `/16` (`"{a.b}.0.0/16"`) and `/8` (`"{a}.0.0.0/8"`) ancestor hubs (FR-4/FR-5); each device is a leaf under its own `/24` hub, which chains up through `/16` to `/8` (FR-7's ip-only exception — see TC-21). |
| TC-4 | Group by Name | ≥2 devices with different model-line prefixes (e.g. `PNM-...`, `QNO-...`) | Set `Group by` to `Name` | One hub per prefix (text before the first `-`), labeled with just that prefix; a device with no `-` in its name groups under its own full name. |
| TC-5 | Group by MAC Address | ≥2 devices with different MAC OUIs | Set `Group by` to `MAC Address` | One hub per first-3-octet OUI, labeled `"{oui} (OUI)"`. |
| TC-6 | Group by Port / Protocol | Devices on more than one port and/or protocol | Set `Group by` to `Port`, then `Protocol` | One hub per exact value (`"Port {n}"` / the protocol string), no truncation. |
| TC-7 | Hub nodes are never linked to each other (except ip's subnet chain) | `Group by` set to `Name`, `MAC Address`, `Port`, or `Protocol`, with ≥2 hubs | Visually inspect the graph | No edge connects any hub node to another hub node — only hub→leaf edges exist (FR-7). Grouped by `IP Address` is the one exception to this — see TC-21. |
| TC-8 | Search filters the topology, matching multiple groups at once | Grouped by `IP Address`, devices on ≥2 different `192.168.x.x` `/24`s | Type `"192."` into the search box | Every leaf whose IP contains `"192."` stays, spanning however many `/24` hubs match — not just one — and the view re-centers on what's left (FR-8/FR-9). Narrow to `"192.168."` then a full `/24` prefix like `"192.168.214."` — the match set narrows accordingly at each step. |
| TC-9 | Search matches multiple Name-group hubs at once | Grouped by `Name`, devices with prefixes sharing a letter (e.g. `PNM`, `PNO`, `PND`) | Type that shared letter (e.g. `"P"`) | Every hub whose devices' Name contains that letter stays visible simultaneously, same "multiple groups at once" behavior as TC-8 (FR-8). |
| TC-10 | Empty search matches everything | Any grouping | Clear the search box | Full device set reappears, matching the table's own "clearing search shows everything" behavior (FR-8). |
| TC-11 | Search matching nothing renders an empty, error-free canvas | Any grouping | Type a string matching no device field | `#datatable_topology` shows an empty canvas — no console error, no stale previous graph left visible (NFR-5). |
| TC-12 | Clicking a leaf node selects the device | Any grouping | Click a leaf node | The Device panel's hostname/port fields populate, and the HTTPS-bypass checkbox defaults per the device's protocol — identical to clicking the same device's table row (FR-11). |
| TC-13 | Clicking a hub node does nothing | Any grouping | Click a hub node | No Device-panel fields change; no error. |
| TC-14 | Clicking empty canvas does nothing | Any grouping | Click empty space away from any node | No Device-panel fields change; no visual jump/zoom. |
| TC-15 | Hovering a node changes its color only | Any grouping | Move the mouse over a leaf or hub node, without clicking | The node's color changes (vis's built-in hover derivation); no size/zoom change, no camera movement (FR-12). |
| TC-16 | Dragging a node repositions it; dragging empty canvas pans the view | Any grouping | Click-drag a node left/right; separately, click-drag empty canvas | The dragged node's position follows the pointer; dragging empty canvas pans the whole graph. Both work identically whether this is the very first render or after one or more searches/group-by changes (NFR-4). |
| TC-17 | Interaction stability after repeated searches | Any grouping | Type a search, clear it, type a different search, repeat several times, then hover/click/drag | No degradation — every interaction still behaves exactly as TC-12–TC-16 describe, regardless of how many re-renders preceded it. This is the regression case for the bug class described in `DESIGN.md`'s "Interaction stability" section. |
| TC-18 | A newly discovered device appears live in the topology view | Topology view open, discovery still running (or re-triggered) | Let (or cause) a new device to be discovered while the topology view is showing | The new device appears as a leaf under the correct hub without switching views or re-searching (FR-9's `addDiscoveredDeviceRow()` re-render). |
| TC-19 | Group-by change re-groups live, no view exit needed | Topology view open | Change `Group by` from one value to another | The graph re-renders immediately with the new grouping, without needing to switch back to Table and re-enter Star Topology. |
| TC-20 | `npm run build` still produces both targets with the feature intact | Clean checkout | `npm run build` | Succeeds for both `dist/chrome-extension/` and `dist/nodejs/`; both targets' `window.html` contain the `#discovery_view_type`/`#discovery_topology_group_by` markup and behave identically (NFR-2; one shared `window.html`/`window.ts` build, per `../architecture.md`). |
| TC-21 | Group by IP Address builds a real /8→/16→/24 containment chain | ≥3 devices: two sharing both `/8` and `/16` but different `/24` (e.g. `192.168.214.10`, `192.168.99.20`), one on a different `/8` (e.g. `10.0.0.5`) | Group by `IP Address`; visually inspect the graph | Three hub levels exist: a `/8` hub (`"192.0.0.0/8"`) with one edge down to a `/16` hub (`"192.168.0.0/16"`), which has two edges down to two separate `/24` hubs (`"192.168.214.0/24"`, `"192.168.99.0/24"`), each with its own leaf; the unrelated `10.0.0.5` device forms its own independent `/8`→`/16`→`/24` chain, sharing no hub with the `192.*` chain. No `/16` or `/8` hub is duplicated for devices that share it — clicking any hub node still does nothing (TC-13 still holds for all three levels). |
| TC-22 | IP-grouped hub color is per-/8 branch, not per-/24 | Same device set as TC-21 | Group by `IP Address`; visually inspect hub/leaf colors | The `/8` hub, its `/16` descendant, both `/24` descendants, and both leaves under the `192.*` branch all share one color family; the independent `10.0.0.5` branch (its own `/8`/`/16`/`/24` hubs and leaf) uses a different color family from the palette (`TOPOLOGY_GROUP_COLORS`, cycling by `/8` root now, not by `/24` as before this change). |
