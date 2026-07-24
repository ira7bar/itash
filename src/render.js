import { isBlocked, getCellEntry, getActiveWord } from "./model.js";

// `1fr` grid tracks are still a content-aware sizing algorithm (they must first
// satisfy each track's "automatic minimum size" before distributing free space),
// and that has shown real cross-environment inconsistency for this layout. Fixed
// pixel tracks have no such ambiguity -- a `22px` track cannot grow from content
// in any spec-compliant browser. So instead of `repeat(n, 1fr)` plus a computed
// container height, every track (and every cell) gets an explicit pixel size
// computed from the grid's own rendered width.
function clamp(min, value, max) {
  return Math.max(min, Math.min(max, value));
}

export function sizeGridToSquareCells(state, gridEl) {
  const width = gridEl.clientWidth;
  const cellSize = width / state.index.cols;
  gridEl.style.gridTemplateColumns = `repeat(${state.index.cols}, ${cellSize}px)`;
  gridEl.style.gridTemplateRows = `repeat(${state.index.rows}, ${cellSize}px)`;
  gridEl.style.height = `${cellSize * state.index.rows}px`;

  // Font sizes are computed here (plain px, no cqw/container-query) for the same
  // reason cell sizing moved off `1fr`: fewer content-aware/engine-dependent CSS
  // sizing mechanisms in the chain, less room for cross-browser divergence.
  const clueFontSize = clamp(4, cellSize * 0.22, 8);
  const letterFontSize = clamp(10, cellSize * 0.72, 22);
  gridEl.style.setProperty("--clue-font-size", `${clueFontSize}px`);
  gridEl.style.setProperty("--letter-font-size", `${letterFontSize}px`);

  for (const cellEl of gridEl.children) {
    cellEl.style.width = `${cellSize}px`;
    cellEl.style.height = `${cellSize}px`;
  }
}

export function renderGridShell(state, gridEl) {
  gridEl.innerHTML = "";

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
