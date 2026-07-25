// Hebrew letter-input normalization, applied to every typed character before
// it's committed to a cell, in this order:
//
// 1. English-keyboard fallback: if the OS input language got left on English,
//    the physical key still sits under a specific Hebrew letter on the
//    standard Hebrew keyboard layout (SI 1452) -- translate by keyboard
//    POSITION, not by any phonetic guess, so muscle memory still works.
// 2. Final-form normalization: a crossword cell's glyph can't correctly
//    reflect "is this word-final," because the same cell is very often a
//    MIDDLE cell of the word crossing it in the other direction. Printed
//    Hebrew crosswords always use the regular (non-final) form for exactly
//    this reason, regardless of position -- so ך/ם/ן/ף/ץ always normalize
//    to כ/מ/נ/פ/צ.

const ENGLISH_KEYBOARD_TO_HEBREW = {
  q: "/", w: "'", e: "ק", r: "ר", t: "א", y: "ט", u: "ו", i: "ן", o: "ם", p: "פ",
  a: "ש", s: "ד", d: "ג", f: "כ", g: "ע", h: "י", j: "ח", k: "ל", l: "ך",
  z: "ז", x: "ס", c: "ב", v: "ה", b: "נ", n: "מ", m: "צ",
  // Three Hebrew letters live on PUNCTUATION keys on the standard layout, not
  // letter keys: comma -> ת, period -> ץ, semicolon -> ף. Easy to miss (as
  // this file did, at first) since every other entry is a letter-to-letter
  // mapping. Shifted variants (< > :) map the same way, since they're the
  // same physical key.
  ",": "ת", "<": "ת",
  ".": "ץ", ">": "ץ",
  ";": "ף", ":": "ף",
};

const FINAL_TO_REGULAR = {
  ך: "כ",
  ם: "מ",
  ן: "נ",
  ף: "פ",
  ץ: "צ",
};

export function normalizeLetter(ch) {
  const fromKeyboard = ENGLISH_KEYBOARD_TO_HEBREW[ch.toLowerCase()] ?? ch;
  return FINAL_TO_REGULAR[fromKeyboard] ?? fromKeyboard;
}
