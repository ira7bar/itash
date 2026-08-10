// Native pinch-zoom (see CLAUDE.md's "Viewport / pan-to-follow" -- the app
// deliberately never implements its own zoom, only native OS/browser
// pinch-zoom) magnifies the WHOLE page as a compositor-level visual
// transform, including position:sticky chrome like the footer and the chat
// FAB -- there's no standard way to exempt one element from a page-wide
// native zoom. A first attempt counter-scaled them against
// window.visualViewport to keep them at constant on-screen size, but
// forcing a layout measurement on every single zoom/pan tick (needed to
// remeasure their natural position each time) made pinch-zooming itself
// choppy -- not worth it for chrome that isn't even meant to be used while
// actively zoomed in. This is simpler and far cheaper: just hide them once
// zoom passes a "this is no longer a quick glance, this is heavy zoom"
// threshold, and bring them back once it drops back down.
//
// Two different thresholds (hide above HIDE_ABOVE, only show again below
// SHOW_BELOW) rather than one, so hovering right at the boundary during a
// live pinch gesture doesn't flicker the element in and out.
const HIDE_ABOVE_SCALE = 1.5;
const SHOW_BELOW_SCALE = 1.3;

export function hideWhileZoomedIn(el) {
  const vv = window.visualViewport;
  if (!vv) return; // unsupported browser: never hides, same as always-1x

  let hidden = false;
  const update = () => {
    const scale = vv.scale || 1;
    if (!hidden && scale > HIDE_ABOVE_SCALE) {
      hidden = true;
      el.classList.add("zoom-hidden");
    } else if (hidden && scale < SHOW_BELOW_SCALE) {
      hidden = false;
      el.classList.remove("zoom-hidden");
    }
  };

  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
}
