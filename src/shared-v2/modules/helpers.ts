// Shared helpers -- SRS FR-15. Ported 1:1 from src/shared/window.ts's own
// top-level helper functions, including their exact (sometimes odd)
// behavior -- see docs/window-ui/DESIGN.md's "Deviations from legacy
// behavior" for the short list of things intentionally NOT reproduced;
// everything else here, including quirks, is deliberate fidelity, not an
// oversight.

import { state } from './state';

/** Circular/non-enumerable-property-safe error stringifier -- JSON.stringify(error)
 *  alone yields "{}" for real Error/DOMException instances since V8 defines
 *  .message/.name/.stack as non-enumerable. */
export function errorDetails(error: any): string {
  if (error === null || typeof error !== 'object') {
    return String(error);
  }
  try {
    return JSON.stringify(error, Object.getOwnPropertyNames(error));
  } catch (e) {
    return String(error);
  }
}

/** Circular-reference-safe JSON.stringify, used throughout for debug logging. */
export function fastJsonStringfy(obj: any): string {
  const cache: any[] = [];
  const data = JSON.stringify(obj, (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (cache.indexOf(value) !== -1) {
        return undefined;
      }
      cache.push(value);
    }
    return value;
  });
  return data;
}

/** Vanilla equivalent of jQuery's `$('<tag/>', {attr: value, ...})`.
 *  `text` is special-cased to textContent; every other key becomes an
 *  HTML attribute. */
export function createEl(tag: string, attrs: { [key: string]: any }): HTMLElement {
  const el = document.createElement(tag);
  for (const key in attrs) {
    if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
    if (key === 'text') {
      el.textContent = attrs[key];
    } else {
      el.setAttribute(key, attrs[key]);
    }
  }
  return el;
}

/** Throws typed AuthErrors for missing/invalid username/password/hostname/port.
 *  Preserved exactly, including the port check's own bug: `port` is always
 *  a string (`.value`), so `Number.isInteger(port)` is always false and this
 *  branch never actually throws for a non-empty port -- see DESIGN.md (not
 *  listed as a deviation; kept as-is like every other undocumented quirk). */
export function checkUserAccount(): void {
  const username = (document.getElementById('username') as HTMLInputElement).value;
  const password = (document.getElementById('password') as HTMLInputElement).value;
  const hostname = (document.getElementById('hostname') as HTMLInputElement).value;
  const port = (document.getElementById('port') as HTMLInputElement).value;

  if (typeof username !== 'string' || username === '') {
    throw new (window as any).AuthError({
      errorCode: (window as any).fromHex('0x0402'),
      place: 'window.ts:checkUserAccount',
      message: 'Invalid User Name',
    });
  }
  if (typeof password !== 'string' || password === '') {
    throw new (window as any).AuthError({
      errorCode: (window as any).fromHex('0x0403'),
      place: 'window.ts:checkUserAccount',
      message: 'Invalid User Password',
    });
  }
  if (typeof hostname !== 'string' || hostname === '') {
    throw new (window as any).AuthError({
      errorCode: (window as any).fromHex('0x0401'),
      place: 'window.ts:checkUserAccount',
      message: 'Invalid hostname',
    });
  }
  if (port === '' || Number.isInteger(port as any)) {
    throw new (window as any).AuthError({
      errorCode: (window as any).fromHex('0x040F'),
      place: 'window.ts:checkUserAccount',
      message: 'Invalid port number',
    });
  }
}

function pad(n: number, size: number): string {
  const sign = Math.sign(n) === -1 ? '-' : '';
  return sign + new Array(size).concat([Math.abs(n)]).join('0').slice(-size);
}

/** Formats a numeric GMT offset for SUNAPI's Z-suffixed timestamps.
 *  Preserved exactly, including its asymmetry (no colon for a positive
 *  offset, a colon for zero/negative) and its always-"00"-minutes behavior
 *  (the original's own minute-detection regex matches virtually any input,
 *  so the "30" branch is effectively unreachable in practice) -- see
 *  DESIGN.md; not listed as an intentional deviation, so kept as-is. */
export function gettimezonestring(timezone: number | string): string {
  let temp = '';
  const n = timezone as number;
  temp += n >= 0 ? '+' : '';
  temp += n > 0 ? pad(Math.floor(parseFloat(String(timezone))), 2) : pad(Math.round(parseFloat(String(timezone))), 2) + ':';
  temp += /\d*.?(\w{2})?/.test(String(timezone)) ? '00' : '30';
  return temp;
}

/** `attributes` (the resolved /stw-cgi/attributes.cgi response) is either a
 *  parsed object (JSON-firmware devices) or a raw XML string -- no XML
 *  capabilities parser exists in this codebase, so this reads a single
 *  named <attribute value="..."/> out of either shape. */
export function getCapabilityValue(attributes: any, name: string): any {
  if (attributes === null || typeof attributes === 'undefined') {
    return undefined;
  }
  if (typeof attributes === 'string') {
    const match = attributes.match(new RegExp('<attribute\\s+name="' + name + '"[^>]*\\svalue="([^"]*)"'));
    return match ? match[1] : undefined;
  }
  return attributes[name];
}

/** SUNAPI's Timeline Search only honors a Z-suffixed (UTC) date on devices
 *  whose capabilities declare SearchByUTCTime=true -- disables #use_gmt
 *  (forcing it off if it was on) when the device doesn't declare support. */
export function applySearchByUTCTimeCapability(attributes: any, changeusegmt: () => void): void {
  try {
    const useGmtCheckbox = document.getElementById('use_gmt') as HTMLInputElement;
    const searchByUTCTime = getCapabilityValue(attributes, 'SearchByUTCTime');

    if (typeof searchByUTCTime === 'undefined') {
      return;
    }

    const supportsUtcSearch = searchByUTCTime === true || searchByUTCTime === 'True' || searchByUTCTime === 'true';
    useGmtCheckbox.disabled = !supportsUtcSearch;

    if (!supportsUtcSearch && useGmtCheckbox.checked) {
      useGmtCheckbox.checked = false;
      changeusegmt();
    }
  } catch (error) {
    console.error(error);
  }
}

export interface EventSubGroup {
  value: number;
  group: string;
  subgroup?: string;
  class: string;
}

/** Maps a SUNAPI event-type string to timeline group/subgroup/class metadata. */
export function checkEventSubGroup(eventType: string): EventSubGroup {
  switch (eventType.toLowerCase()) {
    case 'normal':
      return { value: 1, group: 'Normal', class: 'normal' };
    case 'motiondetection':
      return { value: 2, group: 'Event', subgroup: 'motiondetection', class: 'motiondetection' };
    case 'audiodetection':
      return { value: 3, group: 'Event', subgroup: 'audiodetection', class: 'audiodetection' };
    case 'facedetection':
      return { value: 4, group: 'Event', subgroup: 'facedetection', class: 'facedetection' };
    case 'audioanalysis':
      return { value: 5, group: 'Event', subgroup: 'audioanalysis', class: 'audioanalysis' };
    case 'videoanalysis':
      return { value: 6, group: 'Event', subgroup: 'videoanalysis', class: 'videoanalysis' };
    case 'defocusdetection':
      return { value: 7, group: 'Event', subgroup: 'defocusdetection', class: 'defocusdetection' };
    default:
      return { value: 8, group: 'Event', subgroup: 'unknown', class: 'unknown' };
  }
}

/** Same mapping for AI-specific event types (person/face/vehicle/etc.). */
export function checkAIEventSubGroup(eventType: string): EventSubGroup {
  switch (eventType.toLowerCase()) {
    case 'person':
      return { value: 1, group: 'Event', subgroup: 'person', class: 'ai' };
    case 'face':
      return { value: 2, group: 'Event', subgroup: 'face', class: 'ai' };
    case 'facerecognition':
      return { value: 3, group: 'Event', subgroup: 'facerecognition', class: 'ai' };
    case 'vehicle':
      return { value: 4, group: 'Event', subgroup: 'vehicle', class: 'ai' };
    case 'licenseplate':
      return { value: 5, group: 'Event', subgroup: 'licenseplate', class: 'ai' };
    default:
      return { value: 8, group: 'Event', subgroup: 'unknown', class: 'unknown' };
  }
}

export function scrollbottom(): void {
  const psconsole = document.getElementById('debug') as HTMLTextAreaElement | null;
  if (psconsole !== null) {
    psconsole.scrollTop = psconsole.scrollHeight - psconsole.clientHeight;
  }
}

export function scrollbottomrtsp(): void {
  const psrtsp = document.getElementById('rtsp') as HTMLTextAreaElement | null;
  if (psrtsp !== null) {
    psrtsp.scrollTop = psrtsp.scrollHeight - psrtsp.clientHeight;
  }
}

/** FR-12.3: the single choke point most player/SUNAPI handlers funnel
 *  through -- appends to #debug and scrolls, both gated on state.useDebug
 *  (scrollbottom() does NOT run when useDebug is off -- preserved exactly). */
export function changedebug(data: string): void {
  if (state.useDebug) {
    const el = document.getElementById('debug') as HTMLTextAreaElement;
    el.value = el.value + data + '\r\n';
    scrollbottom();
  }
}

/** FR-12.4: player 'rtsp' event -> #rtsp textarea. Takes the already-
 *  formatted string (the caller, onrtsp in playerEvents.ts, prepends
 *  "RTSP: " itself -- matching the original's own onrtsp/changertsp split). */
export function changertsp(data: string): void {
  const el = document.getElementById('rtsp') as HTMLTextAreaElement;
  el.value = el.value + data + '\r\n';
  scrollbottomrtsp();
}
