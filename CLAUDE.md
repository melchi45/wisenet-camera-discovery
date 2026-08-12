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
npm run start:server       # builds dist/nodejs/ then runs the example server (http://localhost:8080/)
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
- **WSL2 can't reach real UDP-broadcast devices**: run discovery-testing tools (native host,
  `npm run start:server`) from a real Windows process, not inside WSL bash — WSL2's virtual/NAT
  network isn't on the same broadcast domain as your physical LAN, so `dgram`/native UDP either
  finds nothing or fails to bind at all, with no useful error either way. See `README.md`'s
  networking note for the full explanation.
- **`src/shared/` changes affect both `dist/` outputs** — `npm run build` builds both; don't
  assume a fix verified only against the extension (or only against the example server) is done.
  See `docs/architecture.md`'s own closing note.

## Conventions

- This codebase has Korean comments throughout `window.ts` and elsewhere — that's expected and
  fine to keep/add to; there's no English-only rule here.
- `dist/` and `build/` are pure build output — don't hand-edit anything there.
- Prefer small, targeted edits — `window.ts` in particular is large (~3,000 lines) and has
  latent quirks from its jQuery-era history (see `MEMORY.md`); check whether a comment nearby
  explains *why* something looks odd before "fixing" it.
- See [`MEMORY.md`](MEMORY.md) for non-obvious past decisions and bugs found/fixed in this repo.
