import { normalizeLetter } from "./hebrew.js";

const STORAGE_KEY_PREFIX = "tashbetz:";

function keyFor(puzzle) {
  return `${STORAGE_KEY_PREFIX}${puzzle.meta.source}:${puzzle.meta.page}`;
}

export function saveProgress(state) {
  const key = keyFor(state.puzzle);
  const payload = { answers: state.answers, unsureWords: [...state.unsureWords] };
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
    if (payload.unsureWords) state.unsureWords = new Set(payload.unsureWords);
  } catch (err) {
    console.warn("Could not load saved progress:", err);
  }
}
