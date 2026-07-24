import { selectCell, typeLetter, backspace, toggleBlocked } from "./model.js";

const HEBREW_LETTER = /[א-ת]/;

export function wireInteractions(state, { gridEl, hiddenInput, editToggleBtn, onChange }) {
  gridEl.addEventListener("click", (e) => {
    const cellEl = e.target.closest(".cell");
    if (!cellEl) return;
    const row = Number(cellEl.dataset.row);
    const col = Number(cellEl.dataset.col);

    if (state.editMode) {
      toggleBlocked(state, row, col);
      onChange();
      return;
    }

    selectCell(state, row, col);
    onChange();
    hiddenInput.value = "";
    hiddenInput.focus({ preventScroll: true });
  });

  hiddenInput.addEventListener("input", () => {
    const value = hiddenInput.value;
    const lastChar = [...value].reverse().find((ch) => HEBREW_LETTER.test(ch));
    hiddenInput.value = "";
    if (lastChar) {
      typeLetter(state, lastChar);
      onChange();
    }
  });

  hiddenInput.addEventListener("keydown", (e) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      backspace(state);
      onChange();
    } else if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      moveByArrowKey(state, e.key);
      onChange();
      hiddenInput.focus({ preventScroll: true });
    }
  });

  editToggleBtn.addEventListener("click", () => {
    state.editMode = !state.editMode;
    editToggleBtn.classList.toggle("active", state.editMode);
    editToggleBtn.textContent = state.editMode ? "סיום עריכה" : "מצב עריכה";
    onChange();
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
