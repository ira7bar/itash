// DOM wiring for the live-room chat panel: opening/closing the sheet, the
// lazy first-message name prompt, and sending messages. Kept separate from
// interaction.js, which owns the grid's own tap/type/pan gestures --
// unrelated concerns, and this one is small enough not to justify folding
// the two together.

import { getUserName, setUserName } from "./presence.js";
import { openChat, closeChat } from "./chat.js";

const NAME_MAX_LENGTH = 20;

export function wireChat(
  chatState,
  {
    chatToggleBtn,
    chatPanelEl,
    chatCloseBtn,
    chatForm,
    chatInput,
    nameModal,
    nameForm,
    nameInput,
    rosterEl,
    onChatChange,
    onSendMessage,
    onRenameSelf,
  }
) {
  const openPanel = () => {
    openChat(chatState);
    onChatChange();
    chatInput.focus({ preventScroll: true });
  };

  const closePanel = () => {
    closeChat(chatState);
    onChatChange();
  };

  chatToggleBtn.addEventListener("click", () => {
    if (chatState.open) closePanel();
    else openPanel();
  });
  chatCloseBtn.addEventListener("click", closePanel);

  // If no name is stored yet, whatever's typed before the prompt resolves
  // is held here rather than being lost or sent anonymously. In practice
  // this stays empty now that the prompt fires on focus (see below), before
  // there's usually anything typed -- it's kept as the fallback for the one
  // remaining case where someone dismisses that prompt and sends anyway.
  let pendingText = null;

  const openNameModal = (prefill) => {
    nameInput.value = prefill || "";
    nameModal.hidden = false;
    nameInput.focus({ preventScroll: true });
  };

  const closeNameModal = () => {
    nameModal.hidden = true;
    pendingText = null;
  };

  // Asked at the moment someone's about to start typing, not after they've
  // already written something -- on mobile that's the instant the sheet
  // opens (openPanel already focuses chatInput, so this fires for free);
  // on the desktop dock, where there's no "open" moment since the panel is
  // always visible, it's this same listener firing on an ordinary click
  // into the input. One check covers both, no viewport branching needed.
  chatInput.addEventListener("focus", () => {
    if (!getUserName()) openNameModal("");
  });

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    if (!getUserName()) {
      pendingText = text;
      openNameModal("");
      return;
    }
    chatInput.value = "";
    onSendMessage(text);
  });

  nameForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = nameInput.value.trim().slice(0, NAME_MAX_LENGTH);
    if (!name) return;
    setUserName(name);
    onRenameSelf();
    const toSend = pendingText;
    closeNameModal();
    if (toSend) {
      chatInput.value = "";
      onSendMessage(toSend);
    }
    // Whether this was the focus-triggered prompt or the roster "change
    // name" one, landing back in the input is the natural next step --
    // they were either about to type or just did.
    chatInput.focus({ preventScroll: true });
  });

  // Clicking the dimmed backdrop (not the card itself) cancels -- same as
  // dismissing any other modal -- and drops whatever message was pending
  // rather than silently sending it anonymously later.
  nameModal.addEventListener("click", (e) => {
    if (e.target === nameModal) closeNameModal();
  });

  // Tapping your own roster chip reopens this same card, pre-filled, to
  // change the name later.
  rosterEl.addEventListener("click", (e) => {
    if (e.target.closest(".roster-chip.me")) openNameModal(getUserName() || "");
  });

  return { openPanel, closePanel };
}
