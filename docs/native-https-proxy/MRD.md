# MRD — Native-Host HTTPS Proxy for Untrusted Camera Certificates

| | |
|---|---|
| Related docs | [PRD](PRD.md) · [SRS](SRS.md) · [DESIGN](DESIGN.md) · [TC](TC.md) |

## Market context

Wisenet/Hanwha camera and NVR firmware ships an HTTPS web/SUNAPI interface with a factory
self-signed certificate; replacing it with a certificate signed by a trusted CA is possible but is
an extra per-device provisioning step most installations skip, especially for cameras that never
leave a private LAN. This extension is used by installers/integrators configuring — often —
multiple devices in one session. A certificate warning that must be manually clicked through in a
separate browser tab, once per device IP, per machine, is real per-device friction in that
workflow, and is easy to forget (leading to confusing "nothing happens" reports, as this repo's
own user-facing debugging session that motivated this feature showed).

## Alternatives considered

| Approach | Why it was or wasn't chosen |
|---|---|
| **Manual browser certificate exception** (open the camera's URL directly, accept the warning) | Already available, zero code — this is the option offered first, and remains the default/only path outside the extension target. Kept as the safe default; not removed by this change. |
| **Switch the device to plain HTTP** | Avoids the certificate problem entirely where the camera's admin interface supports HTTP, but is strictly less secure for the SUNAPI session (credentials, video). Still available via the existing HTTP/HTTPS radio buttons in `window.html`; not something this feature needs to touch. |
| **Install a CA-trusted certificate on the camera** | The correct answer for a production deployment, but out of scope for a LAN installer tool — not something this extension provisions. |
| **Native-host HTTPS proxy (this feature)** | The only option that removes the manual per-device click-through while keeping the browser's own TLS trust store untouched for everything else. Chosen as an **additional, opt-in** path, not a replacement for the above. |
| *(rejected)* A global `XMLHttpRequest` shim inside `window.html` | Would let the vendored `@melchi45/rtsp-over-websocket` player's own HTTP calls (attributes, video profiles, etc.) be intercepted without any of the `SunapiManager.attach()` plumbing this feature actually uses — but requires faithfully re-implementing the full `XMLHttpRequest` interface (readyState transitions, `getResponseHeader`, timing) as a shim, is fragile against future versions of that vendored package, and risks silently breaking things this repo doesn't control. See [DESIGN.md](DESIGN.md)'s "Alternatives rejected" for the specific technical reason this repo instead uses `SunapiManager.attach()`. |

## Why an opt-in checkbox, not automatic fallback

An automatic "retry with TLS validation off if the first attempt fails" design was considered and
rejected: it would silently downgrade security for every certificate failure, including ones that
indicate a real problem (wrong IP, MITM, expired cert on a device that used to have a valid one),
without the user ever making an explicit choice. An opt-in checkbox, defaulting off, keeps that
decision in the user's hands per device — consistent with how browsers themselves require an
explicit click-through rather than silently proceeding.
