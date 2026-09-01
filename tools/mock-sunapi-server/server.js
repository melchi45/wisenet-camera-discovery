#!/usr/bin/env node
// Mock SUNAPI HTTP server -- stands in for a real camera/NVR's stw-cgi/*
// REST interface so Playwright can exercise src/shared-v2/modules/device.ts's
// full initSunapiManager() chain (and playback.ts's calendar/overlapped-id/
// timeline search) without real hardware. See docs/window-ui/DESIGN.md's
// "Mock-SUNAPI server" section for the endpoint table this implements, and
// for why 401 Digest-auth is deliberately NOT mocked here.
//
// Endpoint paths/query-param names below are not guessed: they're read
// directly out of the vendored SDK's compiled bundle
// (node_modules/@melchi45/rtsp-over-websocket/dist/player/rtsp-over-websocket.esm.js,
// SunapiManager class) -- see that file's O1/g1/v1/ar constant maps for the
// msubmenu/action/query-param names used below.
//
// Usage: node tools/mock-sunapi-server/server.js [port]  (default 9301)

'use strict';

const http = require('http');
const { URL } = require('url');

const PORT = Number(process.argv[2]) || 9301;

const ATTRIBUTES = { Initialized: true, IsAndroid: false, SearchByUTCTime: true, MaxChannel: 1 };

// getDeviceInfo (FR-7.8.1) -- exact shape the user supplied, `Language`
// included since that's the field FR-7.8.1's language-dropdown default
// reads.
const DEVICE_INFO = {
  Model: 'TNM-C2712TDR',
  SerialNumber: 'ZV0970GW90018CD',
  FirmwareVersion: '3.09.99_20260828',
  BuildDate: '2026.08.28',
  WebURL: 'https://www.hanwhavision.com/',
  DeviceType: 'NWC',
  ConnectedMACAddress: '00:09:18:EC:07:F0',
  ISPVersion: '1.01_260825',
  CGIVersion: '2.6.9',
  ONVIFVersion: '22.12',
  DeviceName: 'Camera',
  DeviceLocation: 'Location',
  DeviceDescription: 'Description',
  Memo: 'Memo',
  Language: 'English',
  PasswordStrength: 'Strong',
  OpenSDKVersion: '5.00_250318',
  FirmwareGroup: '',
  AIModelDetectionVersion: '2.1_v1.1_20260319b_earlyfire_2c',
};

// getDynamicRulesOptions (FR-7.8.2) -- exact shape the user supplied
// (channel-0/1 entries only, enough to exercise the Rule-dropdown merge).
const DYNAMIC_RULES_OPTIONS = {
  DynamicRulesOptions: [
    {
      Channel: 0,
      EventSources: [
        {
          Type: 'AlarmInput.1', Status: 'Active', Policy: 'Property', Type_English: 'Alarm input 1',
          ActionTypes: ['AlarmOutput.1', 'SMTP', 'FTP', 'Record', 'AudioClip', 'Handover', 'MQTTPublication', 'LightAlarm'],
        },
        {
          Type: 'EarlyFireDetection', Status: 'Active', Policy: 'Property',
          Rule: [{ Rule: 1, Name: 'Name1', Policy: 'Property' }, { Rule: 2, Name: 'Name2', Policy: 'Property' }],
          Type_English: 'Early fire detection',
          ActionTypes: ['AlarmOutput.1', 'SMTP', 'FTP', 'Record', 'AudioClip', 'Handover', 'MQTTPublication', 'LightAlarm'],
        },
        {
          Type: 'MotionDetection', Status: 'Active', Policy: 'Property',
          Rule: [{ Rule: 1, Name: 'MotionRule-1', Policy: 'Property' }, { Rule: 2, Name: 'MotionRule-2', Policy: 'Property' }],
          Type_English: 'Motion detection',
          ActionTypes: ['AlarmOutput.1', 'SMTP', 'FTP', 'Record', 'AudioClip', 'Handover', 'MQTTPublication', 'LightAlarm'],
        },
      ],
      AppEventSources: [],
    },
    {
      Channel: 1,
      EventSources: [
        {
          Type: 'BoxTemperatureDetection', Status: 'Active', Policy: 'Property',
          Rule: [{ Rule: 1, Name: 'A', Policy: 'Property' }, { Rule: 2, Name: 'B', Policy: 'Property' }],
          Type_English: 'Temperature detection',
          ActionTypes: ['AlarmOutput.1', 'SMTP', 'FTP', 'Record', 'AudioClip', 'Handover', 'MQTTPublication', 'LightAlarm'],
        },
        {
          Type: 'MotionDetection', Status: 'Active', Policy: 'Property',
          Rule: [{ Rule: 1, Name: 'MotionRule-1', Policy: 'Property' }],
          Type_English: 'Motion detection',
          ActionTypes: ['AlarmOutput.1', 'SMTP', 'FTP', 'Record', 'AudioClip', 'Handover', 'MQTTPublication', 'LightAlarm'],
        },
        {
          Type: 'TemperatureDifference', Status: 'Active', Policy: 'Property',
          Rule: [{ Rule: 1, Name: 'test1', Policy: 'Property' }, { Rule: 2, Name: 'test2', Policy: 'Property' }],
          Type_English: 'Temperature difference',
          ActionTypes: ['AlarmOutput.1', 'SMTP', 'FTP', 'Record', 'AudioClip', 'Handover', 'MQTTPublication', 'LightAlarm'],
        },
      ],
      AppEventSources: [],
    },
  ],
};

// getDynamicRules (FR-7.8.2) -- exact shape the user supplied.
const DYNAMIC_RULES = {
  Rules: [
    {
      Rule: 0, RuleName: '움직임 감지 (CH1)', ScheduleName: 'Always', Duration: 60, Enable: true, Status: 'Available',
      EventSources: [{ EventSource: 0, Type: 'MotionDetection', EventName_Korean: '움직임 감지', RuleIndexType: 'Specific', RuleIndex: 1, Channel: 0, State: true }],
      EventActions: [{ EventAction: 0, Type: 'Record' }],
    },
    {
      Rule: 1, RuleName: '화재 조기 감지 (CH1)', ScheduleName: 'Always', Duration: 60, Enable: true, Status: 'Available',
      EventSources: [{ EventSource: 0, Type: 'EarlyFireDetection', EventName_Korean: '화재 조기 감지', RuleIndexType: 'Specific', RuleIndex: 1, Channel: 0, State: true }],
      EventActions: [{ EventAction: 0, Type: 'Record' }],
    },
    {
      Rule: 2, RuleName: '온도감지 (CH2)', ScheduleName: 'Always', Duration: 60, Enable: true, Status: 'Available',
      EventSources: [{ EventSource: 0, Type: 'BoxTemperatureDetection', EventName_Korean: '온도 감지', RuleIndexType: 'Specific', RuleIndex: 1, Channel: 1, State: true }],
      EventActions: [{ EventAction: 0, Type: 'Record' }],
    },
    {
      Rule: 3, RuleName: '움직임 감지 (CH2)', ScheduleName: 'Always', Duration: 60, Enable: true, Status: 'Available',
      EventSources: [{ EventSource: 0, Type: 'MotionDetection', EventName_Korean: '움직임 감지', RuleIndexType: 'Specific', RuleIndex: 1, Channel: 1, State: true }],
      EventActions: [{ EventAction: 0, Type: 'Record' }],
    },
    {
      Rule: 4, RuleName: '온도 차이 (CH2)', ScheduleName: 'Always', Duration: 60, Enable: true, Status: 'Available',
      EventSources: [{ EventSource: 0, Type: 'TemperatureDifference', EventName_Korean: '온도 차이', RuleIndexType: 'Specific', RuleIndex: 1, Channel: 1, State: true }],
      EventActions: [{ EventAction: 0, Type: 'Record' }],
    },
  ],
};

const VIDEO_SOURCES = {
  VideoSources: [
    { Channel: 0, VideoSourceToken: 'VideoSourceToken_0', SensorCaptureFrameRate: 30 },
  ],
};

const VIDEO_PROFILE_POLICIES = {
  VideoProfilePolicies: [
    { Channel: 0, DefaultProfile: 1, EventProfile: 2, RecordProfile: 1 },
  ],
};

const VIDEO_PROFILES = {
  VideoProfiles: [
    {
      Channel: 0,
      Profiles: [
        { Profile: 1, Name: 'Profile1', EncodingType: 'H265', Resolution: '1920x1080', FrameRate: 30, Bitrate: 4096 },
        { Profile: 2, Name: 'Profile2', EncodingType: 'H264', Resolution: '1280x720', FrameRate: 15, Bitrate: 2048 },
      ],
    },
  ],
};

const TIMEZONES = {
  TimeZones: [
    { TimeZone: '(GMT+09:00) Seoul, Tokyo, Osaka' },
    { TimeZone: '(GMT+00:00) London, Dublin, Lisbon' },
  ],
};

const DATE_INFO = { TimeZoneIndex: 0 };

// A handful of Normal/Event items spanning one fixed day (2026-01-15), plus
// a matching CalenderSearchResults bitmask and OverlappedIDList entry --
// enough to exercise FR-7.1/FR-7.2/FR-7.6 (search, calendar month view,
// timeline render) without needing a real recording.
const MOCK_DATE = '2026-01-15';
const CALENDAR_SEARCH_RESULTS = {
  CalenderSearchResults: {
    [MOCK_DATE]: { Result: [1] },
  },
};
const OVERLAPPED_ID_LIST = { OverlappedIDList: ['1'] };

// ~150 short back-to-back segments (motion-triggered-recording pattern),
// matching the shape a real device returned when a user reported vis.Timeline
// rendering performance problems against real (not mock) data -- a 3-item
// fixture never exercised that volume. One in ~12 is "MotionDetection" so
// both timeline groups (Normal/Event) get populated, like the real report.
//
// Anchored to `Date.now()` (computed once, at server startup -- TIMELINE
// below is a top-level const), not the fixed MOCK_DATE calendar day used
// above for CALENDAR_SEARCH_RESULTS: src/shared-v2/'s FR-7.1 default search
// requests "1 day ending now" and expects the widget's own display window
// to cover that exact range (docs/event-timeline-component/SRS.md FR-2)
// regardless of what this always-static fixture actually contains -- with
// items anchored to a real historical date (2026-01-15) that's months away
// from any real test run's "now", every item fell completely outside that
// window, compressing (or, after a later fix, entirely hiding) them rather
// than landing at realistic, clickable, non-overlapping positions. 20 hours
// back leaves margin on both ends of a 24-hour "1 day" window for the
// ~10-11 hour span this loop actually produces. Found live via Playwright
// (TC-6/TC-7/TC-8 failures right after the FR-2 `dataRange` fix landed).
// `StartTime`/`EndTime` are plain "YYYY-MM-DD HH:mm:ss" strings with no
// timezone suffix at all (matching a real device's own response format,
// confirmed against one, not guessed) -- the app's own `new Date(string)`
// calls on these (e.g. playback.ts's updateTimeline()) parse a bare,
// unsuffixed string like this as LOCAL time, not UTC (standard JS Date
// parsing behavior). Formatting via toISOString() (always UTC) and just
// stripping the 'Z' produces a string that LOOKS timezone-less but still
// carries UTC-valued digits -- reparsing it as local time silently shifts
// the actual Date by this machine's UTC offset (9h on this one), which
// only became visible once the widget's `dataStart`/`dataEnd` stopped
// being purely item-derived (`docs/event-timeline-component/SRS.md` FR-2):
// dataRange comes from a real `new Date()` (already correctly local), so
// the two ended up on inconsistent bases -- items anchored `Date.now()`
// but re-interpreted 9h earlier once round-tripped through this string,
// landing some of them before dataRange.start and rendering with a
// negative `left`, overlapping the row header. Formatting with local
// getters instead of toISOString() makes the string self-consistent with
// how the rest of the app already treats it, eliminating the skew
// entirely (not a timezone "fix" -- SUNAPI's own wire format has no
// timezone field for these regardless; this only fixes internal
// consistency within this codebase's existing string<->Date convention,
// same pattern playback.ts's own formatManualSearchTime() already uses).
// Found live via Playwright (TC-6/TC-7/TC-8 failures right after the
// dataRange fix landed).
function formatLocalSunapiTime(date) {
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function buildMockTimelineResults() {
  const results = [];
  let cursor = Date.now() - 20 * 3600_000;
  for (let i = 1; i <= 150; i += 1) {
    const durationMs = (4 * 60 + (i % 7)) * 1000; // ~4 minutes, slightly jittered
    const start = new Date(cursor);
    const end = new Date(cursor + durationMs);
    results.push({
      Result: i,
      Type: i % 12 === 0 ? 'MotionDetection' : 'Normal',
      StartTime: formatLocalSunapiTime(start),
      EndTime: formatLocalSunapiTime(end),
    });
    cursor = end.getTime() + (i % 5) * 1000; // small gap between segments
  }
  return results;
}

// Wrapped in {TimeLineSearchResults: [...]} -- confirmed against a real
// device (not guessed): src/shared/window.ts's own `.then()` callback reads
// `timeline.TimeLineSearchResults`, not the resolved value directly. An
// earlier version of this fixture returned the inner array unwrapped, which
// happened to be "consistent" with a matching bug in src/shared-v2/'s own
// first draft (both wrong the same way) -- neither side's bug was caught
// until tested against real device data. See docs/window-ui/DESIGN.md.
const TIMELINE = {
  TimeLineSearchResults: [
    { Channel: 0, Results: buildMockTimelineResults() },
  ],
};

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  });
  res.end(text);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    // CORS preflight -- the SDK's SunapiClient can set a non-simple
    // "XClient" request header, which the browser preflights before the
    // real GET; without this the whole chain fails with an opaque CORS
    // error before any endpoint below is ever reached.
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const msubmenu = url.searchParams.get('msubmenu');
  console.log('[mock-sunapi]', req.method, req.url);

  if (pathname === '/stw-cgi/attributes.cgi' || pathname === '/stw-cgi/attributes.cgi/attributes') {
    json(res, 200, ATTRIBUTES);
    return;
  }

  if (pathname === '/stw-cgi/system.cgi') {
    if (msubmenu === 'date' && url.searchParams.has('TimeZoneList')) {
      json(res, 200, TIMEZONES);
      return;
    }
    if (msubmenu === 'date') {
      json(res, 200, DATE_INFO);
      return;
    }
    if (msubmenu === 'getclientip') {
      json(res, 200, { ClientIPAddress: '127.0.0.1' });
      return;
    }
    if (msubmenu === 'deviceinfo') {
      json(res, 200, DEVICE_INFO);
      return;
    }
  }

  if (pathname === '/stw-cgi/eventrules.cgi') {
    if (msubmenu === 'dynamicrulesoptions') {
      json(res, 200, DYNAMIC_RULES_OPTIONS);
      return;
    }
    if (msubmenu === 'dynamicrules') {
      json(res, 200, DYNAMIC_RULES);
      return;
    }
  }

  if (pathname === '/stw-cgi/media.cgi') {
    if (msubmenu === 'videosource') {
      json(res, 200, VIDEO_SOURCES);
      return;
    }
    if (msubmenu === 'videoprofilepolicy') {
      json(res, 200, VIDEO_PROFILE_POLICIES);
      return;
    }
    if (msubmenu === 'videoprofile') {
      json(res, 200, VIDEO_PROFILES);
      return;
    }
  }

  if (pathname === '/stw-cgi/recording.cgi') {
    if (msubmenu === 'calendarsearch') {
      json(res, 200, CALENDAR_SEARCH_RESULTS);
      return;
    }
    if (msubmenu === 'overlapped') {
      json(res, 200, OVERLAPPED_ID_LIST);
      return;
    }
    if (msubmenu === 'timeline') {
      json(res, 200, TIMELINE);
      return;
    }
  }

  // Unmatched endpoint -- log loudly (not silently 404) so a real gap in
  // this mock's coverage is easy to spot while iterating equivalence tests,
  // per docs/window-ui/DESIGN.md's "confirmed at implementation time" note.
  console.warn('[mock-sunapi] UNMATCHED', req.method, req.url);
  json(res, 200, {});
});

server.listen(PORT, () => {
  console.log(`[mock-sunapi] listening on http://127.0.0.1:${PORT}/`);
});
