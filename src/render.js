import { isBlocked, getActiveWord, getWordsForClueCell, getWordCellsForPresence } from "./model.js";
import { presenceWordTint, presenceLetterTint, answerAuthorTint } from "./presence.js";
import { unreadCount } from "./chat.js";

// The grid is a rendered image of the actual PDF page -- clue text, dividers,
// borders, and the source's own direction arrows all come through pixel-perfect,
// since none of it is reconstructed in CSS. This module only positions a
// transparent, percentage-based interactive overlay on top of that image.
// Percentages (not pixels) mean the overlay stays aligned with the image at any
// display size or native pinch-zoom level with no resize recalculation needed.

export function setupImage(state, imageEl) {
  imageEl.src = state.puzzle.meta.image;
}

function cellRectPercent(state, row, col) {
  const { imageWidth, imageHeight, originX, originY, cellWidth, cellHeight } = state.puzzle.meta;
  const left = (originX + col * cellWidth) / imageWidth * 100;
  const top = (originY + row * cellHeight) / imageHeight * 100;
  const width = cellWidth / imageWidth * 100;
  const height = cellHeight / imageHeight * 100;
  return { left, top, width, height };
}

export function renderGridShell(state, overlayEl) {
  overlayEl.innerHTML = "";

  for (let r = 0; r < state.index.rows; r++) {
    for (let c = 0; c < state.index.cols; c++) {
      const rect = cellRectPercent(state, r, c);
      const cellEl = document.createElement("div");
      cellEl.className = "cell";
      cellEl.dataset.row = String(r);
      cellEl.dataset.col = String(c);
      cellEl.style.left = `${rect.left}%`;
      cellEl.style.top = `${rect.top}%`;
      cellEl.style.width = `${rect.width}%`;
      cellEl.style.height = `${rect.height}%`;

      const letterEl = document.createElement("div");
      letterEl.className = "letter";
      cellEl.appendChild(letterEl);

      // Draft/pencil-mark candidates: one slot per direction, positioned in
      // opposite corners (see CLAUDE.md's "Draft mode" section for why
      // opposite corners rather than each direction's own edge -- adjacent
      // edges land two marks in the same neighborhood at real cell sizes).
      // Empty textContent means empty DOM (":empty" hides them in CSS), so
      // there's nothing to toggle here beyond what updateGrid sets.
      const draftAcrossEl = document.createElement("div");
      draftAcrossEl.className = "draft-mark across";
      cellEl.appendChild(draftAcrossEl);
      const draftDownEl = document.createElement("div");
      draftDownEl.className = "draft-mark down";
      cellEl.appendChild(draftDownEl);

      // Static per puzzle (independent of answers/active state), so it's set
      // once here rather than recomputed every updateGrid call.
      if (getWordsForClueCell(state, r, c).length > 0) {
        cellEl.classList.add("clue-tappable");
      }

      overlayEl.appendChild(cellEl);
    }
  }
}

export function updateGrid(state, overlayEl) {
  const activeWord = getActiveWord(state);
  const activeWordCellSet = new Set((activeWord?.cells ?? []).map(([r, c]) => `${r},${c}`));

  // Two separate maps, same reasoning as the local player's own
  // in-word/active split: every cell of a remote participant's whole active
  // word gets the lighter tint, and their one exact current cell gets the
  // stronger tint on top. Last-write-wins if two participants happen to
  // overlap on the same cell -- a rare case, not worth blending tints for.
  const presenceWordHueByCell = new Map();
  const presenceLetterHueByCell = new Map();
  for (const entry of state.presence.values()) {
    const wordCells = getWordCellsForPresence(state, entry.row, entry.col, entry.direction);
    if (wordCells) {
      for (const [r, c] of wordCells) {
        presenceWordHueByCell.set(`${r},${c}`, entry.hue);
      }
    }
    presenceLetterHueByCell.set(`${entry.row},${entry.col}`, entry.hue);
  }

  const cells = overlayEl.children;
  for (let i = 0; i < cells.length; i++) {
    const cellEl = cells[i];
    const r = Number(cellEl.dataset.row);
    const c = Number(cellEl.dataset.col);
    const blocked = isBlocked(state, r, c);

    cellEl.classList.toggle("blocked", blocked);
    cellEl.classList.toggle("blank", !blocked);

    const letterEl = cellEl.querySelector(".letter");
    letterEl.textContent = blocked ? "" : (state.answers[r][c] ?? "");

    const isActive = state.activeCell && state.activeCell.row === r && state.activeCell.col === c;
    cellEl.classList.toggle("active", Boolean(isActive));
    cellEl.classList.toggle("in-word", !blocked && activeWordCellSet.has(`${r},${c}`));

    // Draft marks render whenever a candidate exists, independent of
    // state.draftMode -- toggling draft mode off is "stop adding more,"
    // not "hide what's already there," the same way turning off notes mode
    // in Sudoku doesn't erase existing pencil marks.
    cellEl.querySelector(".draft-mark.across").textContent = blocked ? "" : (state.draftHorizontal[r][c] ?? "");
    cellEl.querySelector(".draft-mark.down").textContent = blocked ? "" : (state.draftVertical[r][c] ?? "");

    // A box-shadow tint rather than a background-color: .active/.in-word
    // already set `background` via CSS classes, and box-shadow layers on top
    // of that independently instead of fighting it for the same property --
    // so a cell someone else is also looking at still shows its own
    // active/in-word highlight underneath the tint. The letter map (the
    // exact cell a participant is on) takes priority over the word map
    // (every cell of their active word) when a cell is in both.
    let presenceColor;
    if (!blocked) {
      const letterHue = presenceLetterHueByCell.get(`${r},${c}`);
      if (letterHue !== undefined) {
        presenceColor = presenceLetterTint(letterHue);
      } else {
        const wordHue = presenceWordHueByCell.get(`${r},${c}`);
        if (wordHue !== undefined) presenceColor = presenceWordTint(wordHue);
      }
    }
    if (presenceColor) {
      cellEl.style.setProperty("--presence-color", presenceColor);
      cellEl.classList.add("presence-tint");
    } else {
      cellEl.classList.remove("presence-tint");
    }

    // Persistent "who filled this in" wash, gated to live rooms only --
    // solo solving has exactly one possible author, nothing to show. A
    // separate box-shadow layer (not folded into presenceColor above) with
    // its own combined-selector CSS rule (see style.css), the same
    // reasoning as why presence-tint itself layers on top of
    // active/in-word's background instead of overwriting it.
    let authorColor;
    if (!blocked && state.roomId) {
      const authorHue = state.answerHues[r][c];
      if (authorHue != null) authorColor = answerAuthorTint(authorHue);
    }
    if (authorColor) {
      cellEl.style.setProperty("--author-color", authorColor);
      cellEl.classList.add("author-tint");
    } else {
      cellEl.classList.remove("author-tint");
    }
  }
}

// "Who's here": this device's own entry (never present in state.presence --
// see applyRemotePresence in model.js -- so it's passed in separately, and
// always rendered first) plus every other connected participant. Rebuilt
// wholesale on every call, same as updateGrid -- the list is short enough
// that a full rebuild is simpler than diffing and not worth optimizing.
export function renderRoster(state, self, rosterEl) {
  rosterEl.innerHTML = "";
  const entries = [{ ...self, isSelf: true }, ...state.presence.values()];
  for (const entry of entries) {
    const chip = document.createElement("span");
    chip.className = "roster-chip" + (entry.isSelf ? " me" : "");
    if (entry.isSelf) {
      chip.title = "לחיצה לשינוי השם";
      chip.tabIndex = 0;
    }
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.setProperty("--hue", entry.hue);
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(entry.name || (entry.isSelf ? "את/ה" : "אורח")));
    rosterEl.appendChild(chip);
  }
}

// Chat message list. Author/text go through textContent (never innerHTML --
// this is other people's freely-typed input), and hue-tinting reuses the
// same --hue custom-property technique render.js already uses for
// --presence-color on the grid.
//
// wasNearBottom/scroll-to-bottom keeps the list pinned to the latest message
// as new ones arrive, but only when the reader was already close to the
// bottom -- so scrolling up to reread earlier messages doesn't get yanked
// back down by an incoming message.
export function renderChatMessages(chatState, selfUserId, listEl) {
  const wasNearBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 40;
  listEl.innerHTML = "";
  for (const msg of chatState.messages) {
    const mine = msg.userId === selfUserId;
    const row = document.createElement("div");
    row.className = "chat-msg" + (mine ? " mine" : "");
    row.style.setProperty("--hue", msg.hue);
    const author = document.createElement("span");
    author.className = "chat-msg-author";
    author.textContent = mine ? "את/ה" : msg.name || "אורח";
    const bubble = document.createElement("p");
    bubble.textContent = msg.text;
    row.appendChild(author);
    row.appendChild(bubble);
    listEl.appendChild(row);
  }
  if (wasNearBottom) listEl.scrollTop = listEl.scrollHeight;
}

// Toggle button (open/close class + unread badge) and the panel's own
// open/close visual state -- kept together since both are driven by the
// same chatState.open/unreadCount pair.
export function renderChatToggle(chatState, selfUserId, chatToggleBtn, chatBadgeEl, chatPanelEl) {
  const count = unreadCount(chatState, selfUserId);
  chatBadgeEl.hidden = count === 0;
  chatBadgeEl.textContent = String(count);
  chatToggleBtn.setAttribute("aria-expanded", String(chatState.open));
  chatPanelEl.classList.toggle("open", chatState.open);
}

// aria-pressed drives both the accessible state and the on/off visual (see
// #draft-toggle[aria-pressed="true"] in style.css) from the one source of
// truth, state.draftMode -- covers both a click (via the toggle callback)
// and the solo-progress restore on page load (storage.js) alike.
export function renderDraftToggle(state, draftToggleBtn) {
  draftToggleBtn.setAttribute("aria-pressed", String(state.draftMode));
}
