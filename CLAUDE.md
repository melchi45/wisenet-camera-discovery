# CLAUDE.md

Guidance for Claude Code (or any agent) working in this repository.

## What this is

WiseNet/Hanwha Chrome IP Installer — a Chrome extension (`dist/chrome-extension/`, "Load
unpacked") for discovering and viewing Wisenet cameras/NVRs, plus a standalone Node.js UDP
discovery package (`dist/nodejs/`, `wisenet-udp-discovery` on npm). Both consumers share the
same SUNAPI wire-format implementation (`src/sunapi/`) and, since the dual-target UI change, the
same `window.html`/`window.ts` front end (`src/shared/`) — see
[docs/architecture.md](docs/architecture.md) for the full write-up before touching either.

TypeScript sources live under `src/`; `dist/` and `build/` are generated/gitignored — always
rebuild after pulling.

## Build & run

```bash
npm install
npm run build              # both dist/chrome-extension/ and dist/nodejs/
npm run build:extension    # just the extension side (background.ts + shared window.ts/socket.ts + Vite bundle)
npm run build:node         # just tsc -p tsconfig.node.json
npm run start               # builds dist/nodejs/ then runs the example server (http://localhost:8080/)
npm run clean               # removes dist/ and build/
```

Load `dist/chrome-extension/` unpacked in `chrome://extensions` (Developer mode) to run the
extension. The native messaging host (`native-host/`) needs a one-time install per-machine —
see [`src/chrome-extension/native-host/README.md`](src/chrome-extension/native-host/README.md).

## Environment gotchas

- **WSL/DrvFs file locking**: if this repo lives on a `/mnt/<drive>/...` mount, real-time
  antivirus (e.g. Windows Defender) transiently locks files as they're written/deleted,
  surfacing as `ENOENT`/`EACCES`/`ENOTEMPTY` on operations that are actually fine a moment
  later. `scripts/build.js`'s `retryOnTransientFsError` rides this out with backoff — if you
  see one of these errors from a *different* script, the same retry pattern is the fix, not a
  real bug.
  If `retryOnTransientFsError` exhausts all its retries (`rm -rf dist/chrome-extension` failing
  with `EBUSY`/`ENOTEMPTY`/"Permission denied" on `native-host/` specifically, repeatedly, not
  just once), that's *not* the transient antivirus case above — it means something on the Windows
  side is actively holding that folder open, almost always Edge/Chrome still running with the
  extension loaded (a spawned native-host `node.exe` can also hold it, though in practice the
  browser itself was the culprit every time this came up). Fully closing the browser (not just its
  windows — check `Get-Process msedge`/`Get-Process chrome` in PowerShell come back empty) clears
  it; killing an individual lingering `node.exe` from `Get-CimInstance Win32_Process -Filter
  "Name = 'node.exe'"` is the lower-friction alternative when you don't want to lose other browser
  state. `npm run build:extension` alone (skips the `dist/` clean+assemble step) still works for
  verifying the TypeScript/Vite side compiles while the lock is in place.
- **WSL2 can't reach real UDP-broadcast devices**: run discovery-testing tools (native host,
  `npm run start`) from a real Windows process, not inside WSL bash — WSL2's virtual/NAT
  network isn't on the same broadcast domain as your physical LAN, so `dgram`/native UDP either
  finds nothing or fails to bind at all, with no useful error either way. See `README.md`'s
  networking note for the full explanation.
- **`src/shared/` changes affect both `dist/` outputs** — `npm run build` builds both; don't
  assume a fix verified only against the extension (or only against the example server) is done.
  See `docs/architecture.md`'s own closing note.
- **`npm install` fails with `EALLOWREMOTE` on a fresh clone**: `@melchi45/rtsp-over-websocket`
  is a private GitHub Packages dependency — resolving it needs a `.npmrc` with
  `@melchi45:registry=https://npm.pkg.github.com` plus an authenticated token
  (`read:packages` scope), which isn't checked into the repo (see `.gitignore`). Run
  `node scripts/setup-github-packages-auth.js <PAT>` once per machine before `npm install`.
  Without that `.npmrc`, npm 11+'s `allow-remote: none` default blocks the tarball fetch because
  the resolved download host (`npm.pkg.github.com`) doesn't match the *unconfigured* default
  registry (`registry.npmjs.org`) — the fix is the `.npmrc`, not disabling `allow-remote`.
- **Self-signed camera certificate → `net::ERR_CERT_AUTHORITY_INVALID`**: Chrome blocks the SUNAPI
  HTTPS request at the browser level before any extension code sees it — this is a browser TLS
  trust decision, not something `host_permissions`/`manifest.json` can override. The safe fix is
  opening the camera's URL in a tab once and accepting the certificate exception; the extension
  also has an opt-in "Bypass Untrusted Certificate (Native Host)" checkbox that avoids that manual
  step via the native messaging host — see
  [docs/native-https-proxy/](docs/native-https-proxy/) (PRD/MRD/SRS/DESIGN/TC) for the full spec
  before touching `src/shared/scripts/nativeSunapiClient.ts` or
  `native-host/wisenet-udp-host.ts`'s `httpRequest` command.

## Conventions

- This codebase has Korean comments throughout `window.ts` and elsewhere — that's expected and
  fine to keep/add to; there's no English-only rule here.
- `dist/` and `build/` are pure build output — don't hand-edit anything there.
- Prefer small, targeted edits — `window.ts` in particular is large (~3,000 lines) and has
  latent quirks from its jQuery-era history (see `MEMORY.md`); check whether a comment nearby
  explains *why* something looks odd before "fixing" it.
- See [`MEMORY.md`](MEMORY.md) for non-obvious past decisions and bugs found/fixed in this repo.
- **Every `src/shared/` change updates `docs/architecture.md` in the same change, not just the
  first change of a session.** This applies per-edit, not per-conversation — a session that
  touches `window.ts`/`window.html`/`window.css` five separate times needs `docs/architecture.md`
  (and a `MEMORY.md` entry, for anything non-obvious) updated five times, not once at the start
  and then treated as covered for the rest. Do not report a `src/shared/` change as finished
  without having done this for that specific change — see the `shared-window` skill for the full
  checklist.
- The discovery result panel has a Table/Star Topology toggle with a Group by selector
  (`#discovery_view_type`/`#discovery_topology_group_by` in `window.html`,
  `renderDiscoveryTopology()` in `window.ts`) — read
  [`docs/star-topology/`](docs/star-topology/) (MRD/PRD/SRS/DESIGN/TC) before changing
  grouping, search-filter, or `vis.Network` interaction behavior there; `docs/architecture.md`'s
  "Discovery result views" section is only a brief pointer to it, same as for
  `docs/native-https-proxy/`.
