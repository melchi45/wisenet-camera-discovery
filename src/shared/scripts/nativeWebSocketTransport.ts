// An opt-in alternative WebSocket transport for the RTSP-over-WebSocket
// streaming connection (wss://<camera>/StreamingServer), used when a
// camera/NVR presents a self-signed HTTPS certificate the browser refuses
// to complete a TLS handshake for — the streaming counterpart to
// nativeSunapiClient.ts's SUNAPI REST proxy. Routes every frame through
// the native messaging host (native-host/wisenet-udp-host.ts's
// "wsOpen"/"wsSend"/"wsClose" commands) instead of a browser WebSocket, so
// TLS trust is decided by that local process rather than Chrome's own
// certificate store.
//
// See docs/native-https-proxy/DESIGN.md for the full design and the
// Transport.createWebSocket()/WebSocketLike feasibility finding that makes
// this possible with a small, additive change to the vendored
// rtsp-over-websocket package (a settable `transportFactory` property on
// the `<rtsp-over-websocket>` element) rather than reimplementing that
// package's RTSP/RTP framing.
//
// Extension-only — window.ts only sets this behind the same IS_EXTENSION
// check its other chrome.* call sites already use (see
// docs/architecture.md); the nodejs example target has no native host.

// Mirrors the vendored package's own WebSocketLike interface
// (src/player/network/transport/Transport.ts) — duplicated here as a
// type-only shape (not imported as a value) since this file only needs
// the type, and the real `Transport` class it subclasses comes from the
// ambient `Transport` global instead (see globals.d.ts / legacy-globals-bridge.js).
interface CloseOrErrorEventLike {
  code: number;
  reason?: string;
}

interface WebSocketLike {
  readyState: number;
  binaryType: string;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null;
  onclose: ((ev: CloseOrErrorEventLike) => void) | null;
  onerror: ((ev: CloseOrErrorEventLike) => void) | null;
  send(data: unknown): void;
  close(): void;
}

// Standard WebSocket readyState constants (WHATWG spec) — Transport.ts
// checks against these same numeric values (e.g. its own `static readonly
// CLOSED = 3`).
const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

// Same rationale as nativeSunapiClient.ts's REQUEST_TIMEOUT_MS: without
// this, a wedged native host or a connection the far side never
// acknowledges would leave the stream waiting forever with no error and
// no console output.
const WS_CONNECT_TIMEOUT_MS = 15000;

let connectionCounter = 0;

function toUint8Array(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (typeof data === 'string') {
    // Transport.ts always sends binary (it converts RTSP text to bytes
    // itself via stringToUint8Array before calling send()) — this is
    // defensive, not an expected path.
    return new TextEncoder().encode(data);
  }
  throw new Error('NativeWebSocketLike.send(): unsupported data type');
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Implements WebSocketLike by relaying every frame through the native
// messaging host instead of opening a real browser WebSocket. One
// dedicated chrome.runtime.connectNative() port per instance (per active
// stream) — simplest lifecycle, and consistent with
// nativeSunapiClient.ts's own "its own connection, separate from
// socket.hostPort" choice.
class NativeWebSocketLike implements WebSocketLike {
  readyState = CONNECTING;
  binaryType = 'arraybuffer';
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null;
  onclose: ((ev: CloseOrErrorEventLike) => void) | null = null;
  onerror: ((ev: CloseOrErrorEventLike) => void) | null = null;

  private port: chrome.runtime.Port | null = null;
  private readonly connectionId: string;
  private connectTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(url: string) {
    this.connectionId = 'nativeWs-' + (++connectionCounter) + '-' + Date.now();
    this.open(url);
  }

  private open(url: string): void {
    console.log('[nativeWebSocketTransport] opening', { connectionId: this.connectionId, url });
    this.connectTimeoutId = setTimeout(() => {
      console.warn('[nativeWebSocketTransport] connect timed out', this.connectionId);
      this.fail({ code: 1006, reason: 'native host did not open the connection within ' + WS_CONNECT_TIMEOUT_MS + 'ms' });
    }, WS_CONNECT_TIMEOUT_MS);

    try {
      const port = chrome.runtime.connectNative(socket.HOST_NAME);
      port.onMessage.addListener((message: any) => this.onHostMessage(message));
      port.onDisconnect.addListener(() => this.onHostDisconnect());
      this.port = port;
      port.postMessage({ command: 'wsOpen', connectionId: this.connectionId, url });
    } catch (error: any) {
      this.fail({ code: 1006, reason: error && error.message ? error.message : String(error) });
    }
  }

  private onHostMessage(message: any): void {
    if (!message || message.connectionId !== this.connectionId) {
      return;
    }
    if (message.type === 'wsOpen') {
      if (this.connectTimeoutId !== null) {
        clearTimeout(this.connectTimeoutId);
        this.connectTimeoutId = null;
      }
      this.readyState = OPEN;
      this.onopen?.({});
      return;
    }
    if (message.type === 'wsMessage') {
      if (this.onmessage) {
        this.onmessage({ data: base64ToArrayBuffer(message.data) });
      }
      return;
    }
    if (message.type === 'wsError') {
      this.fail({ code: 1006, reason: message.message });
      return;
    }
    if (message.type === 'wsClose') {
      this.readyState = CLOSED;
      this.onclose?.({ code: message.code ?? 1000, reason: message.reason });
      this.closePort();
    }
  }

  private onHostDisconnect(): void {
    if (this.readyState === CLOSED) {
      return;
    }
    const lastError = chrome.runtime.lastError;
    const reason = lastError && lastError.message ? lastError.message : 'native host disconnected';
    this.fail({ code: 1006, reason });
  }

  private fail(ev: CloseOrErrorEventLike): void {
    if (this.connectTimeoutId !== null) {
      clearTimeout(this.connectTimeoutId);
      this.connectTimeoutId = null;
    }
    console.warn('[nativeWebSocketTransport] failed', this.connectionId, ev);
    this.readyState = CLOSED;
    this.onerror?.(ev);
    this.onclose?.(ev);
    this.closePort();
  }

  private closePort(): void {
    if (this.port !== null) {
      this.port.disconnect();
      this.port = null;
    }
  }

  send(data: unknown): void {
    if (this.readyState !== OPEN || this.port === null) {
      return;
    }
    this.port.postMessage({
      command: 'wsSend',
      connectionId: this.connectionId,
      data: uint8ArrayToBase64(toUint8Array(data)),
    });
  }

  close(): void {
    if (this.readyState === CLOSED || this.readyState === CLOSING) {
      return;
    }
    this.readyState = CLOSING;
    if (this.port !== null) {
      try {
        this.port.postMessage({ command: 'wsClose', connectionId: this.connectionId });
      } catch (error) {
        // Port already gone — nothing to tell the host.
      }
    }
  }
}

// Assigned to the <rtsp-over-websocket> element's transportFactory
// property (see window.ts's initSunapiManager()) when the "Bypass
// Untrusted Certificate" checkbox is on.
//
// The `class NativeTransport extends Transport` declaration deliberately
// lives *inside* this function rather than at module top level. A class's
// `extends` clause evaluates immediately when the class statement itself
// runs — unlike a reference inside a method body (e.g. NativeWebSocketLike
// above using `chrome.runtime` and `socket` freely, or nativeSunapiClient.ts's
// own `new SunapiError(...)`), which only runs later, on some future call.
// window.js (a classic, non-deferred script) executes its top-level module
// code — including every import it pulls in, like this whole file —
// *before* legacy-globals-bridge.js (a deferred `<script type="module">`)
// has had a chance to set `window.Transport`. A top-level `class
// NativeTransport extends Transport {}` here would therefore throw
// `ReferenceError: Transport is not defined` the moment this module loads,
// aborting the rest of window.js's setup — the same failure class as
// MEMORY.md's `#broadcast`/`#usegmttime` entries, just via a class
// declaration instead of a top-level `document.getElementById(...)` call.
// Defining the class here instead means `extends Transport` only evaluates
// when this function is actually *called*, from initSunapiManager() — well
// after both deferred module scripts have finished.
export function createNativeTransportFactory(): (serverAddr: string) => unknown {
  class NativeTransport extends Transport {
    constructor(serverAddr: string) {
      super(serverAddr);
    }

    createWebSocket(serverAddr: string): WebSocketLike {
      return new NativeWebSocketLike(serverAddr);
    }
  }

  return (serverAddr: string) => new NativeTransport(serverAddr);
}
