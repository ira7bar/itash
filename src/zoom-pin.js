// Native pinch-zoom (see CLAUDE.md's "Viewport / pan-to-follow" -- the app
// deliberately never implements its own zoom, only native OS/browser
// pinch-zoom) is a whole-page compositor-level visual transform. Nothing
// exempts position:fixed/sticky chrome from it, so the footer and the chat
// FAB balloon up to the same zoom level as the grid the moment you scroll
// or pan down to them while zoomed in -- fine for the grid itself (the
// whole point of allowing zoom), not for footer/chat chrome that's meant
// to stay tappable at its normal size.
//
// This keeps a given element pinned at its normal on-screen size and
// position near the bottom of the screen regardless of zoom level (or the
// on-screen keyboard, which shrinks the visual viewport the same way zoom
// does) by counter-scaling it against window.visualViewport. Deliberately
// narrow in scope -- one element's paint, not gesture handling -- unlike
// the zoom/touch-action fights CLAUDE.md documents as the source of past
// Android bugs in this codebase.
//
// reserveBottom(), if given, returns extra natural-pixel space to leave
// clear below the element -- used so the chat FAB floats above the footer
// rather than under it, without either one needing to hardcode the other's
// height.
export function pinNearVisualViewportBottom(el, reserveBottom = () => 0) {
  const vv = window.visualViewport;
  if (!vv) return () => {}; // unsupported browser: leave the plain CSS position as-is

  const update = () => {
    // Measured with the transform cleared, not cached, so this stays
    // correct even when the element's own natural size changes (e.g. the
    // share button growing to two lines once in a room) without this
    // module needing to know why.
    const prevTransform = el.style.transform;
    el.style.transform = "none";
    const rect = el.getBoundingClientRect();
    el.style.transform = prevTransform;

    const scale = vv.scale || 1;
    const s = 1 / scale;
    const reserve = reserveBottom() * s;
    const tx = vv.offsetLeft - rect.left;
    const ty = vv.offsetTop + vv.height - rect.height * s - reserve - rect.top;
    el.style.transformOrigin = "0 0";
    el.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  };

  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
  return update;
}
