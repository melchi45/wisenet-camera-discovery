# PRD — Discovery Result Star Topology View

| | |
|---|---|
| Title | Discovery Result Star Topology View — Product Requirements Document (PRD) |
| Abstract | Problem, goals, non-goals, users, and success criteria for the Table/Star Topology discovery result view toggle. |
| Status | Implemented |
| Component | `src/shared/` (`window.html`/`window.ts`) — both the Chrome extension and the nodejs example server target |
| Author | Youngho Kim |
| Milestone | Unreleased (post v1.0.2) |
| Related docs | [MRD](MRD.md) · [SRS](SRS.md) · [DESIGN](DESIGN.md) · [TC](TC.md) · [../architecture.md](../architecture.md) |

## History

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-08-27 | Youngho Kim | Initial PRD for the Star Topology view feature. |
| 1.1 | 2026-08-28 | Youngho Kim | Added Title/Abstract/Author/Milestone/History metadata. |

## Problem

The discovery result table (`#datatable`) presents every discovered device as a flat, unordered
row. At real-device counts (a site with multiple subnets, or a mix of camera model lines
discovered in one broadcast), a flat list makes it hard to visually answer questions like "what
subnets did we actually find devices on" or "how many of these are the same camera model" without
manually sorting/scanning column by column. There was no alternative view, and no way to group the
result set at all.

## Goals

- A second view of the same discovery result list — a node-link ("star topology") diagram — 
  toggleable alongside the existing table via one control in the same panel.
- A **Group by** selector so the topology's hub grouping matches whatever question the user is
  actually asking: by Name (model line), IP Address (subnet), MAC Address (vendor/OUI), Port, or
  Protocol.
- The existing search box filters and re-centers (zooms to fit) the topology view the same way it
  already filters the table, including matching **multiple** simultaneously-relevant groups at
  once (e.g. every `/24` hub under a typed IP prefix, or every model-line hub sharing a typed
  letter).
- No new dependency, no change to either target's discovery transport (`socket.ts`), and no change
  to the underlying discovered-device data model.

## Non-Goals

- **Not real network topology.** Hub groupings are entirely client-side derivations of fields the
  table already shows (IP subnet, Name prefix, MAC OUI, Port, Protocol) — not actual NVR→channel
  relationships, ARP-table adjacency, or gateway/router topology. Hub nodes are never linked to
  each other. See [MRD.md](MRD.md)'s alternatives table for why a "real" topology was out of scope
  for this iteration, and what it would need.
- **Not a persistence feature.** The selected view type, group-by column, and search text are UI
  state only — nothing is saved to `chrome.storage.local`/the nodejs `/settings` endpoint, and
  nothing survives a page reload.
- **Not a manual-layout feature.** Node positions are physics-derived and reset on every
  re-render (search, group-by change, or a newly discovered device all trigger a fresh layout);
  there's no "save my arrangement" capability.

## Users

The same installers/administrators who already use the discovery table — running a bulk scan
against a site and needing to make sense of what came back, rather than looking up one already-known
device (the table remains better suited to that).

## User Story

> As an installer who just ran a discovery scan against a site with several subnets and camera
> models, I want to see the result grouped visually — by subnet, or by model line — instead of
> scrolling a flat table, and I want typing a partial subnet or model prefix into the search box I
> already know to narrow the graph down to just the matching groups.

## Success Criteria

- Switching `View` from Table to Star Topology renders every currently-discovered device as a leaf
  node under a hub matching the selected `Group by` column, with no data loss versus the table
  (same device count, same identifying fields available via node label/tooltip).
- Changing `Group by` re-groups the same device set live, without needing to leave and re-enter the
  topology view.
- Typing in the search box filters the topology to exactly the devices (and their hubs) the same
  text would filter the table to, and the view re-centers on what's left.
- Clicking a leaf node populates the Device panel's hostname/port/protocol fields the same way
  clicking a table row already does (shared code path — see [DESIGN.md](DESIGN.md)); clicking a
  hub node does nothing (a hub is a derived grouping, not a selectable device).
- A newly discovered device (arriving while the topology view is already open) appears in the
  graph without requiring the user to switch views or search again.
- Hovering, clicking, and dragging (a node, or the canvas itself to pan) all behave normally and
  consistently, including after one or more search/group-by changes — not just on first entering
  the topology view. This was the hardest part of the feature to get right; see
  [DESIGN.md](DESIGN.md)'s "Interaction stability" section and `MEMORY.md`'s "Discovery result
  'Star Topology' view" entry for the iterations it took.
- Both `dist/chrome-extension/` and `dist/nodejs/examples/public/` ship the identical behavior —
  this is a `src/shared/` change with no `IS_EXTENSION`-gated branching.
