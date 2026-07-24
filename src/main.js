import { createState, syncIndexWithOverrides } from "./model.js";
import { renderGridShell, updateGrid, updateClueBanner } from "./render.js";
import { wireInteractions } from "./interaction.js";
import { saveProgress, loadProgress } from "./storage.js";

async function main() {
  const gridEl = document.getElementById("grid");
  const bannerEl = document.getElementById("clue-banner");
  const hiddenInput = document.getElementById("hidden-input");
  const editToggleBtn = document.getElementById("edit-toggle");

  const res = await fetch("puzzle.json", { cache: "no-cache" });
  const puzzle = await res.json();

  const state = createState(puzzle);
  loadProgress(state);
  syncIndexWithOverrides(state);

  renderGridShell(state, gridEl);

  const onChange = () => {
    updateGrid(state, gridEl);
    updateClueBanner(state, bannerEl);
    saveProgress(state);
  };

  wireInteractions(state, { gridEl, hiddenInput, editToggleBtn, onChange });
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
