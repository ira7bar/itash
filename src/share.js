// Live-room sharing: the link points at a room id, not a snapshot of answers
// -- the actual answers live in Firebase under that room (see sync.js) and
// sync live to everyone who has the link open. Opening the link joins the
// room and starts seeing (and contributing to) its live state.

const RADIX = 36;
const ROOM_ID_LENGTH = 6;

export function createRoomId() {
  let id = "";
  for (let i = 0; i < ROOM_ID_LENGTH; i++) {
    id += Math.floor(Math.random() * RADIX).toString(RADIX);
  }
  return id;
}

export function getRoomShareUrl(roomId) {
  const url = new URL(location.href);
  url.hash = `room=${roomId}`;
  return url.toString();
}

export function getRoomIdFromUrl() {
  const match = location.hash.match(/^#room=([0-9a-z]{1,12})$/);
  return match ? match[1] : null;
}

// Tries the native OS share sheet first (WhatsApp, Messages, email, etc. show
// up there directly on mobile); falls back to clipboard, then to a manual
// prompt if even that fails (older browsers, clipboard permission denied).
export async function shareRoomUrl(url) {
  if (navigator.share) {
    try {
      await navigator.share({ title: "תשחץ הארץ", url });
      return "shared";
    } catch (err) {
      if (err && err.name === "AbortError") return "cancelled"; // user closed the sheet, not a failure
      console.warn("navigator.share failed, falling back to clipboard:", err);
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch (err) {
    console.warn("Clipboard write failed, showing link instead:", err);
    window.prompt("העתיקו את הקישור:", url);
    return "prompted";
  }
}
