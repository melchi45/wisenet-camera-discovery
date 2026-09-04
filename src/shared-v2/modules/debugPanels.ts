// Debug/Discovery/RTSP disclosure panels -- SRS FR-12. See
// docs/disclosure-component/ for the mountDisclosure() component itself.

import { mountDisclosure } from '../../component/disclosure/disclosure';
import { mountSwitch } from '../../component/switch/switch';
import { state } from './state';
import { scrollbottom, scrollbottomonvif } from './helpers';

export function oncleardebug(): void {
  (document.getElementById('debug') as HTMLTextAreaElement).value = '';
  scrollbottom();
}

export function onchangeusedebug(): void {
  state.useDebug = (document.getElementById('use_debug') as HTMLInputElement).checked;
}

export function onclearonvif(): void {
  (document.getElementById('onvif_info') as HTMLTextAreaElement).value = '';
  scrollbottomonvif();
}

export function onchangeuseonvif(): void {
  state.useOnvif = (document.getElementById('use_onvif') as HTMLInputElement).checked;
}

export function onchangeonvifbeautify(): void {
  state.onvifBeautify = (document.getElementById('onvif_beautify') as HTMLInputElement).checked;
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

  (document.getElementById('onvif_info') as HTMLTextAreaElement).addEventListener('input', function (this: HTMLTextAreaElement) {
    if (this.value.length > this.maxLength) {
      this.value = this.value.substring(0, this.maxLength);
    }
  });

  document.getElementById('clear_onvif')!.addEventListener('click', onclearonvif);
  (document.getElementById('use_onvif') as HTMLInputElement).checked = true;
  document.getElementById('use_onvif')!.addEventListener('change', onchangeuseonvif);

  (document.getElementById('onvif_beautify') as HTMLInputElement).checked = true;
  document.getElementById('onvif_beautify')!.addEventListener('change', onchangeonvifbeautify);
  mountSwitch({
    containerId: 'onvif_beautify_toggle',
    variant: 'segmented',
    options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }],
  });

  mountDisclosure({
    containerId: 'debug_disclosure',
    defaultOpen: false,
    headerCheckboxId: 'use_debug',
    headerButtonId: 'clear_debug',
  });
  mountDisclosure({ containerId: 'discovery_disclosure', defaultOpen: false });
  mountDisclosure({ containerId: 'rtsp_disclosure', defaultOpen: false });
  mountDisclosure({
    containerId: 'onvif_disclosure',
    defaultOpen: false,
    headerCheckboxId: 'use_onvif',
    headerButtonId: 'clear_onvif',
  });
}
