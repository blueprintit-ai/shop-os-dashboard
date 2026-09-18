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
// Post-review fix: the ring is not the only thing behind #chat-root --
// #widgets-root's ".w" widgets are position:fixed too, with no z-index
// coordination against #chat-root (which has no dedicated positioning CSS
// of its own). Hiding only ring-root left the widget grid visibly
// overlapping the opened chat panel. Both #ring-root and #widgets-root now
// flip together: chat replaces the whole ring+grid view, not just the ring
// canvas.
//
// Post-review fix (finding 7): this button is now a 3-state view manager --
// 'ring' (the dashboard), 'chat' (this button's own panel) and 'notes' (the
// orb's "no Second Brain" fallback, opened through window.showNotesTab; see
// ring.js's openNoteViewer() and boot.js). Whichever non-ring panel is open,
// #ring-root/#widgets-root stay hidden together for the same reason as
// above, and the CHAT button doubles as that panel's own close/back
// affordance (it always reads CLOSE while chat OR notes is open, and always
// returns to the ring view) -- so opening notes by clicking the orb no
// longer leaves the dashboard with no control to get back to it.
//
// owner.css deliberately has no CSS for a chat-bar button (it excludes the
// kit's #chatBar/#chatLog/.cm by name) -- this uses the one generic button
// chrome class owner.css does ship (.hbtn) and inline-positions itself, the
// same pattern ring.js's own #ballMenu already uses for a DOM piece with no
// dedicated selector.
//
// panelState is module-level (not returned from mountChatToggle) because
// ring.js calls mountChatToggle(root) as the last line of its own
// mountRing() with no return value in its contract, while the thing that
// needs to reach into the "notes" state -- boot.js's window.showNotesTab --
// is defined separately, after mountRing() has already run. Module scope is
// the simplest way for openNotesPanel() below to reach the same instance
// mountChatToggle() just built, without changing mountRing()/ring.js's
// existing call contract.
let panelState = null;

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
  const notesRoot = document.getElementById("notes-root");
  const widgetsRoot = document.getElementById("widgets-root");

  let mode = "ring";

  function showRing() {
    mode = "ring";
    ringRoot.hidden = false;
    if (widgetsRoot) widgetsRoot.hidden = false;
    chatRoot.hidden = true;
    if (notesRoot) notesRoot.hidden = true;
    btn.textContent = "CHAT";
    btn.title = "Open chat";
  }
  function showChat() {
    mode = "chat";
    ringRoot.hidden = true;
    if (widgetsRoot) widgetsRoot.hidden = true;
    chatRoot.hidden = false;
    if (notesRoot) notesRoot.hidden = true;
    btn.textContent = "CLOSE";
    btn.title = "Back to dashboard";
  }
  function showNotes() {
    mode = "notes";
    ringRoot.hidden = true;
    if (widgetsRoot) widgetsRoot.hidden = true;
    chatRoot.hidden = true;
    if (notesRoot) notesRoot.hidden = false;
    btn.textContent = "CLOSE";
    btn.title = "Back to dashboard";
  }

  btn.addEventListener("click", () => { mode === "ring" ? showChat() : showRing(); });

  panelState = { showNotes };
}

// Used by boot.js's window.showNotesTab (the contract ring.js's own
// openNoteViewer() already documents) so opening the note viewer from the
// orb goes through the same panel manager as the CHAT button, instead of
// only flipping [data-tab-panel] visibility and leaving the ring/widgets
// grid drawn on top of it with no way back.
export function openNotesPanel() {
  panelState?.showNotes();
}
