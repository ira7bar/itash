// Chat message state for a live room -- deliberately separate from
// model.js's grid/word-run state (same "no DOM access" discipline), since
// message history has nothing to do with the puzzle grid itself.

const SEEN_KEY_PREFIX = "tashbetz:chat-seen:";

// How far into a room's messages this device has already read, persisted
// per room (not per puzzle, not global) so a page reload -- or just closing
// and reopening the app later -- doesn't forget it and re-flag a whole
// backlog as unread again. Stores the last-read message's timestamp rather
// than a raw count: counts are meaningless across a reload (the in-memory
// array is rebuilt from scratch), but "read up through this moment" still
// means the same thing once the fresh snapshot arrives.
function loadSeenTs(roomId) {
  if (!roomId) return 0;
  const raw = localStorage.getItem(SEEN_KEY_PREFIX + roomId);
  return raw ? Number(raw) : 0;
}

function saveSeenTs(chatState) {
  if (!chatState.roomId) return;
  const lastTs = chatState.messages.at(-1)?.ts;
  if (typeof lastTs !== "number") return;
  try {
    localStorage.setItem(SEEN_KEY_PREFIX + chatState.roomId, String(lastTs));
  } catch (err) {
    console.warn("Could not save chat seen marker:", err);
  }
}

export function createChatState() {
  return { messages: [], seenCount: 0, open: false, roomId: null, seenCountReady: false };
}

// Call once per join (including a resubscribe to the same room), before the
// first applyRemoteMessages for it arrives -- see main.js's joinRoom. Marks
// seenCount as needing to be (re)derived from the persisted marker above on
// that next snapshot, rather than assumed to already be current.
export function bindChatRoom(chatState, roomId) {
  chatState.roomId = roomId;
  chatState.seenCountReady = false;
}

// Rebuilds the message list from a room's messages snapshot (a push-id
// keyed object, one entry per pushMessage call in sync.js). Always a full
// replace, same reasoning as applyRemoteAnswers in model.js -- treat every
// call as an authoritative snapshot, not a delta.
//
// The very first snapshot after (re)binding to a room derives seenCount
// from the persisted "read up through" marker instead of starting at 0 --
// otherwise every reload would re-flag the entire backlog as unread, not
// just whatever's genuinely new since last time. After that, seenCount only
// advances while the panel is open, so messages that arrive while it's
// closed stay counted toward the unread badge (see unreadCount) until it's
// opened -- and each time it does advance, the marker is saved right along
// with it. Because messages are append-only and never reordered, a plain
// index comparison against seenCount is enough -- no need to diff
// individual ids.
export function applyRemoteMessages(chatState, messagesMap) {
  chatState.messages = Object.entries(messagesMap || {})
    .map(([id, msg]) => ({ id, ...msg }))
    .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));

  if (!chatState.seenCountReady) {
    const seenTs = loadSeenTs(chatState.roomId);
    chatState.seenCount = chatState.messages.filter((m) => (m.ts ?? 0) <= seenTs).length;
    chatState.seenCountReady = true;
  }

  if (chatState.open) {
    chatState.seenCount = chatState.messages.length;
    saveSeenTs(chatState);
  }
}

// Counts only OTHER people's messages past seenCount -- your own sent
// messages must never bump your own unread badge, regardless of whether
// the panel happened to be open at the moment you sent (seenCount's own
// timing already covers the open-panel case; this covers it unconditionally
// so it holds even if that ever races).
export function unreadCount(chatState, selfUserId) {
  let count = 0;
  for (let i = chatState.seenCount; i < chatState.messages.length; i++) {
    if (chatState.messages[i].userId !== selfUserId) count++;
  }
  return count;
}

export function openChat(chatState) {
  chatState.open = true;
  chatState.seenCount = chatState.messages.length;
  saveSeenTs(chatState);
}

export function closeChat(chatState) {
  chatState.open = false;
}

// Back to a fresh, empty, closed state -- used on leaving a room, so a
// stale message list or unread badge from the old room doesn't linger into
// solo solving or bleed into a subsequently joined one.
export function resetChat(chatState) {
  chatState.messages = [];
  chatState.seenCount = 0;
  chatState.open = false;
  chatState.roomId = null;
  chatState.seenCountReady = false;
}
