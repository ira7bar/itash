// Pure grid/word-run logic. No DOM access here -- this is the part that
// would survive a future move to a different rendering layer unchanged.

import { normalizeLetter } from "./hebrew.js";

const HEBREW_LETTER_RE = /^[א-ת]$/;

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
    roomId: null,
    unsureWords: new Set(),
  };
}

// Sparse map of only the filled cells, for pushing to a live room -- no point
// syncing a few hundred empty-string entries over the network every keystroke.
export function flattenAnswers(state) {
  const map = {};
  const { rows, cols } = state.index;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (state.answers[r][c]) map[`${r}_${c}`] = state.answers[r][c];
    }
  }
  return map;
}

// Rebuilds state.answers from a room's full snapshot map. Always a full
// replace, never a merge -- a room update reflects everyone's current state
// including deletions, so a cell missing from the map means it's actually
// blank now, not "unchanged."
export function applyRemoteAnswers(state, answersMap) {
  const { rows, cols } = state.index;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      state.answers[r][c] = "";
    }
  }
  for (const key of Object.keys(answersMap || {})) {
    const [r, c] = key.split("_").map(Number);
    if (r >= 0 && r < rows && c >= 0 && c < cols) {
      // Normalize here too, not just on typing: a peer on an older cached
      // version of the app (before this normalization existed) could still
      // push an un-normalized final-form letter into a shared room.
      state.answers[r][c] = normalizeLetter(answersMap[key]);
    }
  }
}

// Sparse map ({wordId: true}, same shape as flattenAnswers) of word ids
// currently flagged "unsure", for pushing to a live room -- a map, not an
// array, so a single flag can be added/removed as its own child path.
export function flattenUnsure(state) {
  const map = {};
  for (const id of state.unsureWords) map[id] = true;
  return map;
}

export function applyRemoteUnsure(state, unsureMap) {
  state.unsureWords = new Set(Object.keys(unsureMap || {}));
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

// Returns { row, col, letter } for the cell that was actually written, or
// null if nothing was committed (e.g. stray punctuation from a mismapped
// key) -- callers use this both to skip a wasted render/save when nothing
// changed, and to know exactly which single cell to sync to a live room
// (never the whole grid -- see pushAnswerCell in sync.js for why).
export function typeLetter(state, rawLetter) {
  if (!state.activeCell || isBlocked(state, state.activeCell.row, state.activeCell.col)) return null;
  const letter = normalizeLetter(rawLetter);
  if (!HEBREW_LETTER_RE.test(letter)) return null;
  const { row, col } = state.activeCell;
  state.answers[row][col] = letter;

  const word = getActiveWord(state);
  if (word) {
    const idx = word.cells.findIndex(([r, c]) => r === row && c === col);
    if (idx >= 0 && idx < word.cells.length - 1) {
      const [nr, nc] = word.cells[idx + 1];
      state.activeCell = { row: nr, col: nc };
    }
  }
  return { row, col, letter };
}

// Which word a long-press at (row, col) should flag as unsure: if that cell
// is already the active one, use whichever direction is currently active
// (matches "flag the word I'm looking at right now"); otherwise fall back to
// the same horizontal-then-vertical preference used elsewhere.
function resolveWordForToggle(state, row, col) {
  const entry = getCellEntry(state.index, row, col);
  if (!entry) return null;
  const isCurrentlyActive = state.activeCell && state.activeCell.row === row && state.activeCell.col === col;
  if (isCurrentlyActive && state.activeDirection && entry[state.activeDirection]) {
    return state.index.wordsById.get(entry[state.activeDirection]);
  }
  const wordId = entry.horizontal || entry.vertical;
  return wordId ? state.index.wordsById.get(wordId) : null;
}

// Returns { wordId, isUnsure } for the word that was toggled, or null if the
// cell isn't part of any word.
export function toggleUnsure(state, row, col) {
  const word = resolveWordForToggle(state, row, col);
  if (!word) return null;
  let isUnsure;
  if (state.unsureWords.has(word.id)) {
    state.unsureWords.delete(word.id);
    isUnsure = false;
  } else {
    state.unsureWords.add(word.id);
    isUnsure = true;
  }
  return { wordId: word.id, isUnsure };
}

// Returns { row, col } for the cell that was actually cleared, or null if
// nothing changed -- same reasoning as typeLetter's return value.
export function backspace(state) {
  if (!state.activeCell) return null;
  const { row, col } = state.activeCell;
  if (state.answers[row][col]) {
    state.answers[row][col] = "";
    return { row, col };
  }
  const word = getActiveWord(state);
  if (!word) return null;
  const idx = word.cells.findIndex(([r, c]) => r === row && c === col);
  if (idx > 0) {
    const [pr, pc] = word.cells[idx - 1];
    state.activeCell = { row: pr, col: pc };
    state.answers[pr][pc] = "";
    return { row: pr, col: pc };
  }
  return null;
}
