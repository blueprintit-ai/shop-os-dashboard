// Chat bar toggle: a small button that shows/hides Plan 1's already-built
// #chat-root (chat.js populates it at module load, before boot.js ever
// runs) -- this does not reimplement any part of the chat engine.
//
// The reference kit's own in-dashboard chat bar (dashboard.html:3816-3934,
// backed by a second `claude -p` CLI process in server.js) is NOT ported;
// see ring.js's file header for why (Plan 1 already built a chat engine
// through the Agent SDK that does the same job, and the design spec calls
// for exactly one).
//
// Correction versus the brief's own illustrative sketch: the sketch
// appended the toggle button as a CHILD of ringRoot, then toggled
// ringRoot.hidden to hide the ring while chat is open. Since `hidden` sets
// display:none on the element and everything inside it, that would hide the
// button along with the ring the first time chat opens, with no way left
// to click it again and close chat (chat.js's own "End" button ends the
// SDK session, it does not hide the panel). The button is appended to
// document.body instead, so it survives ringRoot being hidden.
//
// owner.css deliberately has no CSS for a chat-bar button (it excludes the
// kit's #chatBar/#chatLog/.cm by name) -- this uses the one generic button
// chrome class owner.css does ship (.hbtn) and inline-positions itself, the
// same pattern ring.js's own #ballMenu already uses for a DOM piece with no
// dedicated selector.
export function mountChatToggle(ringRoot) {
  document.getElementById("chatBar")?.remove(); // idempotent, mirrors mountRing's own repeat-mount tolerance

  const btn = document.createElement("button");
  btn.id = "chatBar";
  btn.type = "button";
  btn.className = "hbtn solid";
  btn.textContent = "CHAT";
  btn.title = "Open chat";
  Object.assign(btn.style, {
    position: "fixed", right: "18px", bottom: "18px", zIndex: "70",
  });
  document.body.appendChild(btn);

  const chatRoot = document.getElementById("chat-root");
  btn.addEventListener("click", () => {
    const opening = chatRoot.hidden;
    chatRoot.hidden = !opening;
    ringRoot.hidden = opening;
    btn.textContent = opening ? "CLOSE" : "CHAT";
  });
}
