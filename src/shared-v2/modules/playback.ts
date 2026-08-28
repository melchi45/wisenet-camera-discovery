// Playback -- SRS FR-7. Manual time range / 1 Day-3 Month toggle:
// docs/architecture.md's "Playback controls" section is the full narrative
// spec (this is the direct implementation). Search Overlapped Id / Search
// Date / the vis.Timeline render are specified here directly (not
// previously documented elsewhere).

import moment from 'moment';
import * as vis from 'vis';
import { mountSwitch, SwitchController } from '../../component/switch/switch';
import { state } from './state';
import { changedebug, fastJsonStringfy, gettimezonestring, checkEventSubGroup } from './helpers';
import { initSunapiManager } from './device';

declare var SunapiError: any;
declare var RTSPOverWebSocketBaseError: any;
declare var RTSPOverWebSocketPlayState: any;
declare var HTTP_STATUS_CODES: any;

let timelineRangeSwitch: SwitchController | null = null;

// Shared, module-level `pad` helper -- only ever ASSIGNED inside
// search_date() below and READ inside ontimestamp()'s 'playback' branch,
// exactly matching the original's own fragile "global reassigned by one
// handler, read by another" pattern (var pad: any; assigned inside
// search_date). Preserved as-is: in normal usage a timeline search always
// precedes playback, so ontimestamp's read is not reached first in
// practice, but this is not defensively fixed here -- see docs/window-ui/
// DESIGN.md (not listed as an intentional deviation).
let pad: ((val: any, len?: number) => string) | undefined;

// ---------------------------------------------------------------------
// FR-7.1
// ---------------------------------------------------------------------
export function search_overlapped_id(): void {
  try {
    if (!state.getSelectedPlayer().sunapiClient) {
      initSunapiManager();
    }

    const startDate = (document.getElementById('start_date') as HTMLInputElement).value;
    const endDate = (document.getElementById('end_date') as HTMLInputElement).value;

    let strSearchStartTime = startDate + ' 00:00:00';
    let strSearchEndTime = endDate + ' 23:59:59';

    if ((document.getElementById('use_gmt') as HTMLInputElement).checked) {
      const timezone = gettimezonestring((document.getElementById('timezone') as HTMLInputElement).value);
      strSearchStartTime = moment(strSearchStartTime).utcOffset(timezone).format('YYYY-MM-DD[T]HH:mm:ss[Z]');
      strSearchEndTime = moment(strSearchEndTime).utcOffset(timezone).format('YYYY-MM-DD[T]HH:mm:ss[Z]');
    }

    let overlappedIDList: Promise<any>;
    if (state.getSelectedPlayer().device === 'camera' && Number(state.deviceInformation.attributes.MaxChannel) === 1) {
      overlappedIDList = state.getSunapiManager().getOverlappedIdList(strSearchStartTime, strSearchEndTime);
    } else {
      overlappedIDList = state.getSunapiManager().getOverlappedIdList(strSearchStartTime, strSearchEndTime, Number(state.getSelectedPlayer().channel) - 1);
    }

    overlappedIDList
      .then((overlapped_id_list: any) => {
        document.getElementById('overlapped_id')?.remove();
        document.getElementById('overlapped_id_span')?.remove();

        if (typeof overlapped_id_list.OverlappedIDList !== 'undefined' && overlapped_id_list.OverlappedIDList.length > 0) {
          const span = document.createElement('span');
          span.id = 'overlapped_id_span';
          span.innerHTML = 'Overlapped Id:';
          document.getElementById('overlapped_id_area')!.append(span);

          const selectbox = document.createElement('select');
          selectbox.id = 'overlapped_id';
          // Original assigns `.style = "..."` (the CSSOM setter, which
          // re-serializes/normalizes the string, e.g. "width: 50px; ...")
          // -- not setAttribute('style', ...) (raw attribute text,
          // preserved verbatim). `.style.cssText =` is the vanilla
          // equivalent that goes through the same CSSOM parse/serialize
          // path, matching the resulting attribute text exactly.
          selectbox.style.cssText = 'width:50px;margin-left: 5px;';
          for (let i = overlapped_id_list.OverlappedIDList.length - 1; i >= 0; i--) {
            const opt = overlapped_id_list.OverlappedIDList[i];
            const el = document.createElement('option');
            el.textContent = opt;
            el.value = opt;
            selectbox.appendChild(el);
          }
          document.getElementById('overlapped_id_area')!.append(selectbox);

          state.getSelectedPlayer().overlappedId = (document.getElementById('overlapped_id') as HTMLSelectElement).value;
          (document.getElementById('search_aitimeline') as HTMLButtonElement).disabled = false;
        }
      })
      .catch((error: any) => {
        if (error instanceof SunapiError) {
          (window as any).popup('<div><h4>getOverlappedIdList error: ' + error.errorCode + '<br>message: ' + error.message + '<br>URI: ' + error.uri + '</h4></div>');
        } else if (error instanceof RTSPOverWebSocketBaseError) {
          (window as any).popup('<div><h4>getOverlappedIdList error: ' + error.errorCode + '<br>message: ' + error.message + '</h4></div>');
        }
      });
  } catch (error) {
    console.error(error);
  }
}

// ---------------------------------------------------------------------
// FR-7.2
// ---------------------------------------------------------------------
export function search_date(): void {
  try {
    if (!state.getSelectedPlayer().sunapiClient) {
      initSunapiManager();
    }

    const startDate = (document.getElementById('start_date') as HTMLInputElement).value;
    const startTime = (document.getElementById('start_time') as HTMLInputElement).value;
    const endDate = (document.getElementById('end_date') as HTMLInputElement).value;
    const endTime = (document.getElementById('end_time') as HTMLInputElement).value;

    let strSearchStartTime = startDate + ' ' + startTime;
    const strSearchEndTime = endDate + ' ' + endTime;

    if ((document.getElementById('use_gmt') as HTMLInputElement).checked) {
      const timezone = gettimezonestring((document.getElementById('timezone') as HTMLInputElement).value);
      strSearchStartTime = moment(strSearchStartTime).utcOffset(timezone).format('YYYY-MM-DD[T]HH:mm:ss[Z]');
      moment(strSearchEndTime).utcOffset(timezone).format('YYYY-MM-DD[T]HH:mm:ss[Z]');
    }

    let requestPromise: Promise<any>;
    if (state.getSelectedPlayer().device === 'camera') {
      if (Number(state.getSelectedPlayer().channel) !== null) {
        requestPromise = state.getSunapiManager().getCalendarSearch(strSearchStartTime, Number(state.getSelectedPlayer().channel) - 1);
      } else {
        requestPromise = state.getSunapiManager().getCalendarSearch(strSearchStartTime);
      }
    } else {
      requestPromise = state.getSunapiManager().getCalendarSearch(strSearchStartTime, Number(state.getSelectedPlayer().channel) - 1);
    }

    requestPromise
      .then((calendar: any) => {
        for (const dates in calendar.CalenderSearchResults) {
          if (calendar.CalenderSearchResults[dates].Result !== 'undefined') {
            const recordedDates: number[] = [];
            const record_dates: any[] = Array.from(calendar.CalenderSearchResults[dates].Result);

            for (let i = 0; i < record_dates.length; i++) {
              if (parseInt(record_dates[i]) === 1) {
                recordedDates.push(i + 1);
              }
            }

            pad = function (val: any, len?: number): string {
              val = String(val);
              len = len || 2;
              while (val.length < len) val = '0' + val;
              return val;
            };

            const startDateValue = (document.getElementById('start_date') as HTMLInputElement).value;
            const year = pad(new Date(startDateValue).getFullYear(), 4);
            const month = pad(new Date(startDateValue).getMonth() + 1, 2);
            let day: string;
            let min: string | undefined, max: string | undefined;

            if (recordedDates.length < 1) {
              day = pad(new Date(startDateValue).getDate(), 2);
            } else {
              day = pad(new Date(startDateValue).getDate(), 2);
              max = pad(Math.max.apply(Math, recordedDates), 2);
              min = pad(Math.min.apply(Math, recordedDates), 2);
            }

            (document.getElementById('start_date') as HTMLInputElement).value = [year, month, min].join('-');
            (document.getElementById('end_date') as HTMLInputElement).value = [year, month, max].join('-');

            (document.getElementById('start_date') as HTMLInputElement).min = [year, month, min].join('-');
            (document.getElementById('start_date') as HTMLInputElement).max = [year, month, max].join('-');
            (document.getElementById('end_date') as HTMLInputElement).min = [year, month, min].join('-');
            (document.getElementById('end_date') as HTMLInputElement).max = [year, month, max].join('-');

            (document.getElementById('search_timeline') as HTMLButtonElement).disabled = false;
          }
        }
      })
      .catch((error: any) => {
        console.error('getTimeline error: ', fastJsonStringfy(error));
      });
  } catch (error) {
    console.error(error);
  }
}

// ---------------------------------------------------------------------
// FR-7.3
// ---------------------------------------------------------------------
function runTimelineSearch(strSearchStartTime: string, strSearchEndTime: string): void {
  try {
    if (!state.getSelectedPlayer().sunapiClient) {
      initSunapiManager();
    }

    if (document.getElementById('timeline_picker') !== null) {
      document.getElementById('timeline_picker')!.remove();
    }

    if ((document.getElementById('use_gmt') as HTMLInputElement).checked) {
      const timezone = gettimezonestring((document.getElementById('timezone') as HTMLInputElement).value);
      strSearchStartTime = moment(strSearchStartTime).utcOffset(timezone).format('YYYY-MM-DD[T]HH:mm:ss[Z]');
      strSearchEndTime = moment(strSearchEndTime).utcOffset(timezone).format('YYYY-MM-DD[T]HH:mm:ss[Z]');
    }

    let requestPromise: Promise<any>;
    if (state.getSelectedPlayer().device === 'camera') {
      const overlappedIdEl = document.getElementById('overlapped_id') as HTMLSelectElement | null;
      if (overlappedIdEl !== null) {
        requestPromise = state.getSunapiManager().getTimeline(
          strSearchStartTime, strSearchEndTime, Number(state.getSelectedPlayer().channel) - 1, overlappedIdEl.value,
        );
      } else {
        requestPromise = state.getSunapiManager().getTimeline(
          strSearchStartTime, strSearchEndTime, Number(state.getSelectedPlayer().channel) - 1,
        );
      }
    } else {
      requestPromise = state.getSunapiManager().getTimeline(strSearchStartTime, strSearchEndTime);
    }

    requestPromise
      .then((timeline: any) => {
        // FIX (fidelity bug, not a deviation): the real device wraps the
        // timeline response as {TimeLineSearchResults: [...]} -- the
        // vendored SDK's getTimeline() has no `extract` option, so the
        // promise resolves with that wrapper object as-is, not the inner
        // array directly. An earlier draft of this port passed the
        // wrapper itself to updateTimeline(), which reads `results.length`
        // -- undefined on a plain object, so it silently did nothing
        // against a real device (never reproduced against
        // tools/mock-sunapi-server/, whose fixture wasn't wrapped either,
        // so nothing caught this in equivalence testing). Matches the
        // original's own `timeline.TimeLineSearchResults` access exactly.
        if (typeof timeline !== 'undefined') {
          updateTimeline(timeline.TimeLineSearchResults);
          (document.getElementById('timeline') as HTMLElement).style.display = 'block';
        } else {
          throw new Error((timeline as any).Error.Details);
        }
      })
      .catch((error: any) => {
        if (typeof error === 'number') {
          console.error('Http Error: ' + HTTP_STATUS_CODES[error]);
        } else {
          console.error('getTimeline error: ', fastJsonStringfy(error));
        }
      });
  } catch (error) {
    console.error(error);
  }
}

export function search_oneday_timeline(): void {
  try {
    const startDate = (document.getElementById('start_date') as HTMLInputElement).value;
    const startTime = (document.getElementById('start_time') as HTMLInputElement).value;
    const endDate = (document.getElementById('end_date') as HTMLInputElement).value;
    const endTime = (document.getElementById('end_time') as HTMLInputElement).value;
    runTimelineSearch(startDate + ' ' + startTime, endDate + ' ' + endTime);
  } catch (error) {
    console.error(error);
  }
}

export function search_three_month_timeline(): void {
  try {
    const startDate = (document.getElementById('start_date') as HTMLInputElement).value;
    const startTime = (document.getElementById('start_time') as HTMLInputElement).value;
    const strSearchStartTime = startDate + ' ' + startTime;
    const strSearchEndTime = moment(strSearchStartTime).add(3, 'months').format('YYYY-MM-DD HH:mm:ss');
    runTimelineSearch(strSearchStartTime, strSearchEndTime);
  } catch (error) {
    console.error(error);
  }
}

export function search_timeline_by_range(): void {
  try {
    if (timelineRangeSwitch!.getValue() === 'threemonth') {
      search_three_month_timeline();
    } else {
      search_oneday_timeline();
    }
  } catch (error) {
    console.error(error);
  }
}

// ---------------------------------------------------------------------
// FR-7.4: Manual Start/End Time.
// ---------------------------------------------------------------------
export function onchangestarttime(): void {
  try {
    const startDate = (document.getElementById('start_date') as HTMLInputElement).value;
    const startTime = (document.getElementById('start_time') as HTMLInputElement).value;
    state.getSelectedPlayer().startTime = startDate + 'T' + startTime + 'Z';
  } catch (error) {
    console.error(error);
  }
}

export function onchangeendtime(): void {
  try {
    const endDate = (document.getElementById('end_date') as HTMLInputElement).value;
    const endTime = (document.getElementById('end_time') as HTMLInputElement).value;
    state.getSelectedPlayer().endTime = endDate + 'T' + endTime + 'Z';
  } catch (error) {
    console.error(error);
  }
}

export function onchangesupportendtime(): void {
  try {
    const checked = (document.getElementById('support_end_time') as HTMLInputElement).checked;
    (document.getElementById('manual_end_time_group') as HTMLElement).style.display = checked ? '' : 'none';
    if (checked) {
      onchangeendtime();
    } else {
      state.getSelectedPlayer().endTime = null;
    }
  } catch (error) {
    console.error(error);
  }
}

export function changespeed(): void {
  try {
    state.getSelectedPlayer().playSpeed = (document.getElementById('speed') as HTMLSelectElement).value;
  } catch (error) {
    console.error(error);
  }
}

// ---------------------------------------------------------------------
// FR-7.6: the vis.Timeline render.
// ---------------------------------------------------------------------
function updateTimeline(results: any): void {
  if (results.length > 0 && results[0].Results.length > 0) {
    (document.getElementById('timeline') as HTMLElement).innerHTML = '';
    const container = document.getElementById('timeline')!;

    const groups = new (vis as any).DataSet([
      { content: 'Normal', id: 'Normal' },
      {
        content: 'Event', id: 'Event', value: 2,
        subgroupVisibility: {
          motiondetection: true, audiodetection: true, facedetection: true,
          audioanalysis: true, videoanalysis: true, defocusdetection: true, unknown: true,
        },
      },
    ]);

    const options: any = {
      moment: (date: any) => {
        if (!(document.getElementById('use_gmt') as HTMLInputElement).checked) {
          const timezone = gettimezonestring((document.getElementById('timezone') as HTMLInputElement).value);
          return (vis as any).moment(date).utcOffset(timezone);
        } else {
          return (vis as any).moment(date).utcOffset(state.localGmtOffset);
        }
      },
      groupOrder: (a: any, b: any) => a.value - b.value,
      groupOrderSwap: (a: any, b: any) => {
        const v = a.value;
        a.value = b.value;
        b.value = v;
      },
      groupTemplate: (group: any) => {
        const container2 = document.createElement('div');
        container2.className = 'timeline-group-label';
        const label = document.createElement('span');
        label.className = 'timeline-group-label-text';
        label.innerHTML = group.content;
        container2.insertAdjacentElement('afterbegin', label);
        const hide = document.createElement('button');
        hide.className = 'timeline-group-hide-btn';
        hide.innerHTML = 'Hide';
        hide.addEventListener('click', () => {
          groups.update({ id: group.id, visible: false });
        });
        container2.insertAdjacentElement('beforeend', hide);
        return container2;
      },
      orientation: 'bottom',
      editable: { overrideItems: true },
      groupEditable: true,
      showCurrentTime: true,
      selectable: true,
      multiselect: true,
      showTooltips: true,
      stack: false,
      stackSubgroups: false,
      margin: { item: 1, axis: 1 },
      start: new Date().setHours(0, 0, 0, 0),
      end: new Date().setHours(23, 59, 59, 999),
      maxHeight: '100px',
      showMajorLabels: false,
      showMinorLabels: true,
    };
    // Matches the original exactly: passing the plain `options` object
    // (not an array of items) to `new vis.DataSet(...)` -- vis treats a
    // non-array first argument as its own constructor options, so this
    // starts as an empty DataSet; the forEach below populates it via
    // .add(). Confirmed harmless (not a crash) rather than "fixed" --
    // see docs/window-ui/DESIGN.md.
    const items = new (vis as any).DataSet(options);

    results[0].Results.forEach((timeline_element: any) => {
      try {
        const start = new Date(timeline_element.StartTime);
        const end = new Date(timeline_element.EndTime);
        const type = checkEventSubGroup(timeline_element.Type);
        const data: any = {
          id: timeline_element.Result,
          content: timeline_element.Type,
          start,
          end,
          group: type.group,
        };
        if (typeof type.subgroup !== 'undefined' && type.subgroup !== null) {
          data.subgroup = type.subgroup;
        }
        if (typeof type.class !== 'undefined' && type.class !== null) {
          data.className = type.class;
        }
        items.add(data);
      } catch (error) {
        console.error(error);
      }
    });

    state.visTimeline = new (vis as any).Timeline(container);
    state.visTimeline.setOptions(options);
    state.visTimeline.setGroups(groups);
    state.visTimeline.setItems(items);

    const itemMin = state.visTimeline.getItemRange().min;

    let today: any;
    if (!(document.getElementById('use_gmt') as HTMLInputElement).checked) {
      // #usegmttime has no corresponding element in window.html -- same
      // pre-existing dead reference as session.ts's guarded use of it.
      const usegmttimeEl = document.querySelector('select[id="usegmttime"]') as HTMLSelectElement | null;
      if (usegmttimeEl !== null) {
        let temp = '';
        temp += parseFloat(usegmttimeEl.value) > 0 ? '+' : '';
        temp += pad!(parseFloat(usegmttimeEl.value), 2) + ':00';
        today = (vis as any).moment(itemMin).utcOffset(temp);
      } else {
        today = (vis as any).moment(itemMin);
      }
    } else {
      today = (vis as any).moment(itemMin).utc();
    }

    state.visTimeline.addCustomTime(today);

    state.visTimeline.on('click', (properties: any) => {
      state.visTimeline.setSelection(properties.item);
    });

    state.visTimeline.on('doubleClick', (properties: any) => {
      state.visTimeline.setSelection(properties.item);
      if (state.getSelectedPlayer().readyState === RTSPOverWebSocketPlayState.PLAYING) {
        if (!(document.getElementById('use_gmt') as HTMLInputElement).checked) {
          if (state.getSelectedPlayer().device === 'camera') {
            state.getSelectedPlayer().seekingTime = moment(properties.time).utcOffset(state.localGmtOffset).format('YYYY-MM-DD[T]HH:mm:ss') + 'Z';
          }
        } else if ((document.getElementById('use_gmt') as HTMLInputElement).checked) {
          state.getSelectedPlayer().seekingTime = new Date(properties.time).toISOString();
        }
      }
    });

    state.visTimeline.on('hoverNode', () => {
      // changedebug-only in the original (and buggy there too -- logs the
      // global `event`, not its own callback arg; preserved as a no-op
      // here since it has no observable effect either way).
    });

    state.visTimeline.on('select', (properties: any) => {
      try {
        if (state.getSelectedPlayer().readyState === RTSPOverWebSocketPlayState.PLAYING) {
          return;
        }

        const item = items.get(properties.items);
        if (item.length > 0) {
          const group = groups.get(item[0].group).id;

          const startDateControl = document.querySelector('input[id="start_date"]') as HTMLInputElement | null;
          const startTimeControl = document.querySelector('input[id="start_time"]') as HTMLInputElement | null;
          const endDateControl = document.querySelector('input[id="end_date"]') as HTMLInputElement | null;
          const endTimeControl = document.querySelector('input[id="end_time"]') as HTMLInputElement | null;

          if (
            startDateControl !== null && startTimeControl !== null && endDateControl !== null && endTimeControl !== null &&
            typeof item[0].start !== 'undefined' && typeof item[0].end !== 'undefined' &&
            item[0].start !== null && item[0].end !== null
          ) {
            const player = state.getSelectedPlayer();
            if (typeof item[0].start === 'string' && typeof item[0].end === 'string') {
              if (!(document.getElementById('use_gmt') as HTMLInputElement).checked) {
                const timezoneMs = player.GMT * 3600 * 1000;
                startDateControl.value = new Date(item[0].start).toISOString().split('T')[0];
                startTimeControl.value = new Date(item[0].start).toISOString().split('T')[1].replace(/Z/gi, '');
                player.startTime = new Date(new Date(item[0].start).getTime() + timezoneMs).toISOString();

                if (group.toLowerCase() !== 'normal') {
                  endDateControl.value = new Date(item[0].end).toISOString().split('T')[0];
                  endTimeControl.value = new Date(item[0].end).toISOString().split('T')[1].replace(/Z/gi, '');
                  player.endTime = new Date(new Date(item[0].end).getTime() + timezoneMs).toISOString();
                  endDateControl.disabled = false;
                  endTimeControl.disabled = false;
                } else {
                  player.endTime = null;
                  endDateControl.disabled = true;
                  endTimeControl.disabled = true;
                }
              } else {
                startDateControl.value = new Date(item[0].start).toISOString().split('T')[0];
                startTimeControl.value = new Date(item[0].start).toISOString().split('T')[1].replace(/Z/gi, '');
                player.startTime = new Date(item[0].start).toISOString();

                if (group.toLowerCase() !== 'normal') {
                  endDateControl.value = new Date(item[0].end).toISOString().split('T')[0];
                  endTimeControl.value = new Date(item[0].end).toISOString().split('T')[1].replace(/Z/gi, '');
                  player.endTime = new Date(item[0].end).toISOString();
                  endDateControl.disabled = false;
                  endTimeControl.disabled = false;
                } else {
                  player.endTime = null;
                  endDateControl.disabled = true;
                  endTimeControl.disabled = true;
                }
              }
            } else {
              // item[0].start/end are Date objects (not strings) --
              // camera vs. non-camera branches, GMT vs. local.
              const useGmt = (document.getElementById('use_gmt') as HTMLInputElement).checked;
              if (player.device === 'camera') {
                player.startTime = moment(item[0].start).utcOffset(state.localGmtOffset).format('YYYY-MM-DD[T]HH:mm:ss') + 'Z';
              } else {
                player.startTime = item[0].start.toISOString();
              }
              if (group.toLowerCase() !== 'normal') {
                if (player.device === 'camera') {
                  player.endTime = moment(item[0].end).utcOffset(state.localGmtOffset).format('YYYY-MM-DD[T]HH:mm:ss') + 'Z';
                } else {
                  player.endTime = item[0].end.toISOString();
                }
              } else {
                player.endTime = null;
                endDateControl.disabled = true;
                endTimeControl.disabled = true;
              }
              startDateControl.value = player.startTime.split('T')[0];
              startTimeControl.value = player.startTime.split('T')[1].replace(/Z/gi, '');
              if (player.endTime !== null) {
                endDateControl.value = player.endTime.split('T')[0];
                endTimeControl.value = player.endTime.split('T')[1].replace(/Z/gi, '');
              }
              void useGmt; // both branches above are identical regardless of useGmt, matching the original
            }
          }
        }
      } catch (error) {
        // Was previously unguarded in the original; a real "start time is
        // empty" (0x0411) report traced back to an unhandled exception
        // here. Guarded there already -- kept guarded here too (not a
        // deviation, this fix is already part of the behavior being
        // matched).
        console.error('timeline select error:', error);
      }
    });
  } else {
    (window as any).popup('Result is empty' + fastJsonStringfy(results));
  }
}

/** FR-7.7. */
export function ontimestamp(timestamp: any): void {
  const elementPlayer = state.getSelectedPlayer();
  try {
    switch (timestamp.detail.mode) {
      case 'live': {
        if (document.getElementById('timestamp_date') === null) {
          const dateInput = document.createElement('input');
          dateInput.id = 'timestamp_date';
          dateInput.type = 'date';
          dateInput.setAttribute('style', 'min-width: 100px;width: 100px !important;');
          document.getElementById('live_control')!.append(dateInput);

          const timeInput = document.createElement('input');
          timeInput.id = 'timestamp_time';
          timeInput.type = 'time';
          timeInput.step = '0.001';
          timeInput.min = '00:00:00.000';
          timeInput.max = '23:59:59.999';
          timeInput.setAttribute('style', 'min-width: 130px;width: 100px !important;');
          document.getElementById('live_control')!.append(timeInput);

          (document.getElementById('timestamp_date') as HTMLInputElement).disabled = true;
          (document.getElementById('timestamp_time') as HTMLInputElement).disabled = true;
        }

        if (timestamp.detail.local !== undefined && timestamp.detail.local !== null) {
          (document.getElementById('timestamp_date') as HTMLInputElement).value = new Date(timestamp.detail.local).toISOString().split('T')[0];
          (document.getElementById('timestamp_time') as HTMLInputElement).value = new Date(timestamp.detail.local).toISOString().split('T')[1].replace(/Z/gi, '');
        } else {
          (document.getElementById('timestamp_date') as HTMLInputElement).value = new Date(timestamp.detail.timestamp).toISOString().split('T')[0];
          (document.getElementById('timestamp_time') as HTMLInputElement).value = new Date(timestamp.detail.timestamp).toISOString().split('T')[1].replace(/Z/gi, '');
        }
        break;
      }
      case 'playback': {
        if (timestamp.detail.local !== undefined && timestamp.detail.local !== null) {
          (document.getElementById('seeking_date') as HTMLInputElement).value = new Date(timestamp.detail.local).toISOString().split('T')[0];
          (document.getElementById('seeking_time') as HTMLInputElement).value = new Date(timestamp.detail.local).toISOString().split('T')[1].replace(/Z/gi, '');
        } else {
          (document.getElementById('seeking_date') as HTMLInputElement).value = new Date(timestamp.detail.timestamp).toISOString().split('T')[0];
          (document.getElementById('seeking_time') as HTMLInputElement).value = new Date(timestamp.detail.timestamp).toISOString().split('T')[1].replace(/Z/gi, '');
        }

        let currentTimeBar: any;
        if ((document.getElementById('use_gmt') as HTMLInputElement).checked) {
          let temp = '';
          temp += timestamp.detail.timezone > 0 ? '+' : '';
          temp += pad!(timestamp.detail.timezone / 60, 2) + ':00';
          currentTimeBar = (vis as any).moment(timestamp.detail.timestamp).utcOffset(temp);
        } else {
          if (elementPlayer.device === 'camera') {
            currentTimeBar = (vis as any).moment(timestamp.detail.local).utc();
          } else {
            currentTimeBar = (vis as any).moment(timestamp.detail.timestamp).utc();
          }
        }

        if (typeof state.visTimeline !== 'undefined' && state.visTimeline !== null) {
          state.visTimeline.setCustomTime(currentTimeBar);
        }
        break;
      }
    }
  } catch (error) {
    console.error(error);
  }
}

export function setupPlayback(): void {
  // FR-15's original startup block (window.ts ~L380-414): #start_date/
  // #end_date/#seeking_date default to today's date, overriding the
  // static "2019-09-07"/"2018-07-22" HTML placeholders.
  const today = new Date();
  const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  (document.getElementById('start_date') as HTMLInputElement).value = todayStr;
  (document.getElementById('end_date') as HTMLInputElement).value = todayStr;
  (document.getElementById('seeking_date') as HTMLInputElement).value = todayStr;
  // #search_aitimeline is a known dead control (SRS "Known dead controls")
  // -- stays disabled forever, same as the original.
  (document.getElementById('search_aitimeline') as HTMLButtonElement).disabled = true;

  document.getElementById('search_overlapped_id')!.addEventListener('click', search_overlapped_id);
  document.getElementById('search_date')!.addEventListener('click', search_date);

  timelineRangeSwitch = mountSwitch({
    containerId: 'search_timeline_range_toggle',
    variant: 'segmented',
    options: [{ value: 'oneday', label: '1 Day' }, { value: 'threemonth', label: '3 Month' }],
  });
  document.getElementById('search_timeline')!.addEventListener('click', search_timeline_by_range);
  (document.getElementById('search_timeline') as HTMLButtonElement).disabled = true;

  document.getElementById('start_apply')!.addEventListener('click', onchangestarttime);
  document.getElementById('start_date')!.addEventListener('change', onchangestarttime);
  document.getElementById('start_time')!.addEventListener('change', onchangestarttime);

  document.getElementById('end_apply')!.addEventListener('click', onchangeendtime);
  document.getElementById('end_date')!.addEventListener('change', onchangeendtime);
  document.getElementById('end_time')!.addEventListener('change', onchangeendtime);

  document.getElementById('support_end_time')!.addEventListener('change', onchangesupportendtime);

  document.getElementById('speed')!.addEventListener('change', changespeed);
  (document.getElementById('speed') as HTMLSelectElement).disabled = true;

  (document.getElementById('forward') as HTMLButtonElement).disabled = true;
  (document.getElementById('backward') as HTMLButtonElement).disabled = true;
}
