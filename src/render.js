import { isBlocked, getCellEntry, getActiveWord } from "./model.js";

// #grid has no intrinsic height of its own; without a definite height, CSS Grid's
// `1fr` row tracks have no free space to divide and instead grow to fit each row's
// tallest content (the classic "1fr degrades to auto in an auto-sized container"
// behavior), which breaks the uniform square-cell layout once any cell's clue text
// wants more vertical room than the row would otherwise get. Setting an explicit
// pixel height (computed from the grid's own rendered width) forces every row to
// the same size, so `overflow: hidden` on `.cell` can then reliably clip long text
// instead of the whole grid deforming around it.
export function sizeGridToSquareCells(state, gridEl) {
  const width = gridEl.clientWidth;
  const cellSize = width / state.index.cols;
  gridEl.style.height = `${cellSize * state.index.rows}px`;
}

export function renderGridShell(state, gridEl) {
  gridEl.innerHTML = "";
  gridEl.style.gridTemplateColumns = `repeat(${state.index.cols}, 1fr)`;
  gridEl.style.gridTemplateRows = `repeat(${state.index.rows}, 1fr)`;

  for (let r = 0; r < state.index.rows; r++) {
    for (let c = 0; c < state.index.cols; c++) {
      const cellEl = document.createElement("div");
      cellEl.className = "cell";
      cellEl.dataset.row = String(r);
      cellEl.dataset.col = String(c);

      const clueEl = document.createElement("div");
      clueEl.className = "clue-text";
      cellEl.appendChild(clueEl);

      const letterEl = document.createElement("div");
      letterEl.className = "letter";
      cellEl.appendChild(letterEl);

      gridEl.appendChild(cellEl);
    }
  }
}

export function updateGrid(state, gridEl) {
  const activeWord = getActiveWord(state);
  const activeWordCellSet = new Set((activeWord?.cells ?? []).map(([r, c]) => `${r},${c}`));

  const cells = gridEl.children;
  for (let i = 0; i < cells.length; i++) {
    const cellEl = cells[i];
    const r = Number(cellEl.dataset.row);
    const c = Number(cellEl.dataset.col);
    const blocked = isBlocked(state, r, c);

    cellEl.classList.toggle("blocked", blocked);
    cellEl.classList.toggle("blank", !blocked);

    const clueEl = cellEl.querySelector(".clue-text");
    const letterEl = cellEl.querySelector(".letter");

    if (blocked) {
      const cellData = state.puzzle.grid[r][c];
      clueEl.innerHTML = "";
      const parts = cellData.clueParts ?? (cellData.clue ? [cellData.clue] : []);
      for (const part of parts) {
        const partEl = document.createElement("div");
        partEl.className = "clue-part";
        partEl.textContent = part;
        clueEl.appendChild(partEl);
      }
      letterEl.textContent = "";
    } else {
      clueEl.textContent = "";
      letterEl.textContent = state.answers[r][c] ?? "";
    }

    const isActive = state.activeCell && state.activeCell.row === r && state.activeCell.col === c;
    cellEl.classList.toggle("active", Boolean(isActive));
    cellEl.classList.toggle("in-word", !blocked && activeWordCellSet.has(`${r},${c}`));

    if (state.editMode) {
      cellEl.classList.add("edit-mode");
    } else {
      cellEl.classList.remove("edit-mode");
    }
  }
}

export function updateClueBanner(state, bannerEl) {
  const word = getActiveWord(state);
  if (!word) {
    bannerEl.textContent = state.activeCell ? "" : "הקש על תא כדי להתחיל";
    bannerEl.classList.toggle("empty", true);
    return;
  }
  const dirLabel = word.direction === "horizontal" ? "מאוזן" : "מאונך";
  bannerEl.textContent = word.clue ? `${word.clue} (${dirLabel})` : `(אין רמז מזוהה — ${dirLabel})`;
  bannerEl.classList.toggle("empty", false);
  bannerEl.classList.toggle("missing-clue", !word.clue);
}
