// An opt-in alternative to SunapiManager's default XHR-based HTTP client,
// used when a camera/NVR presents a self-signed HTTPS certificate that the
// browser refuses to complete a request to (ERR_CERT_AUTHORITY_INVALID).
// Routes every SUNAPI request through the native messaging host
// (native-host/wisenet-udp-host.ts's "httpRequest" command) instead of a
// browser XMLHttpRequest, so TLS trust is decided by that local process
// rather than Chrome's own certificate store.
//
// See docs/native-https-proxy/DESIGN.md for the full design and the
// SunapiManager.attach()/SunapiClientLike feasibility finding that makes
// this possible without forking the vendored rtsp-over-websocket package.
//
// Extension-only — window.ts only constructs this behind the same
// IS_EXTENSION check its other chrome.* call sites already use (see
// docs/architecture.md); the nodejs example target has no native host.

interface SunapiFailure {
  Code: number;
  message?: string;
}

type SuccessFn = (response: unknown) => void;
type FailFn = (error: SunapiFailure) => void;

interface PendingRequest {
  successFn: SuccessFn;
  failFn: FailFn;
  timeoutId: ReturnType<typeof setTimeout>;
}

// Mirrors the subset of fields SunapiManager.init() normalizes internally
// (device.hostname/username from cameraIp/user when deviceType !== 'nvr').
// Duplicated here rather than reused because init() itself can't be
// called on the native-proxy path — see initDevice() below.
export interface NativeSunapiDevice {
  hostname?: string;
  cameraIp?: string;
  username?: string;
  user?: string;
  password?: string;
  port?: number | string;
  protocol?: string;
  deviceType?: string;
}

// No response within this long, native messaging + a LAN device should
// never take anywhere close to it — exists so a stuck request (host
// process wedged, device firewalled/black-holed, native messaging port
// silently dropped) surfaces as a real failure instead of leaving
// initSunapiManager()'s promise chain pending forever with no console
// output and no popup (see docs/native-https-proxy/SRS.md's "Constraints").
const REQUEST_TIMEOUT_MS = 20000;

// Safe equivalent of the vendored library's own Rc() (JSON.parse + unwrap
// a `.data` envelope) — used only by initDevice() below, since every
// later SunapiManager call already goes through the library's own Rc()
// once this client is attach()ed. Deliberately swallows a parse failure
// instead of throwing: this repo has already seen a device whose
// attributes.cgi returns XML text rather than JSON (see window.ts's own
// note near its `.then(attributes => ...)` continuation) — Rc()'s
// unguarded JSON.parse would throw on that response, and since it runs
// inside an XHR event callback (not a Promise executor) in the real
// client, that throw becomes an uncaught exception that never
// settles the surrounding promise, i.e. exactly the silent-hang failure
// mode this file's REQUEST_TIMEOUT_MS exists to catch. Falling back to
// the raw string keeps this client's success path from ever being the
// one introducing that failure mode.
function parseSunapiResponse(body: unknown): unknown {
  if (typeof body !== 'string') {
    return body;
  }
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && 'data' in parsed) {
      return (parsed as { data: unknown }).data;
    }
    return parsed;
  } catch {
    return body;
  }
}

let requestCounter = 0;

export class NativeSunapiClient {
  private port: chrome.runtime.Port | null = null;
  private pending = new Map<string, PendingRequest>();
  private device: NativeSunapiDevice;

  constructor(device: NativeSunapiDevice) {
    this.device = device;
  }

  private ensurePort(): chrome.runtime.Port {
    if (this.port !== null) {
      return this.port;
    }
    // Its own native-messaging connection, deliberately separate from
    // socket.hostPort (background.ts's long-lived discovery port): this
    // one lives and dies with whichever window.html tab has the native
    // proxy checkbox enabled, not with the service worker's discovery
    // lifecycle. Reuses socket.HOST_NAME (scripts/socket.ts) rather than
    // a second registration — same host binary, one new command.
    console.debug('[nativeSunapiClient] connecting native host', socket.HOST_NAME);
    const port = chrome.runtime.connectNative(socket.HOST_NAME);
    port.onMessage.addListener((message: any) => this.onHostMessage(message));
    port.onDisconnect.addListener(() => this.onHostDisconnect());
    this.port = port;
    return port;
  }

  private onHostMessage(message: any): void {
    console.debug('[nativeSunapiClient] onHostMessage', message);
    if (!message || typeof message.requestId !== 'string') {
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) {
      return;
    }
    this.settle(message.requestId);

    if (message.type === 'httpResponse') {
      // Faithful to the vendored library's own XHR client (XO.send()):
      // only 200 is treated as success, an empty body on 200 is still a
      // failure ("No response") — see docs/native-https-proxy/SRS.md.
      if (message.status === 200 && message.body !== '') {
        pending.successFn(message.body);
      } else if (message.status === 200) {
        pending.failFn({ Code: -1, message: 'No response' });
      } else {
        pending.failFn({ Code: message.status, message: message.statusText });
      }
      return;
    }
    if (message.type === 'httpError') {
      pending.failFn({ Code: -1, message: message.message });
    }
  }

  private onHostDisconnect(): void {
    const lastError = chrome.runtime.lastError;
    const message = lastError && lastError.message ? lastError.message : 'native host disconnected';
    console.debug('[nativeSunapiClient] onHostDisconnect', message);
    // Snapshot the ids first — settle() mutates `this.pending` while we'd
    // otherwise be iterating it.
    Array.from(this.pending.keys()).forEach((requestId) => {
      const pending = this.pending.get(requestId);
      this.settle(requestId);
      pending!.failFn({ Code: -1, message });
    });
    this.port = null;
  }

  // Clears both the pending-request entry and its timeout — every path
  // that resolves/rejects a request (a real response, a disconnect, or
  // the timeout firing) must go through this so a late-arriving response
  // after a timeout can never double-settle the original caller's promise.
  private settle(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeoutId);
    this.pending.delete(requestId);
  }

  private deviceUrl(uri: string): string {
    const protocol = this.device.protocol || 'https';
    const host = this.device.cameraIp || this.device.hostname || '';
    const port = this.device.port;
    const portPart = port !== undefined && port !== null && port !== '' ? ':' + port : '';
    return protocol + '://' + host + portPart + uri;
  }

  private send(method: string, uri: string, successFn: SuccessFn, failFn: FailFn): void {
    const requestId = 'nativeSunapi-' + (++requestCounter) + '-' + Date.now();
    const url = this.deviceUrl(uri);
    const timeoutId = setTimeout(() => {
      console.warn('[nativeSunapiClient] request timed out after ' + REQUEST_TIMEOUT_MS + 'ms', { requestId, url });
      this.settle(requestId);
      failFn({ Code: -1, message: 'native host did not respond within ' + REQUEST_TIMEOUT_MS + 'ms' });
    }, REQUEST_TIMEOUT_MS);
    this.pending.set(requestId, { successFn, failFn, timeoutId });
    console.debug('[nativeSunapiClient] sending', { requestId, method, url });
    try {
      this.ensurePort().postMessage({
        command: 'httpRequest',
        requestId,
        method,
        url,
        headers: { Accept: 'application/json' },
        username: this.device.username || this.device.user || '',
        password: this.device.password || '',
      });
    } catch (error: any) {
      this.settle(requestId);
      failFn({ Code: -1, message: error && error.message ? error.message : String(error) });
    }
  }

  // --- SunapiClientLike surface (docs/native-https-proxy/SRS.md) — what
  // SunapiManager.attach()/request() actually call once this is attached.

  get(uri: string, _jsonData: unknown, successFn: SuccessFn, failFn: FailFn): void {
    this.send('GET', uri, successFn, failFn);
  }

  post(uri: string, _jsonData: unknown, successFn: SuccessFn, failFn: FailFn): void {
    this.send('POST', uri, successFn, failFn);
  }

  setTimeout(_timeout: number): void {
    // The native host does not currently apply a per-request timeout
    // (see docs/native-https-proxy/SRS.md's open items) — accepted for
    // interface parity with SunapiClientLike.
  }

  getAuthInfo(): unknown {
    return null;
  }

  // --- SunapiManager.init() replacement ---
  //
  // SunapiManager.init() unconditionally builds its own internal XHR-based
  // client and issues the first attributes.cgi GET before any attach()ed
  // client would ever get a chance to run — so the native-proxy path
  // cannot call SunapiManager.init() at all. This replicates its device
  // normalization and first request instead; every SUNAPI call after this
  // one goes through SunapiManager's own request() helper against
  // whatever client is attach()ed, so nothing else needs duplicating.
  initDevice(device: NativeSunapiDevice): Promise<unknown> {
    this.device = { ...device };
    if (this.device.deviceType !== 'nvr') {
      this.device.hostname = this.device.cameraIp;
      this.device.username = this.device.user;
    }
    return new Promise((resolve, reject) => {
      this.get('/stw-cgi/attributes.cgi', '', (response) => {
        console.debug('[nativeSunapiClient] initDevice succeeded', response);
        // Mirrors the vendored library's own Rc() (JSON.parse + unwrap
        // `.data`) for the same reason it exists there: window.ts's
        // shared .then(attributes => ...) continuation expects an object
        // it can read .Initialized off of. Falls back to the raw string
        // (rather than Rc()'s un-guarded JSON.parse, which would throw)
        // since this repo has already seen a device whose attributes.cgi
        // returns XML text, not JSON — see window.ts's own note on this.
        resolve(parseSunapiResponse(response));
      }, (error) => {
        // Matches SunapiManager.init()'s own rejection shape (`new
        // ms({...})`, ms being the vendored package's SunapiError) so
        // window.ts's existing `error instanceof SunapiError` branch
        // keeps working unchanged regardless of which client ran.
        reject(new SunapiError({
          errorCode: error.Code,
          place: 'nativeSunapiClient.ts:initDevice',
          message: error.message,
        }));
      });
    });
  }

  close(): void {
    if (this.port !== null) {
      this.port.disconnect();
      this.port = null;
    }
    this.pending.clear();
  }
}
