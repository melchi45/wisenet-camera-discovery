# MRD — Discovery Result Star Topology View

| | |
|---|---|
| Related docs | [PRD](PRD.md) · [SRS](SRS.md) · [DESIGN](DESIGN.md) · [TC](TC.md) |

## Market context

This extension's primary users are installers/integrators running a bulk UDP discovery scan
against a site — sometimes a handful of devices, sometimes dozens across several subnets or model
lines mixed together (cameras and NVRs discovered in one pass, no separate scan per type). The
existing discovery result table (`#datatable`) is a flat, sortable/searchable list — good for
looking up one specific device by IP/MAC/name, but it doesn't help answer questions like "which
devices are on the 192.168.2.x segment?" or "how many PNM-series cameras did we just find?" without
manually scanning or sorting the whole list. A node-link ("star topology") view, with devices
clustered into hub groups by whichever column matters for the task at hand, answers those questions
visually instead.

## Alternatives considered

| Approach | Why it was or wasn't chosen |
|---|---|
| **Table only (status quo)** | Zero additional work, and remains the default view — nothing about this feature removes it. Doesn't scale visually past a modest device count when the task is "understand the shape of what we found," not "look up one device." |
| **A separate popup/window for the topology view** | Would duplicate the search box, view state, and selection-to-Device-panel wiring the table already has, and adds window-management complexity (open/close/focus) for no real benefit over an inline toggle in the same panel. Rejected in favor of a `<select>` next to the existing search box, consistent with how other view-affecting controls in this panel already work. |
| **Real network topology** (actual NVR→channel relationships, or ARP/gateway-derived device adjacency) | Would be the more "correct" sense of the word "topology," but SUNAPI UDP discovery replies carry no such relationship — each device (camera or NVR) reports itself once, with no parent/child field (see `docs/architecture.md`). Building this would need new data collection (per-NVR channel enumeration via a SUNAPI call, or ARP/routing-table inspection via the native host) — a materially larger feature. Rejected for this iteration; see [PRD.md](PRD.md)'s Non-Goals. |
| **Client-side derived grouping by column (this feature)** | Needs no new data collection at all — every grouping key (subnet, model-line prefix, MAC OUI, port, protocol) is computed from fields the discovery table already displays. Chosen as the pragmatic middle ground: visually answers "what shape is this device list" without pretending to show real network wiring (hub nodes are deliberately never linked to each other — see [DESIGN.md](DESIGN.md)). |
| **A third-party graph library** (e.g. `vis-network`, `cytoscape.js`, `d3-force`) | Unnecessary: `vis` (the old monolithic vis@4.x bundle already a dependency for the playback `Timeline`) already ships a `Network` module in the same package, already fully bundled via `window.ts`'s `import * as vis from 'vis'`. Adding a second graph library would be pure bundle-size waste for no functional gain — see `MEMORY.md`'s "Discovery result 'Star Topology' view" entry. |

## Why grouping is user-selectable, not fixed to one column

An early cut of this feature grouped only by IP `/24` subnet. Real usage quickly surfaces other
questions the same list answers just as well — "which model lines did we find," "which devices are
still on plain HTTP" — each best answered by grouping on a different column. Rather than building a
separate fixed view per question, one `Group by` selector (Name/IP Address/MAC Address/Port/
Protocol) reuses the same rendering pipeline for all of them.

## Why the search box drives the topology view too, instead of a separate topology-only search

The table already has a search box with well-understood semantics (any cell in a row contains the
typed text). Users switching between Table and Star Topology expect that same search to keep
working, not to learn a second, view-specific filter syntax. Reusing the identical predicate also
turned out to give the desired "drill down by typing more" behavior (e.g. `"192."` →
`"192.168."` → `"192.168.214."`, or a Name-group letter like `"P"` matching several model lines at
once) for free — see [DESIGN.md](DESIGN.md).
