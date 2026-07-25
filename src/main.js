import { createState, flattenAnswers, applyRemoteAnswers, flattenUnsure, applyRemoteUnsure } from "./model.js";
import { setupImage, renderGridShell, updateGrid } from "./render.js";
import { wireInteractions } from "./interaction.js";
import { saveProgress, loadProgress } from "./storage.js";
import { getRoomIdFromUrl, getRoomShareUrl, createRoomId, shareButtonRestingLabel } from "./share.js";
import { subscribeRoom, pushRoomState, pushAnswerCell, pushUnsureFlag } from "./sync.js";

async function main() {
  const imageEl = document.getElementById("puzzle-image");
  const overlayEl = document.getElementById("overlay-layer");
  const hiddenInput = document.getElementById("hidden-input");
  const shareBtn = document.getElementById("share-btn");
  const leaveRoomBtn = document.getElementById("leave-room-btn");
  const roomCodeEl = document.getElementById("room-code");
  const joinForm = document.getElementById("join-form");
  const joinCodeInput = document.getElementById("join-code-input");
  const joinBtn = document.getElementById("join-btn");

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

  // A typed letter or backspace syncs just that ONE cell to a live room --
  // never the whole grid, so concurrent edits (or a device still mid-load)
  // can't clobber someone else's answers. See pushAnswerCell in sync.js.
  const onAnswerCellChange = (row, col, letter) => {
    onChange();
    if (state.roomId) {
      pushAnswerCell(state.roomId, row, col, letter).catch((err) => {
        console.warn("Failed to sync answer to room:", err);
      });
    }
  };

  const onUnsureFlagChange = (wordId, isUnsure) => {
    onChange();
    if (state.roomId) {
      pushUnsureFlag(state.roomId, wordId, isUnsure).catch((err) => {
        console.warn("Failed to sync unsure flag to room:", err);
      });
    }
  };

  let unsubscribeRoom = null;

  // Single source of truth for every piece of UI that depends on "are we
  // currently in a room": the room code text, the join-by-code form (only
  // makes sense when NOT already in one), the leave button, and the share
  // button's resting label.
  const refreshRoomUi = () => {
    const inRoom = Boolean(state.roomId);
    roomCodeEl.hidden = !inRoom;
    roomCodeEl.textContent = inRoom ? `קוד חדר: ${state.roomId.toUpperCase()}` : "";
    joinForm.hidden = inRoom;
    leaveRoomBtn.hidden = !inRoom;
    shareBtn.textContent = shareButtonRestingLabel(state.roomId);
  };

  // Joining a room's live state overrides local progress, same as the old
  // share-link behavior -- opening a shared link/code is an explicit "load
  // this" action. Runs when joining someone else's room (from a URL or a
  // manually-entered code), and right after this device creates a brand new one.
  const joinRoom = async (roomId) => {
    // Only commit to the new room (state.roomId, the old subscription being torn
    // down) once the new one actually succeeds -- a failed join must leave the
    // app exactly as usable as it was before the attempt, not half-broken.
    const unsubscribe = await subscribeRoom(roomId, (roomState) => {
      applyRemoteAnswers(state, roomState.answers || {});
      applyRemoteUnsure(state, roomState.unsure || []);
      updateGrid(state, overlayEl);
      saveProgress(state);
    });
    if (unsubscribeRoom) unsubscribeRoom();
    unsubscribeRoom = unsubscribe;
    state.roomId = roomId;
    // Put the room in THIS device's own address bar too, not just in the link
    // handed to others -- a live room should stay joined across reloads, and
    // mobile browsers reload backgrounded tabs constantly (e.g. switching
    // away to actually send the share link via WhatsApp). Without this, that
    // completely ordinary flow silently and permanently drops the device
    // from the room: it keeps showing whatever answers were last saved
    // locally (looking perfectly normal), but never sends or receives
    // another update again.
    history.replaceState(null, "", getRoomShareUrl(roomId));
    refreshRoomUi();
  };

  // Stops live sync and goes back to solo solving, continuing from whatever
  // answers were on the board at the moment of leaving (not a puzzle reset --
  // "משחק אישי" just means "just me, from here").
  const leaveRoom = () => {
    if (unsubscribeRoom) {
      unsubscribeRoom();
      unsubscribeRoom = null;
    }
    state.roomId = null;
    history.replaceState(null, "", location.pathname + location.search);
    refreshRoomUi();
  };

  // Used by the share button: creates a room the first time it's needed. The
  // current local progress is pushed BEFORE subscribing, since a brand new
  // room starts empty -- subscribing first would have its first snapshot
  // (nothing there yet) wipe out whatever the user already filled in solo.
  const ensureRoomAndGetShareUrl = async () => {
    if (!state.roomId) {
      const roomId = createRoomId();
      const roomState = { answers: flattenAnswers(state), unsure: flattenUnsure(state) };
      await pushRoomState(roomId, roomState);
      await joinRoom(roomId);
    }
    return getRoomShareUrl(state.roomId);
  };

  // Used by the "join by code" form, for when someone got the code read
  // aloud rather than tapping a shared link.
  const joinRoomByCode = async (rawCode) => {
    const roomId = rawCode.trim().toLowerCase();
    if (!roomId) return false;
    await joinRoom(roomId);
    return true;
  };

  const existingRoomId = getRoomIdFromUrl();
  if (existingRoomId) {
    try {
      await joinRoom(existingRoomId);
    } catch (err) {
      // Don't let a broken live-sync backend take down the whole app -- fall
      // back to normal solo solving with whatever local progress was loaded.
      // Do clear the broken room id from the address bar, though, so a
      // reload doesn't just keep retrying the same failing join forever.
      console.warn("Failed to join room from URL, continuing solo:", err);
      history.replaceState(null, "", location.pathname + location.search);
    }
  }
  refreshRoomUi();

  wireInteractions(state, {
    gridEl: overlayEl,
    hiddenInput,
    shareBtn,
    leaveRoomBtn,
    joinForm,
    joinCodeInput,
    joinBtn,
    onChange,
    onAnswerCellChange,
    onUnsureFlagChange,
    ensureRoomAndGetShareUrl,
    joinRoomByCode,
    leaveRoom,
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
