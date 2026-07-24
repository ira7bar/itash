// Shareable-progress links: the whole point is staying serverless -- there's no
// session id stored anywhere, the puzzle state IS the link. Answers get packed
// into a compact string in the URL's hash fragment; opening that link on any
// device (or handing it to family) loads that exact snapshot. Not live sync --
// each share is a snapshot at the moment you generate it.
//
// Encoding: only FILLED cells are encoded (most of a 21x16 grid is empty most
// of the time, so encoding all 336 positions wastes space on "empty" markers).
// Each filled cell becomes exactly 3 plain-ASCII base-36 characters: 2 for its
// flat grid position (0-335 fits easily) and 1 for the letter -- Hebrew's
// Unicode block is a contiguous 27-code-point range (including the final
// forms ך/ם/ן/ף/ץ interspersed within it), so "which letter" is just
// (charCode - HEBREW_BASE), a number 0-26 that fits in a single base-36
// digit. The result is already URL-safe ASCII, no base64 step needed.

const HEBREW_BASE = 0x05d0; // א -- start of the Hebrew Unicode block
const RADIX = 36;
const POS_WIDTH = 2; // base-36 digits; 36^2 = 1296, comfortably covers 0-335

export function encodeAnswers(state) {
  const { rows, cols } = state.index;
  let out = "";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const letter = state.answers[r][c];
      if (!letter) continue;
      const letterIndex = letter.charCodeAt(0) - HEBREW_BASE;
      if (letterIndex < 0 || letterIndex > 26) continue; // not a plain Hebrew letter; skip
      const flatIndex = r * cols + c;
      out += flatIndex.toString(RADIX).padStart(POS_WIDTH, "0");
      out += letterIndex.toString(RADIX);
    }
  }
  return out;
}

export function decodeAnswers(encoded, rows, cols) {
  const answers = Array.from({ length: rows }, () => Array(cols).fill(""));
  const entryWidth = POS_WIDTH + 1;
  for (let i = 0; i + entryWidth <= encoded.length; i += entryWidth) {
    const flatIndex = parseInt(encoded.slice(i, i + POS_WIDTH), RADIX);
    const letterIndex = parseInt(encoded.slice(i + POS_WIDTH, i + entryWidth), RADIX);
    if (Number.isNaN(flatIndex) || Number.isNaN(letterIndex)) continue;
    const r = Math.floor(flatIndex / cols);
    const c = flatIndex % cols;
    if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
    answers[r][c] = String.fromCharCode(HEBREW_BASE + letterIndex);
  }
  return answers;
}

export function getShareUrl(state) {
  const encoded = encodeAnswers(state);
  const url = new URL(location.href);
  url.hash = `s=${encoded}`;
  return url.toString();
}

// Returns true if a shared snapshot was found and loaded into state.answers.
// Clears the hash afterward so reloading the (now-bookmarked) page doesn't
// keep re-applying an old snapshot over newer local progress.
export function loadFromUrlIfPresent(state) {
  const match = location.hash.match(/^#s=([0-9a-z]*)$/);
  if (!match) return false;
  try {
    state.answers = decodeAnswers(match[1], state.index.rows, state.index.cols);
    history.replaceState(null, "", location.pathname + location.search);
    return true;
  } catch (err) {
    console.warn("Could not load shared progress from URL:", err);
    return false;
  }
}
