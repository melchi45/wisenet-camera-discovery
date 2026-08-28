// Reusable show/hide ("∧∨") panel component -- see docs/disclosure-component/
// (MRD/PRD/SRS/DESIGN/TC) for the full spec.
//
// Built on the native <details>/<summary> element rather than a hand-rolled
// aria-expanded button: open/close, keyboard activation, and the correct
// expanded/collapsed semantics all come from the browser for free. This
// module only needs to solve one real problem in JS -- an interactive
// control placed inside <summary> (e.g. Debug Information's "Use" checkbox/
// "Clear" button) would otherwise also toggle the disclosure when clicked,
// since <summary>'s native activation listens for any click that bubbles up
// through it.
//
// Same progressive-enhancement philosophy as src/component/switch/: never
// generates the <details>/<summary>/content markup itself, only sets the
// initial open state and guards the optional header controls named in
// config, so every pre-existing id in window.html/window.ts is untouched.

export interface MountDisclosureOptions {
  /** id of the EXISTING <details> element to enhance. */
  containerId: string;
  /** Initial open/closed state. Default: false (collapsed). */
  defaultOpen?: boolean;
  /** id of an existing checkbox inside <summary> (e.g. Debug Information's
   *  "Use" checkbox) whose click must not toggle the disclosure. */
  headerCheckboxId?: string;
  /** id of an existing <button> inside <summary> (e.g. Debug Information's
   *  "Clear" button) whose click must not toggle the disclosure. */
  headerButtonId?: string;
  /** Fires on the native 'toggle' event (user interaction), not on open()/close(). */
  onToggle?: (open: boolean) => void;
}

export interface DisclosureController {
  isOpen(): boolean;
  open(): void;
  close(): void;
  toggle(): void;
}

/** Stops a header control's click from bubbling up to <summary> (which would
 *  otherwise also toggle the disclosure). For a checkbox wrapped in its own
 *  <label> (as `#use_debug` is), the guard goes on the closest <label>
 *  ancestor instead -- clicking the label's text fires its own bubbling
 *  click independent of the checkbox's, so guarding only the checkbox
 *  itself would miss that path. */
function guardHeaderControlClick(id: string): void {
  const el = document.getElementById(id);
  if (el === null) {
    return;
  }
  const clickTarget = el.closest('label') ?? el;
  clickTarget.addEventListener('click', (event) => {
    event.stopPropagation();
  });
}

/** Idempotent -- guarded by `data-disclosure-mounted`, same convention as
 *  src/component/switch/'s mountSwitch(). */
export function mountDisclosure(config: MountDisclosureOptions): DisclosureController {
  const details = document.getElementById(config.containerId);
  if (details === null || !(details instanceof HTMLDetailsElement)) {
    throw new Error(`mountDisclosure: "${config.containerId}" is not a <details> element`);
  }

  if (details.dataset.disclosureMounted !== 'true') {
    details.open = config.defaultOpen ?? false;

    if (config.headerCheckboxId) {
      guardHeaderControlClick(config.headerCheckboxId);
    }
    if (config.headerButtonId) {
      guardHeaderControlClick(config.headerButtonId);
    }
    if (config.onToggle) {
      details.addEventListener('toggle', () => {
        config.onToggle!(details.open);
      });
    }

    details.dataset.disclosureMounted = 'true';
  }

  return {
    isOpen: () => details.open,
    open: () => {
      details.open = true;
    },
    close: () => {
      details.open = false;
    },
    toggle: () => {
      details.open = !details.open;
    },
  };
}
