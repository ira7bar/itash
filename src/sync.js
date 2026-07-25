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

// Subscribes to a room's answers. Fires immediately with whatever's already
// there (empty room -> {}), then again on every change from any participant,
// including our own writes -- callers should treat every call as a full
// snapshot, not a delta. Returns an unsubscribe function.
export async function subscribeRoom(roomId, onUpdate) {
  const { database, ref, onValue } = await loadModules();
  const roomRef = ref(database, `rooms/${roomId}/answers`);
  return onValue(roomRef, (snapshot) => onUpdate(snapshot.val() || {}));
}

// Overwrites the room's whole answers map. Simpler and, at this puzzle's size
// (a few hundred cells at most), cheap enough to just resend the full sparse
// map on every local edit rather than tracking and pushing per-cell deltas.
export async function pushRoomAnswers(roomId, answersMap) {
  const { database, ref, set } = await loadModules();
  const roomRef = ref(database, `rooms/${roomId}/answers`);
  await set(roomRef, answersMap);
}
