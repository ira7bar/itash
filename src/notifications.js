// Opt-in browser notifications for incoming chat messages while this tab is
// backgrounded. Deliberately its own tiny module (not folded into chat.js or
// presence.js): it's the one place that touches the actual Notification API,
// same "one file owns the platform API" reasoning as sync.js owning Firebase.

const ENABLED_KEY = "tashbetz:chat-notify-enabled";

// iOS Safari only exposes `Notification` for a PWA added to the home screen,
// not an ordinary browser tab -- feature-detect rather than assume, so the
// toggle can simply stay hidden wherever it wouldn't do anything.
export function notificationsSupported() {
  return typeof Notification !== "undefined";
}

// The user's own on/off preference, device-scoped in localStorage (not
// puzzle-scoped, same as presence.js's identity prefs) -- separate from the
// BROWSER's own permission grant, since either one alone isn't enough to
// actually notify. If the preference says "on" but the browser permission
// has since been revoked (changed in browser/OS settings, outside this app
// entirely), that's corrected back to "off" here rather than left stale, so
// this check is the one place that ever needs to reconcile the two.
export function isNotifyEnabled() {
  if (!notificationsSupported()) return false;
  const wantsIt = localStorage.getItem(ENABLED_KEY) === "1";
  if (wantsIt && Notification.permission !== "granted") {
    localStorage.setItem(ENABLED_KEY, "0");
    return false;
  }
  return wantsIt;
}

function setNotifyPreference(enabled) {
  localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
}

// Turns the preference on or off. Turning on for the first time (permission
// still in its default, unasked state) requests it -- the browser's own
// native prompt, not a custom one -- and only actually enables if that's
// granted. Turning off never touches the browser permission itself, only
// this app's own preference; there's no API to revoke a Notification
// permission from a page anyway. Returns the resulting state so the caller
// (chat-interaction.js) knows whether to reflect "on," "off," or "denied."
export async function setNotifyEnabled(wantsOn) {
  if (!wantsOn) {
    setNotifyPreference(false);
    return "off";
  }
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  setNotifyPreference(true);
  return "on";
}

// Fires the actual OS-level notification for one incoming chat message.
// Callers (main.js) are responsible for only calling this for a message that
// isn't this device's own, and only while the tab itself is hidden -- an
// open, focused tab already shows the message in the chat panel/badge, so a
// system notification on top of that would be redundant noise, not a signal.
//
// A fixed `tag` collapses a burst of several messages arriving while
// backgrounded into a single updated notification (the latest one) rather
// than stacking one per message -- reviewing a pile of individual "so-and-so
// said X" notifications after being away is worse than just seeing the most
// recent line and opening the app to catch up on the rest.
export function showChatNotification({ name, text }) {
  if (!isNotifyEnabled() || Notification.permission !== "granted") return;
  const notification = new Notification(name || "הודעה חדשה", {
    body: text,
    tag: "tashbetz-chat",
    icon: "icons/icon-192.png",
  });
  notification.onclick = () => {
    window.focus();
    notification.close();
  };
}
