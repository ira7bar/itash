# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

תשחץ הארץ (Tashbetz Ha'aretz) — a live, collaborative solver for the weekly Haaretz Hebrew crossword. Two parts live in this working directory:

- **Root (`itash/`)** — an offline, one-off pipeline that turns a weekly `tashbetz.pdf` into `puzzle.json` + `puzzle.png`. Not a git repo; a scratch workspace of parser code plus many one-shot `check_*.py` / `*_check.json` debugging scripts written while reverse-engineering the PDF's layout (grid detection, arrow/clue routing, split cells, rotation, etc.). Most of these are throwaway investigation artifacts, not a maintained tool suite — don't assume they still run cleanly or need to.
- **`pwa/`** — the actual shipped product: a static, no-build-step Progressive Web App that loads `puzzle.json`/`puzzle.png` and lets one or more people solve the grid together in real time. This is its own git repo (remote `https://github.com/ira7bar/itash.git`, deployed via GitHub Pages at `https://ira7bar.github.io/itash/`).

When asked to "fix the app" or work on the solving experience, the work is almost always in `pwa/`. Work in the root only concerns generating/repairing a given week's puzzle data.

## The weekly parsing pipeline (root)

```
python parse_puzzle.py path/to/tashbetz.pdf --page 3 --out puzzle.json
```

Extracts everything from the PDF's vector/text layers — no OCR, no image processing. Documented in detail in the module docstring at the top of `parse_puzzle.py`:

- **Grid structure**: clue cells are solid light-blue fill rectangles (`BLUE_FILL` in `parse_puzzle.py`); any grid cell overlapping one is `blocked`, everything else is `playable`.
- **Clue text**: bucketed by cell, then by which fill rectangle within the cell (some cells hold two stacked clue boxes divided by a rule line, not one multi-line clue) — see `grid[r][c].clueParts` vs the combined `grid[r][c].clue`.
- **Word runs**: derived purely from grid geometry (maximal horizontal/vertical strips of ≥2 contiguous playable cells), not from the PDF's own clue numbering.
- **Known limitation**: a handful of cells route their clue via a bent/hook arrow to a non-adjacent run (e.g. a vertical word starting in the top row, with no cell above it to hold the clue). Adjacency-based matching can't catch these; they're expected to come out with a missing/wrong clue and get fixed by hand afterward, not solved in the parser.

Output schema (`puzzle.json`): `meta` (rows, cols, source PDF/page, rendered image dimensions, and the grid's pixel origin/cell-size within that image — this is what lets the PWA overlay be purely percentage-based, see below), `grid` (2D array of cell type + clue text), `words` (id, direction, ordered list of `[row, col]` cells), `warnings`.

The many root-level `check_*.py` scripts and matching `*.json` outputs were ad hoc tools for validating specific pieces of this extraction (arrow positions, glyph rotation, split-cell detection, etc.) against a specific PDF. Treat them as reference/history, not a CLI surface to keep working.

## The PWA (`pwa/`)

No npm, no bundler, no build step — plain ES modules loaded directly by the browser (`<script type="module" src="src/main.js">`). Firebase's SDK is likewise loaded as native ES modules straight from Firebase's CDN, and only fetched once a live room is actually created/joined — solo solving never touches the network. This "no build step" property is deliberate; don't introduce a bundler/framework without discussing it first.

### Running it locally

Serve `pwa/` with any static file server (e.g. `python -m http.server 8123` from inside `pwa/`) and open `index.html`. The `dev/` scripts (see Testing below) assume it's reachable at `http://localhost:8123`.

### Core architecture

The grid is a **rendered image of the actual PDF page**, not a reconstructed CSS grid — clue text, dividers, borders, and the source's own direction arrows all come through pixel-perfect because none of it is redrawn. `render.js` positions a transparent, purely percentage-based interactive overlay (`div.cell` per grid cell) on top of that `<img>`, using `puzzle.meta`'s origin/cell-size fields converted to percentages of the image's own box. Percentages (not pixel math) mean the overlay stays aligned at any viewport size or native pinch-zoom level with zero resize handling.

Module responsibilities (`pwa/src/`):
- **`model.js`** — all grid/word-run/state logic, deliberately DOM-free so it could survive a future rendering-layer swap unchanged. Owns cell selection, typing/backspace, unsure-word toggling, and the clue-cell reverse index — see **Typing & selection model** below for the actual rules, they're more subtle than a one-liner.
- **`render.js`** — builds the cell overlay once (also marking clue cells that resolve to a word as `.clue-tappable`, for the cursor affordance), then re-renders per-cell state (letter, active/in-word/unsure/blocked classes) on every change.
- **`interaction.js`** — wires DOM events to `model.js`: click-to-select (including clue-cell taps), the hidden-input trick for summoning the mobile keyboard, long-press (450ms, cancelled on >10px move) to toggle a word "unsure", arrow-key navigation, viewport panning (see **Viewport / pan-to-follow** below), and the share/join/leave-room UI.
- **`hebrew.js`** — normalizes every typed character before it's committed: English-keyboard-layout fallback (maps by physical key position per the Hebrew SI 1452 layout, including the three letters that live on punctuation keys — comma/period/semicolon), then collapses final-form letters (ך/ם/ן/ף/ץ) to their regular form, since a crossword cell can't reflect "is this word-final" when it's often also a middle cell of the crossing word.
- **`storage.js`** — solo progress autosave to `localStorage`, keyed by puzzle source+page.
- **`share.js` / `sync.js`** — live collaborative rooms via Firebase Realtime Database. `sync.js` is the *only* module that touches Firebase; everything else deals in plain answer maps, so the backend could be swapped by rewriting this one file. A room's full state is only ever overwritten wholesale at creation time; every ongoing edit (`pushAnswerCell`, `pushUnsureFlag`) writes a single child path, never the whole room — concurrent edits from different people must never clobber each other. `main.js` wraps these pushes with one quiet retry (`pushWithRetry`) to cover a transient mobile network blip, and re-subscribes on `visibilitychange` to survive backgrounded tabs dropping their WebSocket.
- **`main.js`** — wires everything together, owns the room join/leave/create lifecycle and the puzzle-complete celebration trigger.
- **`firebase-config.js`** — public client config (not a secret — access control is via Realtime Database security rules, not by hiding this). Room IDs are random base36 strings embedded in the URL hash (`#room=xxxxxx`); opening a room's link/code joins that live room and overrides local progress, same as any explicit "load this" action.

Service worker (`service-worker.js`) does app-shell caching for offline use (cache-first for the shell, network-first-with-fallback for `puzzle.json`/`puzzle.png` so a new week's puzzle is picked up when online). Bump `CACHE_NAME` when shipping a shell file change so clients pick it up.

### Typing & selection model

None of this is validated against a solution key — there isn't one; the app only ever knows "filled" vs "blank", never "correct." That constraint shapes several of these rules.

- **Entering a word** (`selectCell`): tapping a word's **start** cell always enters whole-word typing mode for it, regardless of how full it already is. Tapping its **end** cell enters backspacing mode, but only if it has at least one letter to delete. Any other cell (mid-word, or an end cell of an empty word) is unambiguous and just edits that one letter directly. A cell that's the start of one direction *and* the end of the other, or the start of both an across and a down word, is resolved by whichever candidate is unambiguous, or by re-tapping to flip between them.
- **The active cell never gets redirected on selection** — tapping (or clue-jumping to) a word's start always lands exactly there, letter-for-letter where you tapped, even if that cell already has a letter in it. This is deliberate: silently moving the cursor away from what was literally tapped is surprising, especially combined with auto-pan (see below) — better to "waste" a keystroke reconfirming an already-filled cell than to jump the view somewhere the user didn't point at.
- **Typing forward** (`typeLetter` / `nextTypeIndex`) always fills whatever the active cell currently is, then decides where the *next* keystroke goes by scanning forward for the next still-blank cell in the word — skipping over cells already filled in (almost always correctly, via a crossing word) rather than forcing you to retype them. If no blank cells remain ahead (a full word, most commonly a deliberate full rewrite of a wrong answer — see below), it falls back to plain sequential advance instead, so a full rewrite still progresses letter-by-letter through every cell. At the word's actual last cell, it stays put either way.
- **A fully-filled word, tapped again, means "start over."** Since there's no correctness checking, a 100%-filled word being tapped again is almost always "this was wrong, let me redo it" — so it enters ordinary sequential whole-word typing from its first cell, overwriting every letter in order, not a no-op.
- **Backspace never skips.** It's deliberately kept simple and literal — clears the active cell if it has a letter, else steps back one cell and clears that — so it stays the reliable manual way to revisit and fix one specific cell, a path that forward-typing's skip behavior doesn't take away.
- **Clue-cell taps** (`getWordsForClueCell` in `model.js`, `resolveClueTapWord` in `interaction.js`): a blocked cell can be the printed clue location for zero, one, or (for a clue cell shared between an across and a down word) two different words — reverse-indexed off `word.clueCell` at load time. When two words share a clue cell, the tap's Y position within the cell picks between them: top half is always the horizontal word's clue, bottom half always the vertical, a rule the parser validated (see `_split_dual_direction_clues` in `parse_puzzle.py`), not a heuristic. A resolved tap selects that word's start cell exactly as if it had been tapped directly (same rules as above apply from there).
- **Long-press-to-toggle-unsure** (`resolveWordForToggle`) uses whatever word was active *before* the press started (the timer fires on `pointerdown`, ahead of the eventual click's `selectCell`), since that reflects deliberate intent better than geometry. When neither direction is currently active and a cell crosses both, a word's **start** outranks its **end** as the tiebreaker — a start is always a deliberate tap, an end is often just wherever some other word's crossing happens to land.

### Viewport / pan-to-follow

The app deliberately does **not** implement its own zoom — it relies entirely on native OS/browser pinch-zoom (`user-scalable=yes`), never a CSS-transform zoom layer. Only *scroll position* is ever driven programmatically; two past Android bugs (see `git log`) came specifically from the app fighting the browser's own zoom/touch-action handling, so this boundary is intentional, not an oversight.

- **Native long-press-image menu is suppressed** on both the puzzle `<img>` and the overlay (`contextmenu` prevented in `interaction.js`), since Android can show its own "copy/share image" menu on a long-press that competes with the app's long-press-to-toggle-unsure gesture — even though the overlay sits on top and normally takes the touch, Android's image-menu detection isn't reliable DOM hit-testing.
- **Tapping a clue cell** scrolls the resolved word into view with `scrollIntoView({block:"center", inline:"center"})`, since it's jumping to content that wasn't necessarily near what was tapped.
- **While typing, backspacing, or arrow-navigating**, the active cell is kept in view with `{block:"nearest", inline:"nearest"}` — a no-op if it's already visible, so ordinary fast typing never jitters the page.
- **Horizontal scroll-padding** on `#grid-wrap` is set dynamically, right before each scroll, to a full cell's current rendered width (read live off `getBoundingClientRect()`, so it's correct at any pinch-zoom level) — this guarantees the *entire* next letter pans into view, not just part of it. Vertical is deliberately left at the browser default (no `scroll-padding-block`) per direct feedback that vertical panning already leaves comparable breathing room on its own.
- **Caveat for anyone touching this area**: real pinch-zoom is a compositor-level visual transform, not a CSS layout change, and Playwright has no way to simulate genuine OS-level pinch-zoom — touch-coordinate emulation and `document.body.style.zoom` sweeps were both tried here and neither reliably reproduces it. Treat any Playwright result about zoom/pan behavior as inconclusive until confirmed on a real phone.

### Testing

No automated test runner/CI — verification is done with one-off Playwright scripts in `pwa/dev/` (gitignored; local-only), each targeting a specific bug or feature (`test_live_two_clients.py`, `test_unsure_direction_and_delete_advance.py`, `test_hidden_input_position.py`, etc.) and writing its findings to a matching `*_report.json`. They assume the app is being served locally at `http://localhost:8123` (some `*_prod.py` variants instead point at the live GitHub Pages URL, for verifying real deploys). Follow this same pattern for new manual verification: a small standalone script under `dev/` that drives the page with Playwright and asserts/reports on the specific behavior in question, rather than adding a formal test framework.

Many past mobile-specific bugs (documented in commit history and inline comments) came from Android/iOS quirks in how the OS keyboard, pinch-zoom, and long-press interact with the page — when touching `interaction.js`, `#hidden-input` positioning in `style.css`/`interaction.js`, or `touch-action`, be aware that real-device testing (not just Playwright) previously caught issues Playwright alone wouldn't.
