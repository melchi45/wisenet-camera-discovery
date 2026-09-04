// Dynamic split layout (#container/#video-panel/#drag/#control-panel) -- SRS
// FR-2.6. Requested directly by the user: replaces the old fixed 30/70
// desktop split (+ a separate <=768px stacked-breakpoint override) with one
// continuous flexbox layout that reflows based on the page's live aspect
// ratio, at any size -- landscape (wider than tall) puts the video on the
// left and Control UI on the right; portrait (taller than wide) puts video
// on top, Control UI below. #drag resizes the split by dragging horizontally
// in landscape / vertically in portrait. See docs/window-ui/DESIGN.md's
// "Dynamic split layout" section; CSS lives in
// src/component/split-layout/split-layout.css (src/shared-v2/-only, not
// shared with src/shared/, which keeps the original #left_panel/#right_panel
// ids -- #video-panel/#control-panel are a src/shared-v2/-only rename).

import { state } from './state';

const MIN_RATIO = 10;
const MAX_RATIO = 90;

function clampRatio(value: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));
}

function currentRatio(): number {
  return state.splitOrientation === 'row' ? state.rowSplitRatio : state.columnSplitRatio;
}

function setCurrentRatio(value: number): void {
  if (state.splitOrientation === 'row') {
    state.rowSplitRatio = value;
  } else {
    state.columnSplitRatio = value;
  }
}

/** Applies `currentRatio()` as #video-panel's flex-basis -- the single thing
 *  that actually controls the visible split, in either orientation. */
function applyRatio(videoPanel: HTMLElement): void {
  videoPanel.style.flexBasis = currentRatio() + '%';
}

/** Re-evaluates row vs column from #container's live box (not a fixed
 *  viewport-width breakpoint -- a narrow-but-tall extension popup and a
 *  wide-but-short one both need to pick the orientation that actually suits
 *  their own shape, not the page's outer window). Toggles the
 *  `split-portrait` class split-layout.css keys off of, and re-applies that
 *  orientation's own remembered ratio. */
function updateOrientation(container: HTMLElement, videoPanel: HTMLElement): void {
  const isPortrait = container.clientHeight > container.clientWidth;
  const nextOrientation = isPortrait ? 'column' : 'row';
  if (nextOrientation !== state.splitOrientation) {
    state.splitOrientation = nextOrientation;
    container.classList.toggle('split-portrait', isPortrait);
  }
  applyRatio(videoPanel);
}

export function setupSplitLayout(): void {
  const container = document.getElementById('container') as HTMLElement;
  const videoPanel = document.getElementById('video-panel') as HTMLElement;
  const dragHandle = document.getElementById('drag') as HTMLElement;

  updateOrientation(container, videoPanel);

  // ResizeObserver over #container itself (not `window`'s resize event) --
  // catches every reason #container's own box can change (a real browser
  // window resize, but also e.g. an extension popup/side panel resizing
  // independently of any window-level event).
  new ResizeObserver(() => updateOrientation(container, videoPanel)).observe(container);

  dragHandle.addEventListener('mousedown', () => {
    state.isResizing = true;
  });

  // mousemove, not mouseover: mouseover only re-fires when the pointer
  // enters a *different* element, so a fast drag across one large element
  // (e.g. #control-panel) barely updates at all -- the legacy #drag handler
  // (src/shared/window.ts) used mouseover and inherited that jerkiness; not
  // reproduced here since this is a full rewrite, not a port.
  document.addEventListener('mousemove', (e) => {
    if (!state.isResizing) return;
    const rect = container.getBoundingClientRect();
    const ratio =
      state.splitOrientation === 'row'
        ? ((e.clientX - rect.left) / rect.width) * 100
        : ((e.clientY - rect.top) / rect.height) * 100;
    setCurrentRatio(clampRatio(ratio));
    applyRatio(videoPanel);
  });

  document.addEventListener('mouseup', () => {
    state.isResizing = false;
  });
}
