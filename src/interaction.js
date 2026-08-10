import { selectCell, typeLetter, backspace, toggleUnsure, isBlocked, getWordsForClueCell } from "./model.js";
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
    gridWrapEl,
    hiddenInput,
    shareBtn,
    clearBoardBtn,
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
    clearBoard,
  }
) {
  gridEl.addEventListener("click", (e) => {
    const cellEl = e.target.closest(".cell");
    if (!cellEl) return;
    const row = Number(cellEl.dataset.row);
    const col = Number(cellEl.dataset.col);

    // Tapping a clue cell jumps straight into solving the word it belongs
    // to -- same as tapping that word's own start cell, just from its printed
    // definition instead. A plain (non-clue) blocked cell has no word to jump
    // to and stays inert, as before.
    let targetCellEl = cellEl;
    let targetRow = row;
    let targetCol = col;
    if (isBlocked(state, row, col)) {
      const word = resolveClueTapWord(state, row, col, e.clientY, cellEl);
      if (!word) return;
      [targetRow, targetCol] = word.cells[0];
      targetCellEl = gridEl.querySelector(`.cell[data-row="${targetRow}"][data-col="${targetCol}"]`);
      if (!targetCellEl) return;
    }

    selectCell(state, targetRow, targetCol);
    onChange();
    hiddenInput.value = "";
    positionHiddenInputAtCell(hiddenInput, targetCellEl);
    hiddenInput.focus({ preventScroll: true });
    // Only a clue-cell jump needs to bring the target into view -- an
    // ordinary tap is already on a cell the user can see.
    if (targetCellEl !== cellEl) scrollCellIntoView(targetCellEl, "center");
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

  // Horizontal counterpart to "nearest": scrolls #grid-wrap by the minimum
  // amount so `cellEl` ends up with at least one cell's width of clearance
  // from whichever edge it's closest to (so the next letter -- or,
  // backspacing, the previous one -- is always fully visible, not just
  // peeking in), or does nothing if it already has that much room.
  //
  // Computed and applied directly, rather than via scrollIntoView's own
  // "nearest" + scroll-padding-inline (tried first): that version silently
  // did nothing on a word's actual last letter, since the active cell
  // doesn't move there (nowhere left to advance to) and native "nearest"
  // only reacts when a fresh target isn't already positioned -- it has no
  // way to know the *reason* nothing moved is worth double-checking. This
  // always recomputes fresh off the cell's current position, so it's
  // correct there too, without ever overshooting into a full re-center.
  const panHorizontallyToReveal = (cellEl) => {
    const cellRect = cellEl.getBoundingClientRect();
    const wrapRect = gridWrapEl.getBoundingClientRect();
    const buffer = cellRect.width;
    const cellLeft = cellRect.left - wrapRect.left;
    const cellRight = cellRect.right - wrapRect.left;
    if (cellLeft < buffer) {
      gridWrapEl.scrollLeft += cellLeft - buffer;
    } else if (cellRight > wrapRect.width - buffer) {
      gridWrapEl.scrollLeft += cellRight - (wrapRect.width - buffer);
    }
  };

  // "center": a deliberate jump to a word tapped via its clue, so it lands
  // somewhere comfortable to read and type into, not just barely on-screen --
  // full centering (both axes) makes sense here since it's landing somewhere
  // new, not continuing from a nearby position.
  // "nearest": the passive, minimal-motion case for staying with the active
  // cell while typing/backspacing -- vertical uses the browser's own
  // "nearest" (a no-op if already visible); horizontal uses
  // panHorizontallyToReveal, for the reasons above.
  const scrollCellIntoView = (cellEl, mode) => {
    if (mode === "center") {
      cellEl.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    } else {
      cellEl.scrollIntoView({ block: "nearest", behavior: "auto" });
      panHorizontallyToReveal(cellEl);
    }
  };

  // Keeps whatever's currently the active cell from drifting off-screen as
  // it moves (typing through a word, backspacing back through it). A no-op
  // whenever the cell in question is already visible.
  const scrollActiveCellIntoView = (mode) => {
    if (!state.activeCell) return;
    const { row, col } = state.activeCell;
    const cellEl = gridEl.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
    if (cellEl) scrollCellIntoView(cellEl, mode);
  };

  hiddenInput.addEventListener("input", () => {
    const value = hiddenInput.value;
    const candidate = [...value].reverse().find((ch) => HEBREW_OR_LATIN_LETTER.test(ch));
    hiddenInput.value = "";
    const result = candidate ? typeLetter(state, candidate) : null;
    if (result) {
      onAnswerCellChange(result.row, result.col, result.letter);
      // Advancing through a word can walk the active cell off the edge of
      // the screen (long words, or a pinch-zoomed-in view) -- nudge it back
      // into view, but only the minimum needed: no scroll at all while it's
      // already visible, so ordinary typing doesn't jitter the page. This
      // still correctly reveals the one-cell buffer past a word's actual
      // last letter (see panHorizontallyToReveal), without the overshoot a
      // full "center" caused there for longer words.
      scrollActiveCellIntoView("nearest");
    }
  });

  hiddenInput.addEventListener("keydown", (e) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const result = backspace(state);
      if (result) {
        onAnswerCellChange(result.row, result.col, "");
        scrollActiveCellIntoView("nearest");
      }
    } else if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      moveByArrowKey(state, e.key);
      onChange();
      if (state.activeCell) {
        const { row, col } = state.activeCell;
        const cellEl = gridEl.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
        if (cellEl) {
          positionHiddenInputAtCell(hiddenInput, cellEl);
          scrollCellIntoView(cellEl, "nearest");
        }
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

  // A whole-board clear is destructive and irreversible (no undo, no
  // solution key to recover a wrong guess from), so it's gated behind a
  // native confirm() -- the simplest possible "are you sure," appropriate
  // for a rare, one-shot action that doesn't need a custom modal.
  clearBoardBtn.addEventListener("click", () => {
    if (!window.confirm("בטוח.ה? הפעולה תנקה את כל התשובות בלוח.")) return;
    clearBoard();
    onChange();
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

// Which word a tap on a clue cell means. Usually unambiguous (one word per
// clue cell); a clue cell shared between an across and a down word holds two
// stacked clue boxes, so the tap's Y position within the cell picks between
// them -- top half is always the horizontal clue, bottom half always
// vertical (see getWordsForClueCell in model.js for why that's reliable).
function resolveClueTapWord(state, row, col, clientY, cellEl) {
  const words = getWordsForClueCell(state, row, col);
  if (words.length <= 1) return words[0] ?? null;
  const rect = cellEl.getBoundingClientRect();
  const isTopHalf = clientY - rect.top < rect.height / 2;
  const wantDirection = isTopHalf ? "horizontal" : "vertical";
  return words.find((w) => w.direction === wantDirection) ?? words[0];
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
