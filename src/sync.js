// Live-room sync via Firebase Realtime Database. This is the only module that
// knows about Firebase -- everything else just deals in plain answer maps, so
// swapping the backend later would mean rewriting this one file.
//
// The SDK is loaded from Firebase's own CDN as native ES modules (no npm/build
// step, matching the rest of this app), and only gets fetched at all once a
// room is actually created or joined -- solo, non-shared solving never touches
// Firebase.

import { firebaseConfig } from "./firebase-config.js";

const SDK_VERSION = "10.14.1";

let modulesPromise = null;

function loadModules() {
  if (!modulesPromise) {
    modulesPromise = (async () => {
      const [{ initializeApp }, db] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-database.js`),
      ]);
      const app = initializeApp(firebaseConfig);
      return {
        database: db.getDatabase(app),
        ref: db.ref,
        onValue: db.onValue,
        get: db.get,
        set: db.set,
        remove: db.remove,
        onDisconnect: db.onDisconnect,
        push: db.push,
        serverTimestamp: db.serverTimestamp,
      };
    })();
  }
  return modulesPromise;
}

// Subscribes to a room's whole state ({ answers, unsure }). Fires immediately
// with whatever's already there (empty room -> {}), then again on every
// change from any participant, including our own writes -- callers should
// treat every call as a full snapshot, not a delta. Returns an unsubscribe
// function.
export async function subscribeRoom(roomId, onUpdate) {
  const { database, ref, onValue } = await loadModules();
  const roomRef = ref(database, `rooms/${roomId}`);
  return onValue(roomRef, (snapshot) => onUpdate(snapshot.val() || {}));
}

// One-time read (not a subscription) of whichever hues are already present
// in a room, used only to give a brand-new device's very first random hue a
// head start away from theirs -- see pickFarHue in presence.js. A plain
// get(), not onValue(), since this is a single "who's already here"
// snapshot at the moment of joining, not something to keep listening to.
export async function peekRoomPresenceHues(roomId) {
  const { database, ref, get } = await loadModules();
  const snapshot = await get(ref(database, `rooms/${roomId}/presence`));
  const presence = snapshot.val() || {};
  return Object.values(presence)
    .map((entry) => entry?.hue)
    .filter((hue) => typeof hue === "number");
}

// Overwrites the room's whole state. ONLY safe to use when seeding a brand
// new room at creation time, when nobody else could possibly be connected to
// it yet. Never use this for an ongoing edit -- see pushAnswerCell below for
// why a ongoing whole-state overwrite is actively dangerous with more than
// one participant.
export async function pushRoomState(roomId, roomState) {
  const { database, ref, set } = await loadModules();
  const roomRef = ref(database, `rooms/${roomId}`);
  await set(roomRef, roomState);
}

// Writes (or, for an empty letter, deletes) exactly one cell's path. This is
// the ongoing per-edit sync call, deliberately scoped to a single child path
// instead of overwriting the whole room: two people editing different cells
// at the same time -- or one person's device still mid-way through loading
// the room's current state when they start typing -- must never be able to
// wipe out each other's answers. Firebase resolves concurrent writes to
// DIFFERENT paths independently; only two edits to the exact same cell at
// the exact same instant would race, which is an acceptable, rare
// last-write-wins case rather than a silent wholesale data-loss bug.
export async function pushAnswerCell(roomId, row, col, letter) {
  const { database, ref, set } = await loadModules();
  const cellRef = ref(database, `rooms/${roomId}/answers/${row}_${col}`);
  await set(cellRef, letter || null);
}

// A separate path from pushAnswerCell, not a combined { letter, hue } value
// at the same path -- so the answers path's shape stays exactly what it's
// always been, and anything only reading answers (e.g. isPuzzleComplete's
// data, or an older cached client) is unaffected by this being added later.
export async function pushAnswerHue(roomId, row, col, hue) {
  const { database, ref, set } = await loadModules();
  const hueRef = ref(database, `rooms/${roomId}/answerHues/${row}_${col}`);
  await set(hueRef, hue ?? null);
}

// Same reasoning as pushAnswerCell, for a single word's unsure flag.
export async function pushUnsureFlag(roomId, wordId, isUnsure) {
  const { database, ref, set } = await loadModules();
  const flagRef = ref(database, `rooms/${roomId}/unsure/${wordId}`);
  await set(flagRef, isUnsure ? true : null);
}

// Writes this device's own "what I'm looking at" cell + color tint, so every
// other participant can lightly paint that cell to show it's occupied.
// Scoped to this one user's own child path, same reasoning as
// pushAnswerCell -- concurrent presence updates from different people must
// never stomp each other. Also arms an onDisconnect cleanup on every call:
// if this device vanishes without a clean leaveRoom (closed tab, dead
// network, phone locked), Firebase itself removes the stale entry rather
// than leaving a cursor stuck on the grid for everyone else forever.
export async function pushPresence(roomId, userId, presence) {
  const { database, ref, set, onDisconnect } = await loadModules();
  const presenceRef = ref(database, `rooms/${roomId}/presence/${userId}`);
  onDisconnect(presenceRef).remove();
  await set(presenceRef, presence);
}

// Appends one chat message as a brand new child (via push(), which mints its
// own unique key) rather than writing to a fixed path -- unlike
// answers/presence/unsure, many different people write to this same list
// over time, so each message needs its own path rather than sharing one
// per-writer slot the way those do. Still the same underlying rule: nobody
// ever overwrites something another participant wrote. serverTimestamp()
// (not a locally-read Date.now()) keeps message ordering consistent even if
// a participant's device clock is off.
export async function pushMessage(roomId, message) {
  const { database, ref, push, set, serverTimestamp } = await loadModules();
  const messageRef = push(ref(database, `rooms/${roomId}/messages`));
  await set(messageRef, { ...message, ts: serverTimestamp() });
}

// Explicit cleanup for the ordinary "leave room" action, so a departing
// participant's cursor disappears immediately rather than waiting for the
// onDisconnect above to notice.
export async function clearPresence(roomId, userId) {
  const { database, ref, remove } = await loadModules();
  const presenceRef = ref(database, `rooms/${roomId}/presence/${userId}`);
  await remove(presenceRef);
}
