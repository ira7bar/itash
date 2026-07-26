import { selectCell, typeLetter, backspace, toggleUnsure } from "./model.js";
import { shareRoomUrl, shareButtonRestingLabel } from "./share.js";

// Includes the punctuation keys that map to ת/ץ/ף on the standard Hebrew
// keyboard layout (, . ; and their shifted forms < > :) -- see hebrew.js.
const HEBREW_OR_LATIN_LETTER = /[א-תa-zA-Z,.;<>:]/;
const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;

export function wireInteractions(
  state,
  {
    gridEl,
    imageEl,
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
  }
) {
  gridEl.addEventListener("click", (e) => {
    const cellEl = e.target.closest(".cell");
    if (!cellEl) return;
    const row = Number(cellEl.dataset.row);
    const col = Number(cellEl.dataset.col);

    selectCell(state, row, col);
    onChange();
    hiddenInput.value = "";
    positionHiddenInputAtCell(hiddenInput, cellEl);
    hiddenInput.focus({ preventScroll: true });
  });

  // Long-press (hold, don't drag) a cell to flag its word as "unsure" --
  // independent of the click handler above, which still fires normally
  // afterward and selects the cell as usual.
  let pressTimer = null;
  let pressStart = null;

  const cancelPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    pressStart = null;
  };

  gridEl.addEventListener("pointerdown", (e) => {
    const cellEl = e.target.closest(".cell");
    if (!cellEl) return;
    const row = Number(cellEl.dataset.row);
    const col = Number(cellEl.dataset.col);
    pressStart = { x: e.clientX, y: e.clientY };
    pressTimer = setTimeout(() => {
      const result = toggleUnsure(state, row, col);
      if (result) onUnsureFlagChange(result.wordId, result.isUnsure);
      pressTimer = null;
    }, LONG_PRESS_MS);
  });

  gridEl.addEventListener("pointermove", (e) => {
    if (!pressStart) return;
    const dx = e.clientX - pressStart.x;
    const dy = e.clientY - pressStart.y;
    if (Math.hypot(dx, dy) > MOVE_TOLERANCE_PX) cancelPress();
  });

  gridEl.addEventListener("pointerup", cancelPress);
  gridEl.addEventListener("pointercancel", cancelPress);
  gridEl.addEventListener("pointerleave", cancelPress);

  // Android fires its own native "image options" menu (copy/share image) on a
  // long-press of the puzzle <img>, competing with the long-press-to-toggle-
  // unsure gesture above. Suppress it on both the image and the overlay --
  // the overlay's cells sit on top and normally take the touch, but Android's
  // image-menu detection isn't reliable DOM hit-testing, so it can still fire
  // as if the image itself were touched.
  const suppressContextMenu = (e) => e.preventDefault();
  gridEl.addEventListener("contextmenu", suppressContextMenu);
  imageEl.addEventListener("contextmenu", suppressContextMenu);

  hiddenInput.addEventListener("input", () => {
    const value = hiddenInput.value;
    const candidate = [...value].reverse().find((ch) => HEBREW_OR_LATIN_LETTER.test(ch));
    hiddenInput.value = "";
    const result = candidate ? typeLetter(state, candidate) : null;
    if (result) {
      onAnswerCellChange(result.row, result.col, result.letter);
    }
  });

  hiddenInput.addEventListener("keydown", (e) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const result = backspace(state);
      if (result) {
        onAnswerCellChange(result.row, result.col, "");
      }
    } else if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      moveByArrowKey(state, e.key);
      onChange();
      if (state.activeCell) {
        const { row, col } = state.activeCell;
        const cellEl = gridEl.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
        if (cellEl) positionHiddenInputAtCell(hiddenInput, cellEl);
      }
      hiddenInput.focus({ preventScroll: true });
    }
  });

  shareBtn.addEventListener("click", async () => {
    shareBtn.disabled = true;
    try {
      const url = await ensureRoomAndGetShareUrl();
      const result = await shareRoomUrl(url);
      if (result === "copied") {
        shareBtn.textContent = "הקישור הועתק!";
        setTimeout(() => {
          shareBtn.textContent = shareButtonRestingLabel(state.roomId);
        }, 2000);
      } else {
        shareBtn.textContent = shareButtonRestingLabel(state.roomId);
      }
    } catch (err) {
      console.warn("Failed to start/share a live room:", err);
      shareBtn.textContent = "שגיאה בשיתוף";
      setTimeout(() => {
        shareBtn.textContent = shareButtonRestingLabel(state.roomId);
      }, 2000);
    } finally {
      shareBtn.disabled = false;
    }
  });

  leaveRoomBtn.addEventListener("click", () => {
    leaveRoom();
    onChange();
  });

  joinForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = joinCodeInput.value;
    if (!code.trim()) return;
    joinBtn.disabled = true;
    const originalJoinText = joinBtn.textContent;
    try {
      const joined = await joinRoomByCode(code);
      if (joined) {
        joinCodeInput.value = "";
        onChange();
      }
    } catch (err) {
      console.warn("Failed to join room by code:", err);
      joinBtn.textContent = "קוד לא תקין";
      setTimeout(() => {
        joinBtn.textContent = originalJoinText;
      }, 2000);
    } finally {
      joinBtn.disabled = false;
    }
  });
}

// #hidden-input is a real DOM input purely to summon the OS keyboard and
// capture its output -- it must never be visible, and was originally pinned
// at a fixed (0,0). But focusing an input opens the on-screen keyboard, and
// mobile browsers try to keep the focused element in view when that
// happens; if the page was scrolled/zoomed anywhere other than the exact
// top-left corner, that "keep it in view" scroll snaps the whole page back
// to (0,0) on every single tap-to-type -- reported as "jump to the left."
// Moving the input to sit exactly on top of whichever cell is active means
// it's already in view, so there's nothing to scroll.
function positionHiddenInputAtCell(hiddenInput, cellEl) {
  const rect = cellEl.getBoundingClientRect();
  hiddenInput.style.left = `${rect.left}px`;
  hiddenInput.style.top = `${rect.top}px`;
}

function moveByArrowKey(state, key) {
  if (!state.activeCell) return;
  const { row, col } = state.activeCell;
  const delta = {
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
  }[key];
  if (!delta) return;
  const nr = row + delta[0];
  const nc = col + delta[1];
  if (nr < 0 || nr >= state.index.rows || nc < 0 || nc >= state.index.cols) return;
  selectCell(state, nr, nc);
}
