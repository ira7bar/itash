// Chat message state for a live room -- deliberately separate from
// model.js's grid/word-run state (same "no DOM access" discipline), since
// message history has nothing to do with the puzzle grid itself.

export function createChatState() {
  return { messages: [], seenCount: 0, open: false };
}

// Rebuilds the message list from a room's messages snapshot (a push-id
// keyed object, one entry per pushMessage call in sync.js). Always a full
// replace, same reasoning as applyRemoteAnswers in model.js -- treat every
// call as an authoritative snapshot, not a delta.
//
// seenCount only advances while the panel is open, so messages that arrive
// while it's closed stay counted toward the unread badge (see unreadCount)
// until it's opened. Because messages are append-only and never reordered,
// a plain length comparison against seenCount is enough -- no need to diff
// individual ids.
export function applyRemoteMessages(chatState, messagesMap) {
  chatState.messages = Object.entries(messagesMap || {})
    .map(([id, msg]) => ({ id, ...msg }))
    .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  if (chatState.open) chatState.seenCount = chatState.messages.length;
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
}
