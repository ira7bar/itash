"""
Weekly Haaretz Crossword Parser
=================================
Run this once a week against the new tashbetz.pdf to produce puzzle.json,
which the PWA then loads and renders. No image processing, no OCR --
everything is extracted from the PDF's vector/text layers, which are
exact and deterministic for this puzzle format.

Extraction approach:
  1. Grid structure: every clue cell is a solid-fill vector rectangle in
     a specific light-blue color. Any grid cell whose position overlaps
     one of these fills is "blocked"; everything else is "playable".
  2. Clue text: the PDF text layer has every word with exact coordinates.
     About half of all clue cells actually contain TWO separate stacked
     fill rectangles (each auto-sized to its own text), meaning the cell
     holds two distinct clue boxes divided by a rule line, not one
     multi-line clue. Words are bucketed first by cell, then by which of
     that cell's fill rectangles they fall inside, so each box's text
     stays separate (grid[r][c].clueParts) as well as available combined
     (grid[r][c].clue) for simple display.
  3. Word runs: computed purely from grid geometry -- any maximal
     horizontal or vertical strip of >=2 contiguous playable cells is a
     word. Each run's clue is the blocked cell immediately adjacent to
     its start (to the right for horizontal runs, since Hebrew is RTL;
     above for vertical runs).

Known limitation: a small number of cells (typically near the grid's
outer edges) use a bent/hook-shaped arrow to route a clue to a
non-adjacent run, because there's no adjacent cell available to hold
it (e.g. a vertical word starting in the very top row has no cell
above it). Adjacency-based matching cannot detect these, so a handful
of runs may come out with no clue or the wrong clue. This is treated as
a known rough edge, fixed later via the app's manual-tweak mode rather
than solved here.

Usage:
    python parse_puzzle.py path/to/tashbetz.pdf --page 3 --out puzzle.json
"""

import argparse
import json
import os
import re

import fitz

_SPACE_BEFORE_PUNCT = re.compile(r"\s+([,.?!:;…])")

BLUE_FILL = (0.8468757271766663, 0.9293659925460815, 0.9815365672111511)
FILL_COLOR_TOLERANCE = 0.05
EXPECTED_ROWS = 21
EXPECTED_COLS = 16


def close_color(a, b, tol=FILL_COLOR_TOLERANCE):
    return a is not None and b is not None and all(abs(x - y) < tol for x, y in zip(a, b))


def is_arrow_char(ch: str) -> bool:
    return ord(ch) >= 0x2190  # Unicode arrow/symbol block, well above Hebrew/Latin/punctuation


def find_grid_border(drawings):
    """The single stroked (unfilled) rectangle enclosing the whole grid."""
    candidates = [d for d in drawings if d.get("fill") is None and d.get("color") is not None]
    # the grid border is the largest stroked rectangle on the page
    best = None
    for d in candidates:
        r = d["rect"]
        if best is None or r.width * r.height > best.width * best.height:
            best = r
    return best


def build_grid(page, rows, cols):
    """Returns (blocked, origin, cell_bands). cell_bands[r][c] is a sorted list of
    (y0, y1) fill-rectangle ranges for that cell -- usually one (the whole cell),
    but sometimes two stacked ones, meaning the source PDF draws two distinct
    clue "boxes" sharing one grid cell, divided by a cosmetic rule line."""
    drawings = page.get_drawings()
    border = find_grid_border(drawings)
    if border is None:
        raise RuntimeError("Could not find the grid's outer border rectangle")

    x0, y0 = border.x0, border.y0
    cell_w = border.width / cols
    cell_h = border.height / rows

    blocked = [[False] * cols for _ in range(rows)]
    cell_bands = [[[] for _ in range(cols)] for _ in range(rows)]
    for d in drawings:
        if not close_color(d.get("fill"), BLUE_FILL):
            continue
        r = d["rect"]
        cx, cy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
        col = int((cx - x0) // cell_w)
        row = int((cy - y0) // cell_h)
        if 0 <= row < rows and 0 <= col < cols:
            blocked[row][col] = True
            cell_bands[row][col].append((r.y0, r.y1))

    for row_bands in cell_bands:
        for bands in row_bands:
            bands.sort()

    return blocked, (x0, y0, cell_w, cell_h), cell_bands


def extract_clue_text(page, rows, cols, origin, blocked, cell_bands):
    x0, y0, cell_w, cell_h = origin
    words = page.get_text("words")  # (x0, y0, x1, y1, text, block, line, word_no)

    # cell_words[r][c] is a list of per-band word lists, one list per fill rectangle
    # in that cell (top-to-bottom), so a two-box cell keeps its two texts separate.
    cell_words = [[None] * cols for _ in range(rows)]
    for r in range(rows):
        for c in range(cols):
            if blocked[r][c]:
                cell_words[r][c] = [[] for _ in cell_bands[r][c]]

    for w in words:
        wx0, wy0, wx1, wy1, text = w[0], w[1], w[2], w[3], w[4]
        if all(is_arrow_char(ch) for ch in text):
            continue  # pure arrow glyph, not clue text
        cx, cy = (wx0 + wx1) / 2, (wy0 + wy1) / 2
        col = int((cx - x0) // cell_w)
        row = int((cy - y0) // cell_h)
        if not (0 <= row < rows and 0 <= col < cols and blocked[row][col]):
            continue
        bands = cell_bands[row][col]
        # which band does this word's vertical center fall into? default to nearest.
        band_idx = min(range(len(bands)), key=lambda i: abs(cy - (bands[i][0] + bands[i][1]) / 2))
        cell_words[row][col][band_idx].append((w[5], w[6], w[7], wy0, wx0, text))

    def join(word_list):
        if not word_list:
            return None
        # Group by PyMuPDF's own (block, line) rather than raw y0: an underscore
        # glyph (used for fill-in-the-blank clues like "_ עפולה") has a slightly
        # different vertical extent than Hebrew letters, so its y0 can differ by a
        # point or two from other words on the SAME visual line -- sorting on raw
        # y0 was misreading that as "different line" and scrambling word order.
        ordered = sorted(word_list, key=lambda t: (t[0], t[1], -t[4]))
        joined = " ".join(t[5] for t in ordered)
        return _SPACE_BEFORE_PUNCT.sub(r"\1", joined)

    clue_text = [[None] * cols for _ in range(rows)]
    clue_parts = [[None] * cols for _ in range(rows)]
    for r in range(rows):
        for c in range(cols):
            if not blocked[r][c]:
                continue
            parts = [join(band_words) for band_words in cell_words[r][c]]
            parts = [p for p in parts if p]
            if parts:
                clue_parts[r][c] = parts
                # A cell with multiple parts always has a divider line between them
                # in the source image (whether they're two genuinely separate clues
                # for different directions, or a short label + its longer detail for
                # the same direction). A bare space blurs that boundary in plain-text
                # contexts like the clue banner, so join with a visible separator.
                clue_text[r][c] = " | ".join(parts)

    return clue_text, clue_parts


def find_word_runs(blocked, rows, cols, clue_text, clue_parts):
    words = []

    # Horizontal runs: maximal strips of playable cells within a row, length >= 2.
    # Hebrew is RTL, so a run's clue sits immediately to the RIGHT of its rightmost cell.
    # Do NOT fall back to the left neighbor when the right side is unavailable (e.g. the
    # run touches the grid's right edge) -- that case means the clue is routed in via a
    # bent/hook arrow from a non-adjacent cell, which simple adjacency cannot detect.
    # Guessing the nearest cell on the other side produces a confidently wrong match,
    # which is worse than leaving it unmatched for the manual-tweak fallback to catch.
    for r in range(rows):
        c = 0
        while c < cols:
            if blocked[r][c]:
                c += 1
                continue
            start = c
            while c < cols and not blocked[r][c]:
                c += 1
            end = c - 1  # inclusive
            if end - start + 1 >= 2:
                clue_col = end + 1
                clue = clue_text[r][clue_col] if clue_col < cols and blocked[r][clue_col] else None
                cells = [[r, cc] for cc in range(end, start - 1, -1)]  # fill order: right to left
                words.append({
                    "id": f"h-{r}-{start}",
                    "direction": "horizontal",
                    "cells": cells,
                    "clue": clue,
                    "clueCell": [r, clue_col] if clue is not None else None,
                })

    # Vertical runs: maximal strips of playable cells within a column, length >= 2.
    # A run's clue sits immediately ABOVE its topmost cell; same reasoning as above
    # applies to why there's no "below" fallback.
    for c in range(cols):
        r = 0
        while r < rows:
            if blocked[r][c]:
                r += 1
                continue
            start = r
            while r < rows and not blocked[r][c]:
                r += 1
            end = r - 1  # inclusive
            if end - start + 1 >= 2:
                clue_row = start - 1
                clue = clue_text[clue_row][c] if clue_row >= 0 and blocked[clue_row][c] else None
                cells = [[rr, c] for rr in range(start, end + 1)]  # fill order: top to bottom
                words.append({
                    "id": f"v-{start}-{c}",
                    "direction": "vertical",
                    "cells": cells,
                    "clue": clue,
                    "clueCell": [clue_row, c] if clue is not None else None,
                })

    _split_dual_direction_clues(words, clue_parts)
    return words


def _split_dual_direction_clues(words, clue_parts):
    """
    When a single clue cell is the clueCell for both a horizontal AND a vertical
    word, its two stacked clueParts are two genuinely separate clues, not one
    clue wrapped across two lines -- and validation across multiple examples
    showed a clean, consistent rule for which is which: the TOP part's arrow
    (on the adjacent run-start cell) always Y-aligns with the top band, and
    that's always the HORIZONTAL clue; the bottom part is always VERTICAL.
    Only applied where a cell is confirmed to serve both directions -- single-
    direction cells keep their combined text, since that split isn't validated
    for the "one clue spanning two lines" case (e.g. a label + its detail).
    """
    by_clue_cell = {}
    for w in words:
        if w["clueCell"] is not None:
            by_clue_cell.setdefault(tuple(w["clueCell"]), []).append(w)

    for (r, c), cell_words in by_clue_cell.items():
        directions = {w["direction"] for w in cell_words}
        if directions != {"horizontal", "vertical"}:
            continue
        parts = clue_parts[r][c]
        if not parts or len(parts) != 2:
            continue
        for w in cell_words:
            w["clue"] = parts[0] if w["direction"] == "horizontal" else parts[1]


def render_page_image(page, image_path, scale=3):
    """
    Renders the full PDF page to a PNG at the given scale. The app displays this
    image as-is (clue text, dividers, and the source's own direction arrows all
    come through pixel-perfect, since nothing about them is reconstructed) and
    overlays a transparent, precisely-positioned interactive grid on top of it.
    Returns (image_width, image_height) in pixels, for coordinate conversion.
    """
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale))
    pix.save(image_path)
    return pix.width, pix.height


def build_puzzle_json(pdf_path, page_number, image_path, image_scale=3, rows=EXPECTED_ROWS, cols=EXPECTED_COLS):
    doc = fitz.open(pdf_path)
    page = doc[page_number - 1]

    image_width, image_height = render_page_image(page, image_path, image_scale)

    blocked, origin, cell_bands = build_grid(page, rows, cols)
    clue_text, clue_parts = extract_clue_text(page, rows, cols, origin, blocked, cell_bands)
    words = find_word_runs(blocked, rows, cols, clue_text, clue_parts)

    # Mark each word's starting cell with its direction, so the app can draw a small
    # arrow there -- not a reconstruction of the source PDF's (sometimes bent) arrow
    # glyphs, just an indicator derived from our own already-validated run geometry,
    # to help the solver see at a glance where each word starts and which way it runs.
    starts_directions = [[[] for _ in range(cols)] for _ in range(rows)]
    for w in words:
        sr, sc = w["cells"][0]
        starts_directions[sr][sc].append(w["direction"])

    grid = []
    for r in range(rows):
        row_out = []
        for c in range(cols):
            if blocked[r][c]:
                cell = {"type": "blocked", "clue": clue_text[r][c]}
                if clue_parts[r][c] and len(clue_parts[r][c]) > 1:
                    cell["clueParts"] = clue_parts[r][c]
                row_out.append(cell)
            else:
                cell = {"type": "blank"}
                if starts_directions[r][c]:
                    cell["startsDirections"] = starts_directions[r][c]
                row_out.append(cell)
        grid.append(row_out)

    unmatched = [w for w in words if w["clue"] is None]

    x0, y0, cell_w, cell_h = origin
    return {
        "meta": {
            "rows": rows,
            "cols": cols,
            "source": pdf_path,
            "page": page_number,
            "image": os.path.basename(image_path),
            "imageWidth": image_width,
            "imageHeight": image_height,
            # Grid origin and cell size in the SAME pixel space as the rendered
            # image (PDF points * image_scale), so the app can position its
            # interactive overlay directly without knowing anything about PDF
            # coordinates itself.
            "originX": x0 * image_scale,
            "originY": y0 * image_scale,
            "cellWidth": cell_w * image_scale,
            "cellHeight": cell_h * image_scale,
        },
        "grid": grid,
        "words": words,
        "warnings": {
            "runs_without_clue": len(unmatched),
            "run_ids_without_clue": [w["id"] for w in unmatched],
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Parse a Haaretz-style crossword PDF into puzzle.json")
    parser.add_argument("pdf_path")
    parser.add_argument("--page", type=int, default=3)
    parser.add_argument("--out", default="puzzle.json")
    parser.add_argument("--image-out", default="puzzle.png")
    parser.add_argument("--image-scale", type=int, default=3)
    args = parser.parse_args()

    puzzle = build_puzzle_json(args.pdf_path, args.page, args.image_out, args.image_scale)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(puzzle, f, ensure_ascii=False, indent=2)

    warn = puzzle["warnings"]
    print(f"Wrote {args.out} and {args.image_out} ({puzzle['meta']['imageWidth']}x{puzzle['meta']['imageHeight']}px): "
          f"{puzzle['meta']['rows']}x{puzzle['meta']['cols']} grid, "
          f"{len(puzzle['words'])} words, {warn['runs_without_clue']} runs without a matched clue.")
    if warn["runs_without_clue"]:
        print("Unmatched run ids (likely bent-arrow edge cases -- fix via manual-tweak mode in-app):")
        print(" ", warn["run_ids_without_clue"])


if __name__ == "__main__":
    main()
