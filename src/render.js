import { isBlocked, getCellEntry, getActiveWord } from "./model.js";

// The grid is a rendered image of the actual PDF page -- clue text, dividers,
// borders, and the source's own direction arrows all come through pixel-perfect,
// since none of it is reconstructed in CSS. This module only positions a
// transparent, percentage-based interactive overlay on top of that image.
// Percentages (not pixels) mean the overlay stays aligned with the image at any
// display size or native pinch-zoom level with no resize recalculation needed.

export function setupImage(state, imageEl) {
  imageEl.src = state.puzzle.meta.image;
}

function cellRectPercent(state, row, col) {
  const { imageWidth, imageHeight, originX, originY, cellWidth, cellHeight } = state.puzzle.meta;
  const left = (originX + col * cellWidth) / imageWidth * 100;
  const top = (originY + row * cellHeight) / imageHeight * 100;
  const width = cellWidth / imageWidth * 100;
  const height = cellHeight / imageHeight * 100;
  return { left, top, width, height };
}

export function renderGridShell(state, overlayEl) {
  overlayEl.innerHTML = "";

  for (let r = 0; r < state.index.rows; r++) {
    for (let c = 0; c < state.index.cols; c++) {
      const rect = cellRectPercent(state, r, c);
      const cellEl = document.createElement("div");
      cellEl.className = "cell";
      cellEl.dataset.row = String(r);
      cellEl.dataset.col = String(c);
      cellEl.style.left = `${rect.left}%`;
      cellEl.style.top = `${rect.top}%`;
      cellEl.style.width = `${rect.width}%`;
      cellEl.style.height = `${rect.height}%`;

      const letterEl = document.createElement("div");
      letterEl.className = "letter";
      cellEl.appendChild(letterEl);

      overlayEl.appendChild(cellEl);
    }
  }
}

export function updateGrid(state, overlayEl) {
  const activeWord = getActiveWord(state);
  const activeWordCellSet = new Set((activeWord?.cells ?? []).map(([r, c]) => `${r},${c}`));

  const cells = overlayEl.children;
  for (let i = 0; i < cells.length; i++) {
    const cellEl = cells[i];
    const r = Number(cellEl.dataset.row);
    const c = Number(cellEl.dataset.col);
    const blocked = isBlocked(state, r, c);

    cellEl.classList.toggle("blocked", blocked);
    cellEl.classList.toggle("blank", !blocked);

    const letterEl = cellEl.querySelector(".letter");
    letterEl.textContent = blocked ? "" : (state.answers[r][c] ?? "");

    const isActive = state.activeCell && state.activeCell.row === r && state.activeCell.col === c;
    cellEl.classList.toggle("active", Boolean(isActive));
    cellEl.classList.toggle("in-word", !blocked && activeWordCellSet.has(`${r},${c}`));
  }
}
