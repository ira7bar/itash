import { createState, flattenAnswers, applyRemoteAnswers } from "./model.js";
import { setupImage, renderGridShell, updateGrid } from "./render.js";
import { wireInteractions } from "./interaction.js";
import { saveProgress, loadProgress } from "./storage.js";
import { getRoomIdFromUrl, getRoomShareUrl, createRoomId } from "./share.js";
import { subscribeRoom, pushRoomAnswers } from "./sync.js";

async function main() {
  const imageEl = document.getElementById("puzzle-image");
  const overlayEl = document.getElementById("overlay-layer");
  const hiddenInput = document.getElementById("hidden-input");
  const shareBtn = document.getElementById("share-btn");
  const roomCodeEl = document.getElementById("room-code");

  const res = await fetch("puzzle.json", { cache: "no-cache" });
  const puzzle = await res.json();

  const state = createState(puzzle);
  loadProgress(state);

  setupImage(state, imageEl);
  renderGridShell(state, overlayEl);
  // No resize handling needed: cell positions are percentages of the image's own
  // box, so they stay aligned automatically as the image scales with the viewport
  // or native pinch-zoom -- there's no pixel math to redo on resize.

  const onChange = () => {
    updateGrid(state, overlayEl);
    saveProgress(state);
  };

  const onAnswerChange = () => {
    onChange();
    if (state.roomId) {
      pushRoomAnswers(state.roomId, flattenAnswers(state)).catch((err) => {
        console.warn("Failed to sync answer to room:", err);
      });
    }
  };

  let unsubscribeRoom = null;

  const showRoomCode = (roomId) => {
    roomCodeEl.hidden = !roomId;
    roomCodeEl.textContent = roomId ? `קוד חדר: ${roomId.toUpperCase()}` : "";
  };

  // Joining a room's live state overrides local progress, same as the old
  // share-link behavior -- opening a shared link is an explicit "load this"
  // action. Runs both when joining someone else's room from a URL, and right
  // after this device creates a brand new one.
  const joinRoom = async (roomId) => {
    // Only commit to the new room (state.roomId, the old subscription being torn
    // down) once the new one actually succeeds -- a failed join must leave the
    // app exactly as usable as it was before the attempt, not half-broken.
    const unsubscribe = await subscribeRoom(roomId, (answersMap) => {
      applyRemoteAnswers(state, answersMap);
      updateGrid(state, overlayEl);
      saveProgress(state);
    });
    if (unsubscribeRoom) unsubscribeRoom();
    unsubscribeRoom = unsubscribe;
    state.roomId = roomId;
    showRoomCode(roomId);
  };

  // Used by the share button: creates a room the first time it's needed. The
  // current local progress is pushed BEFORE subscribing, since a brand new
  // room starts empty -- subscribing first would have its first snapshot
  // (nothing there yet) wipe out whatever the user already filled in solo.
  const ensureRoomAndGetShareUrl = async () => {
    if (!state.roomId) {
      const roomId = createRoomId();
      await pushRoomAnswers(roomId, flattenAnswers(state));
      await joinRoom(roomId);
    }
    return getRoomShareUrl(state.roomId);
  };

  const existingRoomId = getRoomIdFromUrl();
  if (existingRoomId) {
    try {
      await joinRoom(existingRoomId);
    } catch (err) {
      // Don't let a broken live-sync backend take down the whole app -- fall
      // back to normal solo solving with whatever local progress was loaded.
      console.warn("Failed to join room from URL, continuing solo:", err);
    }
    history.replaceState(null, "", location.pathname + location.search);
  }

  wireInteractions(state, {
    gridEl: overlayEl,
    hiddenInput,
    shareBtn,
    onChange,
    onAnswerChange,
    ensureRoomAndGetShareUrl,
  });
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
