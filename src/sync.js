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
        set: db.set,
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

// Same reasoning as pushAnswerCell, for a single word's unsure flag.
export async function pushUnsureFlag(roomId, wordId, isUnsure) {
  const { database, ref, set } = await loadModules();
  const flagRef = ref(database, `rooms/${roomId}/unsure/${wordId}`);
  await set(flagRef, isUnsure ? true : null);
}
