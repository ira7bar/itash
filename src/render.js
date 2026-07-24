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

const MIN_CELL_SIZE = 32; // enforce a legible floor even if that means the grid overflows
const MAX_CELL_SIZE = 44; // matches the old 700px-wide desktop cap (700 / 16 cols)

export function sizeGridToSquareCells(state, gridEl, wrapEl) {
  // Round down to a whole pixel: 16 fractional-px tracks (e.g. 23.125px each) can each
  // get individually sub-pixel-rounded by the browser, and that accumulated error was
  // pushing the grid's actual rendered width past its CSS-declared width, clipping the
  // rightmost column/border against the scroll container. Whole pixels make every
  // track's rendered size unambiguous, and setting the grid's own width explicitly
  // (rather than leaving it to a separate CSS width rule) means there's exactly one
  // source of truth for the total size instead of two that could disagree by a pixel.
  //
  // Measured against the WRAPPER's width, not the grid's own -- once a minimum cell
  // size is enforced, the grid can end up wider than its wrapper (intentionally, so
  // it scrolls/pinch-zooms on narrow phones instead of shrinking text/arrows into
  // illegibility), so the grid's own clientWidth can no longer be trusted as "the
  // available space".
  const available = wrapEl.clientWidth;
  const rawSize = Math.floor(available / state.index.cols);
  const cellSize = Math.min(MAX_CELL_SIZE, Math.max(MIN_CELL_SIZE, rawSize));
  gridEl.style.width = `${cellSize * state.index.cols}px`;
  gridEl.style.gridTemplateColumns = `repeat(${state.index.cols}, ${cellSize}px)`;
  gridEl.style.gridTemplateRows = `repeat(${state.index.rows}, ${cellSize}px)`;
  gridEl.style.height = `${cellSize * state.index.rows}px`;

  // Font sizes are computed here (plain px, no cqw/container-query) for the same
  // reason cell sizing moved off `1fr`: fewer content-aware/engine-dependent CSS
  // sizing mechanisms in the chain, less room for cross-browser divergence.
  const clueFontSize = clamp(4, cellSize * 0.24, 10);
  const letterFontSize = clamp(10, cellSize * 0.72, 32);
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

      const hintsEl = document.createElement("div");
      hintsEl.className = "direction-hints";
      cellEl.appendChild(hintsEl);

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

    const hintsEl = cellEl.querySelector(".direction-hints");
    if (!blocked) {
      const dirs = state.puzzle.grid[r][c].startsDirections ?? [];
      hintsEl.innerHTML = "";
      if (dirs.includes("horizontal")) {
        const hintH = document.createElement("span");
        hintH.className = "hint hint-h";
        hintH.textContent = "←"; // thin left arrow: word runs leftward from here.
        // A filled triangle (◀) anti-aliases into an illegible blob at these tiny
        // sizes; a simple line-arrow glyph stays readable.
        hintsEl.appendChild(hintH);
      }
      if (dirs.includes("vertical")) {
        const hintV = document.createElement("span");
        hintV.className = "hint hint-v";
        hintV.textContent = "↓"; // thin down arrow: word runs downward from here
        hintsEl.appendChild(hintV);
      }
    } else {
      hintsEl.innerHTML = "";
    }

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
