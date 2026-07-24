const STORAGE_KEY_PREFIX = "tashbetz:";

function keyFor(puzzle) {
  return `${STORAGE_KEY_PREFIX}${puzzle.meta.source}:${puzzle.meta.page}`;
}

export function saveProgress(state) {
  const key = keyFor(state.puzzle);
  const payload = { answers: state.answers };
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
    if (payload.answers) state.answers = payload.answers;
  } catch (err) {
    console.warn("Could not load saved progress:", err);
  }
}
