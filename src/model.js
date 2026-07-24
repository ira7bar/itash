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

function pickDirection(index, row, col, preferredDirection) {
  const entry = getCellEntry(index, row, col);
  if (!entry) return null;
  if (preferredDirection && entry[preferredDirection]) return preferredDirection;
  if (entry.horizontal) return "horizontal";
  if (entry.vertical) return "vertical";
  return null;
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

  if (isSameCell && entry.horizontal && entry.vertical) {
    state.activeDirection = state.activeDirection === "horizontal" ? "vertical" : "horizontal";
    return;
  }

  const currentWordId =
    state.activeDirection && state.activeCell
      ? getCellEntry(index, state.activeCell.row, state.activeCell.col)?.[state.activeDirection]
      : null;

  if (currentWordId && (entry.horizontal === currentWordId || entry.vertical === currentWordId)) {
    state.activeDirection = entry.horizontal === currentWordId ? "horizontal" : "vertical";
  } else {
    state.activeDirection = pickDirection(index, row, col, state.activeDirection);
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
