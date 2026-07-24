import { createState } from "./model.js";
import { setupImage, renderGridShell, updateGrid, updateClueBanner } from "./render.js";
import { wireInteractions } from "./interaction.js";
import { saveProgress, loadProgress } from "./storage.js";
import { loadFromUrlIfPresent } from "./share.js";

async function main() {
  const imageEl = document.getElementById("puzzle-image");
  const overlayEl = document.getElementById("overlay-layer");
  const bannerEl = document.getElementById("clue-banner");
  const hiddenInput = document.getElementById("hidden-input");
  const shareBtn = document.getElementById("share-btn");

  const res = await fetch("puzzle.json", { cache: "no-cache" });
  const puzzle = await res.json();

  const state = createState(puzzle);
  loadProgress(state);
  // A shared link (opened from another device, or from a family member) is an
  // explicit "load this snapshot" action, so it overrides whatever local
  // progress this device already had -- then gets saved locally right away so
  // it carries on from here as normal on this device too.
  if (loadFromUrlIfPresent(state)) {
    saveProgress(state);
  }

  setupImage(state, imageEl);
  renderGridShell(state, overlayEl);
  // No resize handling needed: cell positions are percentages of the image's own
  // box, so they stay aligned automatically as the image scales with the viewport
  // or native pinch-zoom -- there's no pixel math to redo on resize.

  const onChange = () => {
    updateGrid(state, overlayEl);
    updateClueBanner(state, bannerEl);
    saveProgress(state);
  };

  wireInteractions(state, { gridEl: overlayEl, hiddenInput, shareBtn, onChange });
  onChange();
}

main();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}
