// Debug/Discovery/RTSP disclosure panels -- SRS FR-12. See
// docs/disclosure-component/ for the mountDisclosure() component itself.

import { mountDisclosure } from '../../component/disclosure/disclosure';
import { state } from './state';
import { scrollbottom } from './helpers';

export function oncleardebug(): void {
  (document.getElementById('debug') as HTMLTextAreaElement).value = '';
  scrollbottom();
}

export function onchangeusedebug(): void {
  state.useDebug = (document.getElementById('use_debug') as HTMLInputElement).checked;
}

export function setupDebugPanels(): void {
  (document.getElementById('debug') as HTMLTextAreaElement).addEventListener('input', function (this: HTMLTextAreaElement) {
    if (this.value.length > this.maxLength) {
      this.value = this.value.substring(0, this.maxLength);
    }
  });

  document.getElementById('clear_debug')!.addEventListener('click', oncleardebug);
  (document.getElementById('use_debug') as HTMLInputElement).checked = true;
  document.getElementById('use_debug')!.addEventListener('change', onchangeusedebug);

  mountDisclosure({
    containerId: 'debug_disclosure',
    defaultOpen: false,
    headerCheckboxId: 'use_debug',
    headerButtonId: 'clear_debug',
  });
  mountDisclosure({ containerId: 'discovery_disclosure', defaultOpen: false });
  mountDisclosure({ containerId: 'rtsp_disclosure', defaultOpen: false });
}
