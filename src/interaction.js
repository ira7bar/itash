import { selectCell, typeLetter, backspace, toggleUnsure } from "./model.js";
import { shareRoomUrl, shareButtonRestingLabel } from "./share.js";

const HEBREW_OR_LATIN_LETTER = /[א-תa-zA-Z]/;
const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;

export function wireInteractions(
  state,
  {
    gridEl,
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
