// Pure grid/word-run logic. No DOM access here -- this is the part that
// would survive a future move to a different rendering layer unchanged.

export function buildIndex(puzzle) {
  const rows = puzzle.meta.rows;
  const cols = puzzle.meta.cols;
  const wordsById = new Map();
  const cellIndex = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ horizontal: null, vertical: null }))
  );

  for (const word of puzzle.words) {
    wordsById.set(word.id, word);
    for (const [r, c] of word.cells) {
      cellIndex[r][c][word.direction] = word.id;
    }
  }

  return { wordsById, cellIndex, rows, cols };
}

export function getCellEntry(index, row, col) {
  return index.cellIndex[row]?.[col] ?? null;
}

function isStartCell(word, row, col) {
  const [r0, c0] = word.cells[0];
  return r0 === row && c0 === col;
}

function isWordFull(state, word) {
  return word.cells.every(([r, c]) => Boolean(state.answers[r][c]));
}

// A tap only enters "whole word" (auto-advance) mode for a direction whose word
// STARTS at this exact cell and still has blanks left to fill -- that's the
// convention every crossword solver already knows from paper (you begin typing
// at the numbered cell). Any other cell -- a mid-word cell, or a start cell
// whose word is already full -- is unambiguous: there's nothing to auto-advance
// into, so a tap there just edits that one letter.
function wholeWordCandidates(state, entry, row, col) {
  const candidates = [];
  for (const direction of ["horizontal", "vertical"]) {
    const wordId = entry[direction];
    if (!wordId) continue;
    const word = state.index.wordsById.get(wordId);
    if (isStartCell(word, row, col) && !isWordFull(state, word)) {
      candidates.push(direction);
    }
  }
  return candidates;
}

export function createState(puzzle) {
  const index = buildIndex(puzzle);
  const answers = Array.from({ length: index.rows }, () => Array(index.cols).fill(""));
  return {
    puzzle,
    index,
    answers,
    activeCell: null,
    activeDirection: null,
  };
}

export function isBlocked(state, row, col) {
  return state.puzzle.grid[row][col].type === "blocked";
}

export function selectCell(state, row, col) {
  if (isBlocked(state, row, col)) return;
  const { index } = state;
  const entry = getCellEntry(index, row, col);
  const hasAnyWord = entry && (entry.horizontal || entry.vertical);
  const isSameCell = state.activeCell && state.activeCell.row === row && state.activeCell.col === col;

  if (!hasAnyWord) {
    state.activeCell = { row, col };
    state.activeDirection = null;
    return;
  }

  const candidates = wholeWordCandidates(state, entry, row, col);

  if (candidates.length === 0) {
    // Not a fillable start cell for either direction: edit just this letter.
    state.activeCell = { row, col };
    state.activeDirection = null;
    return;
  }

  if (candidates.length === 1) {
    state.activeCell = { row, col };
    state.activeDirection = candidates[0];
    return;
  }

  // Rare: this cell starts both an across and a down word (still un-full).
  // Tapping it again flips between them; otherwise keep the previous
  // direction if it still applies, defaulting to horizontal.
  if (isSameCell && candidates.includes(state.activeDirection)) {
    state.activeDirection = state.activeDirection === "horizontal" ? "vertical" : "horizontal";
  } else if (!candidates.includes(state.activeDirection)) {
    state.activeDirection = candidates[0];
  }
  state.activeCell = { row, col };
}

export function getActiveWord(state) {
  if (!state.activeCell || !state.activeDirection) return null;
  const entry = getCellEntry(state.index, state.activeCell.row, state.activeCell.col);
  const wordId = entry?.[state.activeDirection];
  return wordId ? state.index.wordsById.get(wordId) : null;
}

export function typeLetter(state, letter) {
  if (!state.activeCell || isBlocked(state, state.activeCell.row, state.activeCell.col)) return;
  const { row, col } = state.activeCell;
  state.answers[row][col] = letter;

  const word = getActiveWord(state);
  if (!word) return;
  const idx = word.cells.findIndex(([r, c]) => r === row && c === col);
  if (idx >= 0 && idx < word.cells.length - 1) {
    const [nr, nc] = word.cells[idx + 1];
    state.activeCell = { row: nr, col: nc };
  }
}

export function backspace(state) {
  if (!state.activeCell) return;
  const { row, col } = state.activeCell;
  if (state.answers[row][col]) {
    state.answers[row][col] = "";
    return;
  }
  const word = getActiveWord(state);
  if (!word) return;
  const idx = word.cells.findIndex(([r, c]) => r === row && c === col);
  if (idx > 0) {
    const [pr, pc] = word.cells[idx - 1];
    state.activeCell = { row: pr, col: pc };
    state.answers[pr][pc] = "";
  }
}
