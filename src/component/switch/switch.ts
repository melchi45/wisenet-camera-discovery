// Reusable switch/toggle component -- see docs/switch-component/ (MRD/PRD/SRS/
// DESIGN/TC) for the full functional spec, design, and style reference.
//
// Progressively enhances EXISTING markup in place (same philosophy the
// shared-window UI's old segmentedToggle.ts used for its one checkbox-only
// case): it never generates a native <input>/<button> from scratch, only
// wraps whatever is already inside `containerId` with the visual pill/slider
// markup and a uniform get/set/onChange API. This means every pre-existing
// `document.getElementById(id).checked` / `querySelector(...):checked` /
// `classList.contains("active")` call site in window.ts keeps working
// completely unchanged after mounting -- mountSwitch only adds sibling
// label/knob elements and CSS classes, it never replaces or removes the
// original input(s)/button(s) or their ids/names/values.

export interface SwitchOptionConfig {
  /** For a checkbox target: options[0] = unchecked, options[1] = checked.
   *  For a radio-group target: must match one radio's `value` attribute.
   *  For a button-group target: must match one button's `data-value`. */
  value: string;
  /** Visible text. Ignored (but still used as the accessible name) when `dot` is true. */
  label?: string;
  /** Render a colored dot instead of the label text. */
  dot?: boolean;
  /** CSS color for the dot; defaults to var(--accent). Ignored unless `dot` is true. */
  dotColor?: string;
}

export type SwitchVariant = 'slider' | 'segmented';

export interface MountSwitchOptions {
  /** id of the EXISTING wrapper element in the page that already contains
   *  either one <input type="checkbox">, 2+ <input type="radio"> sharing a
   *  `name`, or 2+ <button> elements (each needing a `data-value` attribute
   *  matching one of `options[].value`). */
  containerId: string;
  /** 'slider' = classic iOS on/off knob -- checkbox targets only, exactly 2
   *  options. 'segmented' = pill selector, every other case. Default: 'segmented'. */
  variant?: SwitchVariant;
  /** 2 entries = On|Off or Text1|Text2; 3+ = an N-way switch. */
  options: SwitchOptionConfig[];
  /** Fires on user interaction (native 'change'/'click'), not on setValue(). */
  onChange?: (value: string) => void;
}

export interface SwitchController {
  getValue(): string;
  /** Sets the underlying input's state directly; does not fire onChange, same
   *  as assigning `.checked`/`.value` on a native input never fires 'change'. */
  setValue(value: string): void;
  /** Best-effort: clears the mounted guard. No listener teardown is performed
   *  since nothing in this codebase currently unmounts a switch. */
  destroy(): void;
}

function renderOptionContent(el: HTMLElement, option: SwitchOptionConfig, fallbackText: string): void {
  el.textContent = '';
  if (option.dot === true) {
    const dot = document.createElement('span');
    dot.className = 'ws-switch-dot';
    dot.style.setProperty('--ws-switch-dot-color', option.dotColor ?? 'var(--accent)');
    const accessibleName = option.label ?? fallbackText;
    dot.setAttribute('aria-label', accessibleName);
    dot.title = accessibleName;
    el.appendChild(dot);
  } else {
    el.textContent = option.label ?? fallbackText;
  }
}

function mountCheckbox(
  container: HTMLElement,
  checkbox: HTMLInputElement,
  config: MountSwitchOptions,
  variant: SwitchVariant
): void {
  if (config.options.length !== 2) {
    throw new Error(
      `mountSwitch: "${config.containerId}" enhances a checkbox, which only supports exactly 2 options (got ${config.options.length})`
    );
  }
  checkbox.classList.add('ws-switch-input');

  if (variant === 'slider') {
    if (container.querySelector('.ws-switch-knob') === null) {
      const knob = document.createElement('div');
      knob.className = 'ws-switch-knob';
      container.appendChild(knob);
    }
  } else {
    const [offOption, onOption] = config.options;

    const offLabel = document.createElement('label');
    offLabel.setAttribute('for', checkbox.id);
    offLabel.className = 'ws-switch-option ws-switch-option-off';
    renderOptionContent(offLabel, offOption, 'Off');

    const onLabel = document.createElement('label');
    onLabel.setAttribute('for', checkbox.id);
    onLabel.className = 'ws-switch-option ws-switch-option-on';
    renderOptionContent(onLabel, onOption, 'On');

    container.insertBefore(offLabel, checkbox.nextSibling);
    container.insertBefore(onLabel, offLabel.nextSibling);
  }

  if (config.onChange) {
    const [offOption, onOption] = config.options;
    checkbox.addEventListener('change', () => {
      config.onChange!(checkbox.checked ? onOption.value : offOption.value);
    });
  }
}

function mountRadioGroup(container: HTMLElement, radios: HTMLInputElement[], config: MountSwitchOptions): void {
  radios.forEach((radio) => {
    radio.classList.add('ws-switch-input');
    const option = config.options.find((o) => o.value === radio.value);
    if (option === undefined) {
      return;
    }

    let label = container.querySelector<HTMLLabelElement>(`label[for="${radio.id}"]`);
    if (label === null) {
      label = document.createElement('label');
      label.setAttribute('for', radio.id);
      radio.insertAdjacentElement('afterend', label);
    }
    label.classList.add('ws-switch-option');
    renderOptionContent(label, option, option.value);

    if (config.onChange) {
      radio.addEventListener('change', () => {
        if (radio.checked) {
          config.onChange!(option.value);
        }
      });
    }
  });
}

function mountButtonGroup(container: HTMLElement, buttons: HTMLButtonElement[], config: MountSwitchOptions): void {
  let hasActive = buttons.some((b) => b.classList.contains('active'));

  buttons.forEach((button, index) => {
    const option = config.options.find((o) => o.value === button.dataset.value);
    if (option === undefined) {
      return;
    }
    button.classList.add('ws-switch-option');
    renderOptionContent(button, option, option.value);

    if (!hasActive && index === 0) {
      button.classList.add('active');
      button.setAttribute('aria-selected', 'true');
      hasActive = true;
    }

    button.addEventListener('click', () => {
      buttons.forEach((b) => {
        const isActive = b === button;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-selected', String(isActive));
      });
      if (config.onChange) {
        config.onChange(option.value);
      }
    });
  });
}

function readValue(container: HTMLElement, config: MountSwitchOptions): string {
  const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (checkbox !== null) {
    return checkbox.checked ? config.options[1].value : config.options[0].value;
  }

  const checkedRadio = container.querySelector<HTMLInputElement>('input[type="radio"]:checked');
  if (checkedRadio !== null) {
    return checkedRadio.value;
  }

  const activeButton = container.querySelector<HTMLButtonElement>('button.active');
  return activeButton?.dataset.value ?? config.options[0].value;
}

function writeValue(container: HTMLElement, config: MountSwitchOptions, value: string): void {
  const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (checkbox !== null) {
    checkbox.checked = value === config.options[1].value;
    return;
  }

  const radios = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
  if (radios.length > 0) {
    radios.forEach((radio) => {
      radio.checked = radio.value === value;
    });
    return;
  }

  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
  buttons.forEach((button) => {
    const isActive = button.dataset.value === value;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });
}

function buildController(container: HTMLElement, config: MountSwitchOptions): SwitchController {
  return {
    getValue: () => readValue(container, config),
    setValue: (value: string) => writeValue(container, config, value),
    destroy: () => {
      delete container.dataset.switchMounted;
    },
  };
}

/** Idempotent -- a second call for the same containerId is a no-op past the
 *  DOM-enhancement step (guarded by `data-switch-mounted`), same as
 *  segmentedToggle.ts's mountSegmentedCheckboxToggle() was; safe to call
 *  from setup code that could conceivably run twice. Note the second call's
 *  own `onChange` is NOT wired in that case -- only the first mount's is. */
export function mountSwitch(config: MountSwitchOptions): SwitchController {
  const container = document.getElementById(config.containerId);
  if (container === null) {
    throw new Error(`mountSwitch: no element with id "${config.containerId}"`);
  }
  if (config.options.length < 2) {
    throw new Error(`mountSwitch: "${config.containerId}" needs at least 2 options (got ${config.options.length})`);
  }

  if (container.dataset.switchMounted === 'true') {
    return buildController(container, config);
  }

  const variant: SwitchVariant = config.variant ?? 'segmented';
  container.classList.add('ws-switch', variant === 'slider' ? 'ws-switch--slider' : 'ws-switch--segmented');

  const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
  const radios = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));

  if (variant === 'slider' && checkbox === null) {
    throw new Error(`mountSwitch: "${config.containerId}" uses variant 'slider', which requires a checkbox`);
  }

  if (checkbox !== null) {
    mountCheckbox(container, checkbox, config, variant);
  } else if (radios.length >= 2) {
    mountRadioGroup(container, radios, config);
  } else if (buttons.length >= 2) {
    mountButtonGroup(container, buttons, config);
  } else {
    throw new Error(
      `mountSwitch: "${config.containerId}" has no checkbox, radio group (2+), or button group (2+) to enhance`
    );
  }

  container.dataset.switchMounted = 'true';
  return buildController(container, config);
}
