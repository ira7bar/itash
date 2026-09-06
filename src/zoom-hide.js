// Native pinch-zoom (see CLAUDE.md's "Viewport / pan-to-follow" -- the app
// deliberately never implements its own zoom, only native OS/browser
// pinch-zoom) magnifies the WHOLE page as a compositor-level visual
// transform, including position:sticky chrome like the footer and the chat
// FAB -- there's no standard way to exempt one element from a page-wide
// native zoom. A first attempt counter-scaled all of them against
// window.visualViewport to keep them at constant on-screen size, but forced
// a layout measurement on every single zoom/pan tick (needed to remeasure
// their natural position each time), which made pinch-zooming itself
// choppy. hideWhileZoomedIn below is the simpler, far cheaper fallback used
// for chrome that isn't meant to be usable while actively zoomed in: just
// hide it once zoom passes a "this is no longer a quick glance, this is
// heavy zoom" threshold, and bring it back once it drops back down.
//
// The chat FAB is the one exception -- someone mid-zoom might still want to
// reach the chat, so it can't just disappear. pinWhileZoomedIn (further
// below) revisits the counter-scaling idea for that one element alone, at a
// cost cheap enough to actually be worth it -- see its own comment for what
// specifically made the original attempt slow, and how this avoids it.
//
// Two different thresholds (hide/pin above HIDE_ABOVE, only reverse below
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

// Chat FAB counterpart to hideWhileZoomedIn: instead of disappearing above
// the zoom threshold, it freezes at a fixed screen position with an inverse-
// scale transform that cancels the page's own pinch-zoom magnification -- so
// it stays reachable, at the same on-screen spot and size, even while the
// grid itself is heavily zoomed in. Below the threshold it's left completely
// alone (its own ordinary CSS -- sticky, natural size), so the common,
// unzoomed case is entirely unaffected.
//
// The earlier counter-scaling attempt (see hideWhileZoomedIn's history
// above) forced a fresh getBoundingClientRect() on every single zoom/pan
// tick to remeasure position -- THAT's what made pinch-zooming choppy, not
// the counter-scaling idea itself. This measures the element's resting box
// exactly ONCE, at the moment it's pinned (a single zoom-in transition, not
// a per-tick cost), then every subsequent tick during the gesture only reads
// window.visualViewport's own already-tracked offsetLeft/offsetTop/scale and
// writes one `transform` -- no further layout-forcing reads.
export function pinWhileZoomedIn(el) {
  const vv = window.visualViewport;
  if (!vv) return;

  let pinned = false;
  let baseLeft = 0;
  let baseTop = 0;

  // Freezes the element's current box as plain inline left/top (position:
  // fixed, escaping #grid-wrap's own sticky/scroll bookkeeping for the
  // duration of the pin), so every later tick only has to correct for zoom
  // scale and pan FROM this cached point, never re-deriving it.
  const engage = () => {
    const rect = el.getBoundingClientRect();
    baseLeft = rect.left;
    baseTop = rect.top;
    el.style.position = "fixed";
    el.style.left = `${baseLeft}px`;
    el.style.top = `${baseTop}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.margin = "0";
    el.style.transformOrigin = "0 0";
    el.classList.add("zoom-pinned");
  };

  const disengage = () => {
    for (const prop of ["position", "left", "top", "right", "bottom", "margin", "transform", "transformOrigin"]) {
      el.style[prop] = "";
    }
    el.classList.remove("zoom-pinned");
  };

  const update = () => {
    const scale = vv.scale || 1;
    if (!pinned && scale > HIDE_ABOVE_SCALE) {
      pinned = true;
      engage();
    } else if (pinned && scale < SHOW_BELOW_SCALE) {
      pinned = false;
      disengage();
      return;
    }
    if (!pinned) return;
    // Cancels both the page-wide zoom magnification (the 1/scale factor) and
    // however far the visual viewport has panned from the layout viewport's
    // own origin (offsetLeft/offsetTop) -- the browser re-multiplies
    // whatever this transform produces by `scale` again as part of its own
    // zoom, so dividing by it here is what nets back out to a constant
    // screen position/size. transform-origin is pinned to the element's own
    // top-left (see engage()), so scale() never shifts that anchor corner --
    // only translate() needs to correct for it (see MDN's visualViewport
    // guide for pinning UI chrome during pinch-zoom, which this mirrors).
    const scaleInverse = 1 / scale;
    const dx = baseLeft * (scaleInverse - 1) + vv.offsetLeft;
    const dy = baseTop * (scaleInverse - 1) + vv.offsetTop;
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${scaleInverse})`;
  };

  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
}
