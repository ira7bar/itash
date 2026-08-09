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

  // No message is ever lost to a missing name: if none is stored yet, the
  // typed text is held here until the name form resolves it, rather than
  // being sent anonymously or discarded.
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
