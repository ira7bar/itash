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
  // Reverse of word.clueCell: which word(s) a tap on a given (blocked) clue
  // cell should resolve to. Almost always one word, but a clue cell can be
  // shared by an across and a down word at once (two clue boxes stacked in
  // the same cell) -- see getWordsForClueCell.
  const clueCellIndex = new Map();

  for (const word of puzzle.words) {
    wordsById.set(word.id, word);
    for (const [r, c] of word.cells) {
      cellIndex[r][c][word.direction] = word.id;
    }
    if (word.clueCell) {
      const key = `${word.clueCell[0]}_${word.clueCell[1]}`;
      if (!clueCellIndex.has(key)) clueCellIndex.set(key, []);
      clueCellIndex.get(key).push(word.id);
    }
  }

  return { wordsById, cellIndex, clueCellIndex, rows, cols };
}

export function getCellEntry(index, row, col) {
  return index.cellIndex[row]?.[col] ?? null;
}

// Word(s) whose printed clue is physically in this cell: empty for a plain
// (non-clue) blocked cell, one word for almost every clue cell, or two for a
// clue cell shared between an across and a down word. When there are two,
// the source PDF always stacks the horizontal clue on top and the vertical
// clue below it (validated in parse_puzzle.py's _split_dual_direction_clues)
// -- callers with a tap position use that to pick between them.
export function getWordsForClueCell(state, row, col) {
  const ids = state.index.clueCellIndex.get(`${row}_${col}`);
  if (!ids) return [];
  return ids.map((id) => state.index.wordsById.get(id));
}

function isStartCell(word, row, col) {
  const [r0, c0] = word.cells[0];
  return r0 === row && c0 === col;
}

function isEndCell(word, row, col) {
  const [rl, cl] = word.cells[word.cells.length - 1];
  return rl === row && cl === col;
}

function isWordEmpty(state, word) {
  return word.cells.every(([r, c]) => !state.answers[r][c]);
}

// A tap enters "whole word" (auto-advance) mode for a direction whose word
// either STARTS at this exact cell (typing forward -- the convention every
// crossword solver knows from paper: you begin at the numbered cell -- and
// lands exactly there, however full or empty the word already is; see
// nextTypeIndex for how already-filled cells get skipped as typing
// advances, never on the initial tap itself), or ENDS at this exact cell and
// still has something to delete (backspacing backward -- the mirror image,
// for reviewing/correcting a word from its last letter). Any other cell --
// a mid-word cell, or an end cell whose word is already empty -- is
// unambiguous: there's nothing to auto-advance into either direction, so a
// tap there just edits that one letter.
function wholeWordCandidates(state, entry, row, col) {
  const candidates = [];
  for (const direction of ["horizontal", "vertical"]) {
    const wordId = entry[direction];
    if (!wordId) continue;
    const word = state.index.wordsById.get(wordId);
    const forTyping = isStartCell(word, row, col);
    const forDeleting = isEndCell(word, row, col) && !isWordEmpty(state, word);
    if (forTyping || forDeleting) {
      candidates.push(direction);
    }
  }
  return candidates;
}

// Where typing forward should land after filling word.cells[idx]: the next
// still-blank cell ahead in state.answers, if any -- skipping past cells
// already filled in, almost always correctly, via a crossing word --
// otherwise the plain next cell in sequence, so a full rewrite of an
// already-full word (see wholeWordCandidates: tapping a FULL word's start
// is almost always "this was wrong, redo it") still advances normally;
// otherwise -1, at the word's actual last cell with nowhere left to go.
function nextTypeIndex(state, word, idx) {
  for (let i = idx + 1; i < word.cells.length; i++) {
    const [r, c] = word.cells[i];
    if (!state.answers[r][c]) return i;
  }
  return idx < word.cells.length - 1 ? idx + 1 : -1;
}

export function createState(puzzle) {
  const index = buildIndex(puzzle);
  const answers = Array.from({ length: index.rows }, () => Array(index.cols).fill(""));
  // Which hue filled each answer cell, parallel to `answers` -- null for a
  // cell that's empty, or was filled before this device ever synced to any
  // room (see ownAnswersForNewRoom for why that distinction matters). Only
  // meaningful/rendered inside a live room; solo solving has exactly one
  // possible author, so there's nothing for it to show.
  const answerHues = Array.from({ length: index.rows }, () => Array(index.cols).fill(null));
  return {
    puzzle,
    index,
    answers,
    answerHues,
    activeCell: null,
    activeDirection: null,
    roomId: null,
    // Other participants' current active cell + color tint, keyed by their
    // user id -- never includes this device's own entry (see
    // applyRemotePresence), since the local active cell is already shown via
    // the .active class, not a presence tint.
    presence: new Map(),
  };
}

export function setAnswerHue(state, row, col, hue) {
  state.answerHues[row][col] = hue ?? null;
}

// Rebuilds state.answerHues from a room's full snapshot map. Same
// full-replace reasoning as applyRemoteAnswers.
export function applyRemoteAnswerHues(state, huesMap) {
  const { rows, cols } = state.index;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      state.answerHues[r][c] = null;
    }
  }
  for (const key of Object.keys(huesMap || {})) {
    const [r, c] = key.split("_").map(Number);
    if (r >= 0 && r < rows && c >= 0 && c < cols) {
      state.answerHues[r][c] = huesMap[key];
    }
  }
}

// The subset of this user's own answers to seed a brand-new room with: a
// cell counts as "theirs" if its hue is unset (written before this device
// ever synced to any room -- genuinely local/solo authorship) or matches
// `hue` (their own past contributions, even from a room they've since
// left). Cells some OTHER participant filled in a previous room are
// deliberately excluded -- solo progress carrying into a room you create is
// the whole point of seeding it at all, but another room's collaborators'
// answers silently seeding an unrelated new room is not. Both maps come
// back keyed the same `r_c` shape pushRoomState/pushAnswerCell already use,
// ready to push as-is.
export function ownAnswersForNewRoom(state, hue) {
  const answers = {};
  const answerHues = {};
  const { rows, cols } = state.index;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const letter = state.answers[r][c];
      const cellHue = state.answerHues[r][c];
      if (letter && (cellHue == null || cellHue === hue)) {
        const key = `${r}_${c}`;
        answers[key] = letter;
        answerHues[key] = hue;
      }
    }
  }
  return { answers, answerHues };
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

// Rebuilds the "who else is looking at what" map from a room's presence
// snapshot. Drops this device's own entry (selfUserId) -- pushed by main.js
// so other participants can render it, but never meaningful to render for
// ourselves -- and anything malformed (e.g. a stale/partial write caught
// mid-flight).
export function applyRemotePresence(state, presenceMap, selfUserId) {
  const presence = new Map();
  for (const [userId, entry] of Object.entries(presenceMap || {})) {
    if (userId === selfUserId) continue;
    if (!entry || typeof entry.row !== "number" || typeof entry.col !== "number") continue;
    presence.set(userId, entry);
  }
  state.presence = presence;
}

// Which cells belong to the word at (row, col) in the given direction, so
// render.js can lightly tint a remote participant's WHOLE active word, not
// just the single cell they're on right now -- mirroring how the local
// player's own in-word/active distinction already works. Returns null when
// direction is falsy (single-letter mode: nothing beyond that one cell to
// highlight) or when that direction doesn't actually resolve to a word
// there (a stale/malformed presence write).
export function getWordCellsForPresence(state, row, col, direction) {
  if (!direction) return null;
  const entry = getCellEntry(state.index, row, col);
  const wordId = entry?.[direction];
  return wordId ? state.index.wordsById.get(wordId)?.cells ?? null : null;
}

export function isBlocked(state, row, col) {
  return state.puzzle.grid[row][col].type === "blocked";
}

export function isPuzzleComplete(state) {
  const { rows, cols } = state.index;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!isBlocked(state, r, c) && !state.answers[r][c]) return false;
    }
  }
  return true;
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

  // Rare: this cell starts both an across and a down word. Tapping it
  // again flips between them; otherwise keep the previous
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
// changed, and to know exactly which single cell to push to a live room
// (see pushAnswerCell in sync.js).
export function typeLetter(state, rawLetter) {
  if (!state.activeCell || isBlocked(state, state.activeCell.row, state.activeCell.col)) return null;
  const letter = normalizeLetter(rawLetter);
  if (!HEBREW_LETTER_RE.test(letter)) return null;
  const { row, col } = state.activeCell;
  const word = getActiveWord(state);

  state.answers[row][col] = letter;
  if (word) {
    const idx = word.cells.findIndex(([r, c]) => r === row && c === col);
    const nextIdx = idx >= 0 ? nextTypeIndex(state, word, idx) : -1;
    if (nextIdx >= 0) {
      const [nr, nc] = word.cells[nextIdx];
      state.activeCell = { row: nr, col: nc };
    }
  }
  return { row, col, letter };
}

// Clears every filled answer cell -- the "start over" action. Returns which
// cells changed so each can be synced to a live room individually, never as
// one whole-room overwrite (see pushRoomState's warning in sync.js).
export function clearBoard(state) {
  const { rows, cols } = state.index;
  const clearedCells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (state.answers[r][c]) {
        clearedCells.push([r, c]);
        state.answers[r][c] = "";
        state.answerHues[r][c] = null;
      }
    }
  }
  return { clearedCells };
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

