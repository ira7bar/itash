import { createState, applyRemoteAnswers, applyRemotePresence, isPuzzleComplete, clearBoard, setAnswerHue, applyRemoteAnswerHues, ownAnswersForNewRoom, toggleDraftMode, applyRemoteDraft } from "./model.js";
import { setupImage, renderGridShell, updateGrid, renderRoster, renderChatMessages, renderChatToggle, renderDraftToggle } from "./render.js";
import { wireInteractions } from "./interaction.js";
import { wireChat } from "./chat-interaction.js";
import { saveProgress, loadProgress } from "./storage.js";
import { getRoomIdFromUrl, getRoomShareUrl, createRoomId, shareButtonRestingLabel } from "./share.js";
import { subscribeRoom, pushRoomState, pushAnswerCell, pushAnswerHue, pushDraftCell, pushPresence, pushMessage, clearPresence, peekRoomPresenceHues } from "./sync.js";
import { getUserId, getUserHue, hasUserHue, getUserName, ownInWordTint, ownActiveTint } from "./presence.js";
import { createChatState, applyRemoteMessages, resetChat, bindChatRoom } from "./chat.js";
import { hideWhileZoomedIn } from "./zoom-hide.js";

const RETRY_DELAY_MS = 1500;

// A transient mobile-network blip can silently drop a single write, and
// since the local screen already shows the typed letter (it's in local
// state regardless of whether the network call succeeds), there'd be no
// visible sign that it never reached the room at all. One quiet retry
// covers the common "blip," without building a whole offline queue for
// what should be a rare case once resyncOnVisible (below) also exists.
function pushWithRetry(pushFn, ...args) {
  pushFn(...args).catch((err) => {
    console.warn("Sync failed, retrying once:", err);
    setTimeout(() => {
      pushFn(...args).catch((err2) => console.warn("Retry also failed:", err2));
    }, RETRY_DELAY_MS);
  });
}

async function main() {
  const imageEl = document.getElementById("puzzle-image");
  const overlayEl = document.getElementById("overlay-layer");
  const gridWrapEl = document.getElementById("grid-wrap");
  const hiddenInput = document.getElementById("hidden-input");
  const footerEl = document.getElementById("app-footer");
  const shareBtn = document.getElementById("share-btn");
  const clearBoardBtn = document.getElementById("clear-board-btn");
  const leaveRoomBtn = document.getElementById("leave-room-btn");
  const joinBtn = document.getElementById("join-btn");
  const celebrationEl = document.getElementById("celebration-overlay");
  const celebrationTextEl = document.getElementById("celebration-text");
  const floatingControlsEl = document.getElementById("floating-controls");
  const chatToggleBtn = document.getElementById("chat-toggle");
  const draftToggleBtn = document.getElementById("draft-toggle");
  const chatBadgeEl = document.getElementById("chat-badge");
  const chatPanelEl = document.getElementById("chat-panel");
  const chatCloseBtn = document.getElementById("chat-close-btn");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const chatMessagesEl = document.getElementById("chat-messages");
  const rosterEl = document.getElementById("roster");
  const nameModal = document.getElementById("name-modal");
  const nameForm = document.getElementById("name-form");
  const nameInput = document.getElementById("name-input");

  // Bumped each week alongside the dated puzzle_YYYY-MM-DD.json/.png pair --
  // see CLAUDE.md's "Deploying a new week" section.
  const puzzleFile = "puzzle_2026-08-21.json";
  const res = await fetch(puzzleFile, { cache: "no-cache" });
  const puzzle = await res.json();
  // Solo progress (storage.js) is scoped by this, not by puzzle.meta's own
  // source/page fields -- those are deliberately kept constant across weeks
  // (see parse_puzzle.py's docs), so keying off them would load last week's
  // answers into this week's differently-shaped grid instead of starting
  // fresh.
  puzzle.meta.week = puzzleFile;

  const state = createState(puzzle);
  loadProgress(state);
  const chatState = createChatState();

  // This device's own live-room identity: a stable id (so a presence write
  // has a path to key off of) and a random-but-persistent color tint (so the
  // same person doesn't look like a new participant on every reload). If
  // this device has never had a hue before AND it's opening a room link
  // that already has other people in it, peek their hues first so this
  // brand-new one starts spaced away from theirs (see pickFarHue in
  // presence.js) -- skipped entirely for a returning device (its hue is
  // already fixed) or a solo/fresh visit (nothing to space away from yet).
  const userId = getUserId();
  let avoidHues = null;
  if (!hasUserHue()) {
    const linkedRoomId = getRoomIdFromUrl();
    if (linkedRoomId) {
      try {
        avoidHues = await peekRoomPresenceHues(linkedRoomId);
      } catch (err) {
        console.warn("Failed to peek room presence for hue spacing:", err);
      }
    }
  }
  const userHue = getUserHue(avoidHues);
  // Own-cursor highlighting used to be a fixed yellow, the same for every
  // device -- now it's this person's own hue instead (same one their
  // presence tint and answer-authorship tint already use elsewhere), so it
  // reads as "their color" rather than an unrelated one clashing with the
  // hue-based tints already on the board in a multi-person room.
  document.documentElement.style.setProperty("--in-word-bg", ownInWordTint(userHue));
  document.documentElement.style.setProperty("--active-bg", ownActiveTint(userHue));

  setupImage(state, imageEl);
  renderGridShell(state, overlayEl);
  // No resize handling needed: cell positions are percentages of the image's own
  // box, so they stay aligned automatically as the image scales with the viewport
  // or native pinch-zoom -- there's no pixel math to redo on resize.

  // Only fire the rainbow celebration on the actual moment the puzzle
  // BECOMES complete -- initializing from the puzzle's already-loaded state
  // means reopening an already-finished puzzle doesn't replay it every time.
  let wasComplete = isPuzzleComplete(state);

  const checkCelebration = () => {
    const complete = isPuzzleComplete(state);
    if (complete && !wasComplete) {
      for (const el of [celebrationEl, celebrationTextEl]) {
        el.classList.remove("celebrate");
        void el.offsetWidth; // restart the animation if it fires again later
        el.classList.add("celebrate");
      }
    }
    wasComplete = complete;
  };

  // Chat's own render pass: the roster ("who's here") is derived from
  // presence (already updated by the time onChange runs), the message list
  // from chatState, and the toggle button's badge/open state from both --
  // see render.js for why these are three separate functions sharing one
  // call site here instead of one another module boundary each.
  const renderChatUi = () => {
    renderRoster(state, { hue: userHue, name: getUserName() }, rosterEl);
    renderChatMessages(chatState, userId, chatMessagesEl);
    renderChatToggle(chatState, userId, chatToggleBtn, chatBadgeEl, chatPanelEl);
  };

  const onChange = () => {
    updateGrid(state, overlayEl);
    renderDraftToggle(state, draftToggleBtn);
    saveProgress(state);
    checkCelebration();
    syncPresence();
    renderChatUi();
  };

  // Broadcasts this device's active cell (and current display name) to a
  // live room, so everyone else can lightly paint it in this user's color
  // and label it in the roster. Only fires an actual network write when
  // something's changed since the last push -- onChange runs on every
  // keystroke, not just cell-to-cell navigation, and re-writing the same
  // thing every time would be pure noise. lastPushedCell is reset to null
  // (forcing a fresh push) whenever the room identity itself changes:
  // joining/creating a room, and re-subscribing on visibilitychange.
  let lastPushedCell = null;
  const syncPresence = () => {
    if (!state.roomId || !state.activeCell) return;
    const { row, col } = state.activeCell;
    const direction = state.activeDirection;
    const name = getUserName();
    // Direction (and now name) are part of the "did anything change" check
    // too, not just row/col: re-tapping a dual-direction start cell can flip
    // direction without moving the active cell at all (see selectCell in
    // model.js), and choosing/changing a name doesn't move the cell at all
    // -- both are exactly the cases where the OTHER participants' view
    // needs to update even though row/col alone looks unchanged.
    if (
      lastPushedCell &&
      lastPushedCell.row === row &&
      lastPushedCell.col === col &&
      lastPushedCell.direction === direction &&
      lastPushedCell.name === name
    ) {
      return;
    }
    lastPushedCell = { row, col, direction, name };
    pushWithRetry(pushPresence, state.roomId, userId, { row, col, hue: userHue, direction, name });
  };

  // A typed letter or backspace syncs just that ONE cell to a live room --
  // never the whole grid, so concurrent edits (or a device still mid-load)
  // can't clobber someone else's answers. See pushAnswerCell in sync.js.
  //
  // The hue is stamped locally regardless of room state (so it's already
  // correct the instant a room is later created from it -- see
  // ownAnswersForNewRoom), but only synced/rendered while actually in one;
  // solo solving has exactly one possible author, so it's never shown there.
  const onAnswerCellChange = (row, col, letter) => {
    setAnswerHue(state, row, col, letter ? userHue : null);
    onChange();
    if (state.roomId) {
      pushWithRetry(pushAnswerCell, state.roomId, row, col, letter);
      pushWithRetry(pushAnswerHue, state.roomId, row, col, letter ? userHue : null);
    }
  };

  // Mirrors onAnswerCellChange's per-cell sync discipline, but on the
  // draftHorizontal/draftVertical paths instead of answers -- no hue to
  // stamp here, since candidate color stays fixed to direction rather than
  // drawn from the presence hue pool (see CLAUDE.md's "Draft mode" section).
  const onDraftCellChange = (direction, row, col, letter) => {
    onChange();
    if (state.roomId) {
      pushWithRetry(pushDraftCell, state.roomId, direction, row, col, letter);
    }
  };

  // Long-press promote/demote (toggleCellDraft in model.js) touches BOTH
  // the answer and draft paths in one gesture -- syncs each independently,
  // same per-path discipline as every other edit, just two of them at once.
  // The hue write mirrors onAnswerCellChange's: stamped whenever the cell
  // ends up with an answer (promote), cleared whenever it ends up without
  // one (demote).
  const onCellDraftToggle = (row, col, direction, answer, draftLetter) => {
    setAnswerHue(state, row, col, answer ? userHue : null);
    onChange();
    if (state.roomId) {
      pushWithRetry(pushAnswerCell, state.roomId, row, col, answer);
      pushWithRetry(pushAnswerHue, state.roomId, row, col, answer ? userHue : null);
      pushWithRetry(pushDraftCell, state.roomId, direction, row, col, draftLetter);
    }
  };

  // Draft mode itself (on/off) has no network dimension -- it's a per-device
  // preference like which cell you're looking at, not shared puzzle state,
  // so this only ever flips local state and re-renders. The candidates it
  // produces are a different matter -- see onDraftCellChange.
  const onToggleDraftMode = () => {
    toggleDraftMode(state);
    onChange();
  };

  // Same per-path sync discipline as every other edit -- a board clear syncs
  // each cleared cell individually (exactly like typing/backspacing through
  // them one at a time would), never as a single whole-room overwrite, so it
  // can't clobber someone else's concurrent edit either. Cleared draft
  // candidates get the same treatment now, on their own path.
  const onClearBoard = () => {
    const { clearedCells, clearedDraftCells } = clearBoard(state);
    onChange();
    if (state.roomId) {
      for (const [row, col] of clearedCells) {
        pushWithRetry(pushAnswerCell, state.roomId, row, col, "");
        pushWithRetry(pushAnswerHue, state.roomId, row, col, null);
      }
      for (const [direction, row, col] of clearedDraftCells) {
        pushWithRetry(pushDraftCell, state.roomId, direction, row, col, "");
      }
    }
  };

  let unsubscribeRoom = null;

  // Hides the footer and floating chrome once pinch-zoom gets heavy enough
  // that they'd otherwise balloon up to the same zoom level as the grid --
  // see zoom-hide.js. No resync needed on room-state changes (unlike an
  // earlier counter-scaling attempt): this only reacts to zoom level, not to
  // anything about these elements' own size or content. One call for the
  // whole #floating-controls row (chat + draft toggles together), not one
  // per button -- they should hide and reappear in lockstep, and
  // visibility:hidden on the row already covers both children.
  hideWhileZoomedIn(footerEl);
  hideWhileZoomedIn(floatingControlsEl);
  hideWhileZoomedIn(chatPanelEl);

  // Single source of truth for every piece of UI that depends on "are we
  // currently in a room": the join button (only makes sense when NOT already
  // in one), the leave button, and the share button's resting label (which
  // also carries the room code once in one -- see shareButtonRestingLabel).
  const refreshRoomUi = () => {
    const inRoom = Boolean(state.roomId);
    joinBtn.hidden = inRoom;
    leaveRoomBtn.hidden = !inRoom;
    shareBtn.innerHTML = shareButtonRestingLabel(state.roomId);
    // Chat only exists inside a live room -- solo solving never touches
    // Firebase at all, so the toggle/panel have nothing to show without one.
    chatToggleBtn.hidden = !inRoom;
    chatPanelEl.hidden = !inRoom;
  };

  // Joining a room's live state overrides local progress, same as the old
  // share-link behavior -- opening a shared link/code is an explicit "load
  // this" action. Runs when joining someone else's room (from a URL or a
  // manually-entered code), and right after this device creates a brand new one.
  const joinRoom = async (roomId) => {
    // Bound before subscribing, not after -- the very first snapshot can
    // arrive as part of subscribeRoom's own setup, before the `await`
    // below even resolves, and applyRemoteMessages needs chatState.roomId
    // already set to correctly derive seenCount from what this device had
    // already read here (see chat.js).
    bindChatRoom(chatState, roomId);
    // Only commit to the new room (state.roomId, the old subscription being torn
    // down) once the new one actually succeeds -- a failed join must leave the
    // app exactly as usable as it was before the attempt, not half-broken.
    const unsubscribe = await subscribeRoom(roomId, (roomState) => {
      applyRemoteAnswers(state, roomState.answers || {});
      applyRemoteAnswerHues(state, roomState.answerHues || {});
      applyRemoteDraft(state, "horizontal", roomState.draftHorizontal || {});
      applyRemoteDraft(state, "vertical", roomState.draftVertical || {});
      applyRemotePresence(state, roomState.presence || {}, userId);
      applyRemoteMessages(chatState, roomState.messages || {});
      onChange();
    });
    if (unsubscribeRoom) unsubscribeRoom();
    unsubscribeRoom = unsubscribe;
    state.roomId = roomId;
    // Force a fresh presence push under the (possibly new) room id, rather
    // than trusting whatever cell was last pushed to a previous room.
    lastPushedCell = null;
    // Put the room in THIS device's own address bar too, not just in the link
    // handed to others -- a live room should stay joined across reloads, and
    // mobile browsers reload backgrounded tabs constantly (e.g. switching
    // away to actually send the share link via WhatsApp). Without this, that
    // completely ordinary flow silently and permanently drops the device
    // from the room: it keeps showing whatever answers were last saved
    // locally (looking perfectly normal), but never sends or receives
    // another update again.
    history.replaceState(null, "", getRoomShareUrl(roomId));
    refreshRoomUi();
  };

  // Stops live sync and goes back to solo solving, continuing from whatever
  // answers were on the board at the moment of leaving (not a puzzle reset --
  // "משחק אישי" just means "just me, from here").
  const leaveRoom = () => {
    if (unsubscribeRoom) {
      unsubscribeRoom();
      unsubscribeRoom = null;
    }
    if (state.roomId) {
      // Best-effort: an explicit leave should clear this device's cursor for
      // everyone else right away, rather than waiting on the onDisconnect
      // cleanup in sync.js (which only fires once the connection actually
      // drops, not on this ordinary in-app "back to solo" action).
      clearPresence(state.roomId, userId).catch((err) => {
        console.warn("Failed to clear presence on leaving room:", err);
      });
    }
    state.roomId = null;
    state.presence = new Map();
    lastPushedCell = null;
    resetChat(chatState);
    history.replaceState(null, "", location.pathname + location.search);
    refreshRoomUi();
  };

  // Used by the share button: creates a room the first time it's needed. The
  // current local progress is pushed BEFORE subscribing, since a brand new
  // room starts empty -- subscribing first would have its first snapshot
  // (nothing there yet) wipe out whatever the user already filled in solo.
  //
  // Only THIS user's own answers seed it (ownAnswersForNewRoom), not every
  // filled cell currently on screen -- genuine solo progress still carries
  // in (that's the whole point of seeding at all), but another room's
  // collaborators' answers, left sitting in memory after leaving that room,
  // never silently become a brand-new, unrelated room's starting state.
  // Draft candidates deliberately AREN'T seeded, even though they do sync
  // once inside a room (see onDraftCellChange) -- ownAnswersForNewRoom's
  // filtering works because every answer cell is hue-stamped with whoever
  // wrote it (setAnswerHue), so "was this genuinely mine" is answerable.
  // Drafts have no such per-cell authorship (see CLAUDE.md's "Draft mode"
  // section on why candidate color stays fixed to direction, not drawn from
  // the presence hue pool), so there's no way to tell "this device's own
  // solo scratch notes" apart from "candidates that arrived from a
  // DIFFERENT room's collaborators and are still sitting in local state" --
  // exactly the leak ownAnswersForNewRoom exists to prevent for answers.
  // Starting a new room with a blank draft layer sidesteps that leak
  // entirely, at the cost of not carrying pre-room solo drafts in.
  const ensureRoomAndGetShareUrl = async () => {
    if (!state.roomId) {
      const roomId = createRoomId();
      const { answers, answerHues } = ownAnswersForNewRoom(state, userHue);
      const roomState = { answers, answerHues };
      await pushRoomState(roomId, roomState);
      await joinRoom(roomId);
    }
    return getRoomShareUrl(state.roomId);
  };

  // Used by the "join by code" form, for when someone got the code read
  // aloud rather than tapping a shared link.
  const joinRoomByCode = async (rawCode) => {
    const roomId = rawCode.trim().toLowerCase();
    if (!roomId) return false;
    await joinRoom(roomId);
    return true;
  };

  const existingRoomId = getRoomIdFromUrl();
  if (existingRoomId) {
    try {
      await joinRoom(existingRoomId);
    } catch (err) {
      // Don't let a broken live-sync backend take down the whole app -- fall
      // back to normal solo solving with whatever local progress was loaded.
      // Do clear the broken room id from the address bar, though, so a
      // reload doesn't just keep retrying the same failing join forever.
      console.warn("Failed to join room from URL, continuing solo:", err);
      history.replaceState(null, "", location.pathname + location.search);
    }
  }
  refreshRoomUi();

  wireInteractions(state, {
    gridEl: overlayEl,
    imageEl,
    gridWrapEl,
    hiddenInput,
    shareBtn,
    clearBoardBtn,
    leaveRoomBtn,
    joinBtn,
    draftToggleBtn,
    onChange,
    onAnswerCellChange,
    onDraftCellChange,
    onCellDraftToggle,
    onToggleDraftMode,
    ensureRoomAndGetShareUrl,
    joinRoomByCode,
    leaveRoom,
    clearBoard: onClearBoard,
  });

  wireChat(chatState, {
    chatToggleBtn,
    chatPanelEl,
    chatCloseBtn,
    chatForm,
    chatInput,
    nameModal,
    nameForm,
    nameInput,
    rosterEl,
    onChatChange: renderChatUi,
    onSendMessage: (text) => {
      if (!state.roomId) return;
      pushWithRetry(pushMessage, state.roomId, { userId, name: getUserName(), hue: userHue, text });
    },
    // Renaming doesn't move the active cell, so onChange (which only pushes
    // presence when something in it actually changed -- see syncPresence)
    // is what notices the new name and re-broadcasts it.
    onRenameSelf: onChange,
  });

  onChange();

  // Re-subscribe whenever the tab comes back to the foreground. Covers two
  // real things that happen constantly on mobile: a WebSocket connection
  // that silently died while backgrounded (very common -- e.g. switching
  // away to actually send the share link via WhatsApp, or the phone just
  // locking), and simply guarantees a fresh, authoritative snapshot instead
  // of trusting a possibly-stale one after any length of time away. joinRoom
  // is safe to re-run on the same room id -- it just tears down the old
  // listener and opens a new one.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.roomId) {
      joinRoom(state.roomId).catch((err) => {
        console.warn("Failed to resync room on becoming visible:", err);
      });
    }
  });
}

main();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}
