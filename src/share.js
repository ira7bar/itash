// Shareable-progress links: the whole point is staying serverless -- there's no
// session id stored anywhere, the puzzle state IS the link. Answers get packed
// into a compact string in the URL's hash fragment; opening that link on any
// device (or handing it to family) loads that exact snapshot. Not live sync --
// each share is a snapshot at the moment you generate it.

const EMPTY_MARK = "_"; // safe: typed answers are always Hebrew letters (see interaction.js)

export function encodeAnswers(state) {
  const { rows, cols } = state.index;
  let flat = "";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      flat += state.answers[r][c] || EMPTY_MARK;
    }
  }
  const bytes = new TextEncoder().encode(flat);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  // URL-safe base64: '+' and '/' aren't valid in a URL fragment without encoding
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeAnswers(encoded, rows, cols) {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  const flat = new TextDecoder().decode(bytes);

  const answers = Array.from({ length: rows }, () => Array(cols).fill(""));
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = flat[i++];
      answers[r][c] = ch && ch !== EMPTY_MARK ? ch : "";
    }
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
  const match = location.hash.match(/^#s=(.+)$/);
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
