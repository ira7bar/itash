// Per-device identity for the "who's looking at what" live-room feature: a
// stable user id and a color tint, persisted in localStorage (not scoped to
// any one puzzle, unlike storage.js) so the same person keeps the same color
// across reloads instead of looking like a new participant every time.

const USER_ID_KEY = "tashbetz:presence-user-id";
const USER_HUE_KEY = "tashbetz:presence-user-hue";

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

export function getUserId() {
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = randomId();
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

// Only a hue is randomized, not a full color -- every user's tint then
// shares the same saturation/lightness/alpha, so there's no chance of
// picking something so dark or so pale that the letter underneath it stops
// being readable.
export function getUserHue() {
  let hue = localStorage.getItem(USER_HUE_KEY);
  if (!hue) {
    hue = String(Math.floor(Math.random() * 360));
    localStorage.setItem(USER_HUE_KEY, hue);
  }
  return Number(hue);
}

// Two shades of the same hue, mirroring how the app already distinguishes
// "the word you're in" from "the exact cell you're on" for your OWN cursor
// (--in-word-bg vs --active-bg) -- here for every other participant's
// cursor instead. Kept much lighter than that own-cursor pair (0.28/0.55)
// on purpose: this is ambient "who's working on what" texture, not a
// primary highlight, so it shouldn't compete for attention.
export function presenceWordTint(hue) {
  return `hsla(${hue}, 65%, 50%, 0.16)`;
}

export function presenceLetterTint(hue) {
  return `hsla(${hue}, 65%, 50%, 0.30)`;
}
