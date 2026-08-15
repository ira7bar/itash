import { normalizeLetter } from "./hebrew.js";

const STORAGE_KEY_PREFIX = "tashbetz:";

// Keyed by the puzzle's own dated filename (main.js sets puzzle.meta.week
// right after fetching it), not by meta.source/page -- those come from the
// PDF and are deliberately kept constant week to week (see parse_puzzle.py's
// docs), so keying off them would load last week's answers into this week's
// differently-shaped grid on solo open instead of starting fresh.
function keyFor(puzzle) {
  return `${STORAGE_KEY_PREFIX}${puzzle.meta.week}`;
}

export function saveProgress(state) {
  const key = keyFor(state.puzzle);
  const payload = {
    answers: state.answers,
    draftMode: state.draftMode,
    draftHorizontal: state.draftHorizontal,
    draftVertical: state.draftVertical,
  };
  try {
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (err) {
    console.warn("Could not save progress:", err);
  }
}

export function loadProgress(state) {
  const key = keyFor(state.puzzle);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const payload = JSON.parse(raw);
    if (payload.answers) {
      // Normalize here too: progress saved before final-form/English-keyboard
      // normalization existed may still have un-normalized letters in it.
      state.answers = payload.answers.map((row) => row.map((letter) => (letter ? normalizeLetter(letter) : letter)));
    }
    if (typeof payload.draftMode === "boolean") state.draftMode = payload.draftMode;
    if (payload.draftHorizontal) {
      state.draftHorizontal = payload.draftHorizontal.map((row) =>
        row.map((letter) => (letter ? normalizeLetter(letter) : letter))
      );
    }
    if (payload.draftVertical) {
      state.draftVertical = payload.draftVertical.map((row) =>
        row.map((letter) => (letter ? normalizeLetter(letter) : letter))
      );
    }
  } catch (err) {
    console.warn("Could not load saved progress:", err);
  }
}
