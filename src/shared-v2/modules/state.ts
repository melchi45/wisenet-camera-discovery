// Module-level state -- SRS FR-15. Every field here corresponds to a
// module-level `var` in the original src/shared/window.ts; grouped into one
// exported object instead of bare globals purely so every other module
// imports state explicitly (`import { state } from './state'`) rather than
// relying on implicit global scope -- same runtime semantics (one shared
// mutable object for the whole page's lifetime), clearer provenance.
// See docs/window-ui/SRS.md FR-15 / DESIGN.md.

import type { SwitchController } from '../../component/switch/switch';
import type { EventTimelineController } from '../../component/event-timeline/event-timeline';
import type { NativeSunapiClient } from '../../shared/scripts/nativeSunapiClient';

export interface TopologyColorEntry {
  hub: string;
  leaf: string;
}

export const TOPOLOGY_GROUP_COLORS: TopologyColorEntry[] = [
  { hub: '#e05c5c', leaf: '#f0a3a3' },
  { hub: '#4caf50', leaf: '#a3d6a5' },
  { hub: '#e0b400', leaf: '#f0d67a' },
  { hub: '#4a90d9', leaf: '#a3c8ec' },
  { hub: '#9b59b6', leaf: '#cba3d9' },
  { hub: '#e67e22', leaf: '#f0bd8a' },
];

export const TOPOLOGY_GROUP_COLUMN: { [key: string]: number } = {
  ip: 1, name: 0, mac: 2, port: 3, protocol: 5,
};

class State {
  // FR-3.1 / control-panel-data-binding.md §2
  selectedPlayerId: string | null = null;

  // FR-12.2
  useDebug = true;

  // Mirrors useDebug -- gates ONVIF Information panel appends (see
  // helpers.ts's changeonvif()).
  useOnvif = true;

  // Gates whether onmeta() (videoControl.ts) pretty-prints the raw ONVIF
  // metadata XML before appending it to #onvif_info, via helpers.ts's
  // beautifyXml(). Only affects future appends, same as useDebug/useOnvif
  // above -- not a retroactive reformat of already-appended lines.
  onvifBeautify = true;

  // FR-4.5 (control-panel-data-binding.md §3)
  deviceInformation: any = {};
  device = {
    ClientIPAddress: '127.0.0.1',
    hostname: '',
    cameraIp: '',
    port: 80,
    user: '',
    username: '',
    password: '',
    deviceType: '',
    serverType: 'grunt',
    proxy: false,
    debug: false,
    async: true,
    protocol: 'http',
  };

  // FR-7.6 (docs/event-timeline-component/)
  eventTimeline: EventTimelineController | null = null;

  // FR-7.8.2 -- last-fetched getDynamicRules() entries (populated by
  // playbackCalendar.ts's refreshEventRules()), cached here so
  // updateTimeline() (playback.ts) can resolve a Timeline result's raw
  // "Rule<N>" Type string to its configured RuleName without a second
  // fetch -- see docs/event-timeline-component/.
  dynamicRuleEntries: any[] = [];

  // FR-7.3
  timelineRangeSwitch: SwitchController | null = null;

  // FR-15.2
  private sunapiManagerInstance: any = null;
  getSunapiManager(): any {
    if (this.sunapiManagerInstance === null) {
      this.sunapiManagerInstance = new (window as any).SunapiManager();
    }
    return this.sunapiManagerInstance;
  }

  // FR-4.5 / docs/native-https-proxy/
  nativeSunapiClient: NativeSunapiClient | null = null;

  // DEVIATION from legacy behavior (see docs/window-ui/DESIGN.md): guards
  // initSunapiManager() against firing multiple overlapping chains at
  // once. Not present in the original -- every one of the many call
  // sites there (and here) only checks `!player.sunapiClient`, which
  // stays falsy until the *whole* chain (attributes -> videosource ->
  // videoprofilepolicy -> videoprofile -> timezone -> dateinfo, ~6-7
  // sequential SUNAPI round trips) finishes. Two triggers close together
  // (e.g. Search Date fired before the initial "Use SUNAPI" chain has
  // reached its own sunapiClient assignment) pass that same guard and
  // start a second full chain concurrently -- harmless on localhost/mock
  // (sub-millisecond), but each redundant chain is 6-7 real network round
  // trips against a real camera, compounding real perceived latency.
  sunapiInitInFlight = false;

  // FR-2.6 (dynamic split layout -- see docs/window-ui/DESIGN.md)
  isResizing = false;
  splitOrientation: 'row' | 'column' = 'row';
  /** #video-panel's flex-basis (%) in row (landscape) mode -- default matches
   *  the legacy fixed 30/70 split. Column mode has no equivalent ratio --
   *  #video-panel is content-sized there (split-layout.css), not
   *  percentage-driven, so #control-panel always sits flush against it. */
  rowSplitRatio = 30;

  // FR-2.1/FR-2.2
  dataSet: string[][] = [];
  discoverySortColumn = 0;
  discoverySortAscending = true;
  discoverySearchText = '';

  // FR-2.3
  discoveryViewType: 'table' | 'topology' = 'table';
  discoveryTopologyGroupBy = 'ip';
  visNetwork: any = null;

  // Browser's local GMT offset string, e.g. "+0900" -- parsed once at
  // module load, same as the original's `tz` (currently unused by any
  // FR but kept for parity since a couple of legacy call sites reference
  // it defensively; see helpers.ts).
  readonly localGmtOffset: string;

  constructor() {
    const match = /GMT([-+]?\d{4})/.exec(String(new Date()));
    this.localGmtOffset = match ? match[1] : '+0000';
  }

  getSelectedPlayer(): any {
    if (this.selectedPlayerId === null) {
      return null;
    }
    return document.getElementById(this.selectedPlayerId);
  }
}

export const state = new State();
