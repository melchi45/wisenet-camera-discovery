// Dynamic split layout (#container/#video-panel/#drag/#control-panel) -- SRS
// FR-2.6. Requested directly by the user: replaces the old fixed 30/70
// desktop split (+ a separate <=768px stacked-breakpoint override) with one
// continuous flexbox layout that reflows based on the page's live aspect
// ratio, at any size -- landscape (wider than tall) puts the video on the
// left and Control UI on the right; portrait (taller than wide) puts video
// on top, Control UI below. #drag resizes the row-mode split by dragging
// horizontally; column mode has no drag/ratio at all (see below) -- #video-
// panel is content-sized there so #control-panel always sits flush against
// it, no gap or overflow regardless of the video's own aspect ratio. See
// docs/window-ui/DESIGN.md's "Dynamic split layout" section; CSS lives in
// src/component/split-layout/split-layout.css (src/shared-v2/-only, not
// shared with src/shared/, which keeps the original #left_panel/#right_panel
// ids -- #video-panel/#control-panel are a src/shared-v2/-only rename).

import { state } from './state';

const MIN_RATIO = 10;
const MAX_RATIO = 90;

function clampRatio(value: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));
}

/** Row mode only: applies `state.rowSplitRatio` as #video-panel's flex-basis
 *  -- the single thing that actually controls the visible row-mode split.
 *  Column mode instead clears any inline flex-basis so split-layout.css's
 *  `flex: 0 1 auto` (content-sized) rule takes over -- #video-panel there
 *  must always be exactly the video's own aspect-ratio-driven height, never
 *  a fixed percentage of #container, or #control-panel either leaves a gap
 *  below it (basis larger than the video needs) or the video overflows into
 *  a second, inner scrollbar (basis smaller than the video needs). Reported
 *  directly by the user, with a screenshot showing exactly that gap. */
function applyLayout(videoPanel: HTMLElement): void {
  if (state.splitOrientation === 'row') {
    videoPanel.style.flexBasis = state.rowSplitRatio + '%';
  } else {
    videoPanel.style.removeProperty('flex-basis');
  }
}

/** Re-evaluates row vs column from #container's live box (not a fixed
 *  viewport-width breakpoint -- a narrow-but-tall extension popup and a
 *  wide-but-short one both need to pick the orientation that actually suits
 *  their own shape, not the page's outer window). Toggles the
 *  `split-portrait` class split-layout.css keys off of, and re-applies. */
function updateOrientation(container: HTMLElement, videoPanel: HTMLElement): void {
  const isPortrait = container.clientHeight > container.clientWidth;
  const nextOrientation = isPortrait ? 'column' : 'row';
  if (nextOrientation !== state.splitOrientation) {
    state.splitOrientation = nextOrientation;
    container.classList.toggle('split-portrait', isPortrait);
  }
  applyLayout(videoPanel);
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

  // #drag is hidden in column mode (split-layout.css) -- mousedown can only
  // ever fire here in row mode.
  dragHandle.addEventListener('mousedown', () => {
    state.isResizing = true;
  });

  // mousemove, not mouseover: mouseover only re-fires when the pointer
  // enters a *different* element, so a fast drag across one large element
  // (e.g. #control-panel) barely updates at all -- the legacy #drag handler
  // (src/shared/window.ts) used mouseover and inherited that jerkiness; not
  // reproduced here since this is a full rewrite, not a port.
  document.addEventListener('mousemove', (e) => {
    // Guards the edge case of the window flipping to column mode mid-drag
    // (e.g. resizing while the mouse button is still held from a row-mode
    // drag) -- row-mode math has nothing meaningful to do once there, and
    // applyLayout()'s own column branch would just clear it again anyway.
    if (!state.isResizing || state.splitOrientation !== 'row') return;
    const rect = container.getBoundingClientRect();
    const ratio = ((e.clientX - rect.left) / rect.width) * 100;
    state.rowSplitRatio = clampRatio(ratio);
    applyLayout(videoPanel);
  });

  document.addEventListener('mouseup', () => {
    state.isResizing = false;
  });
}
