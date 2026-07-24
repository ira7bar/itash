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
  const blockedOverrides = Array.from({ length: index.rows }, () => Array(index.cols).fill(null));
  return {
    puzzle,
    index,
    answers,
    blockedOverrides, // null = use puzzle's original type; true/false = manual tweak override
    activeCell: null,
    activeDirection: null,
    editMode: false,
  };
}

export function isBlocked(state, row, col) {
  const override = state.blockedOverrides[row][col];
  if (override !== null) return override;
  return state.puzzle.grid[row][col].type === "blocked";
}

export function toggleBlocked(state, row, col) {
  const current = isBlocked(state, row, col);
  state.blockedOverrides[row][col] = !current;
  syncIndexWithOverrides(state);
  if (state.activeCell && isBlocked(state, state.activeCell.row, state.activeCell.col)) {
    state.activeCell = null;
    state.activeDirection = null;
  }
}

// Recomputes the word-run index against the current blocked matrix (original + overrides).
// Call this after restoring saved overrides from storage, as well as after each manual toggle.
export function syncIndexWithOverrides(state) {
  state.index = rebuildIndexWithOverrides(state);
  return state.index;
}

function rebuildIndexWithOverrides(state) {
  const { rows, cols } = state.index;
  const blocked = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => isBlocked(state, r, c))
  );

  const words = [];
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      if (blocked[r][c]) { c++; continue; }
      const start = c;
      while (c < cols && !blocked[r][c]) c++;
      const end = c - 1;
      if (end - start + 1 >= 2) {
        const cells = [];
        for (let cc = end; cc >= start; cc--) cells.push([r, cc]);
        words.push({ id: `h-${r}-${start}`, direction: "horizontal", cells, clue: null, clueCell: null });
      }
    }
  }
  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows) {
      if (blocked[r][c]) { r++; continue; }
      const start = r;
      while (r < rows && !blocked[r][c]) r++;
      const end = r - 1;
      if (end - start + 1 >= 2) {
        const cells = [];
        for (let rr = start; rr <= end; rr++) cells.push([rr, c]);
        words.push({ id: `v-${start}-${c}`, direction: "vertical", cells, clue: null, clueCell: null });
      }
    }
  }

  // preserve original clue text where a run is unchanged from the source puzzle
  const originalIndex = buildIndex(state.puzzle);
  for (const word of words) {
    const orig = originalIndex.wordsById.get(word.id);
    if (orig) {
      word.clue = orig.clue;
      word.clueCell = orig.clueCell;
    }
  }

  const wordsById = new Map(words.map((w) => [w.id, w]));
  const cellIndex = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ horizontal: null, vertical: null }))
  );
  for (const word of words) {
    for (const [r, c] of word.cells) cellIndex[r][c][word.direction] = word.id;
  }
  return { wordsById, cellIndex, rows, cols };
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
