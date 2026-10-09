import { buildQueryOptions } from "./options.js";
import { buildStaffPrompt, buildOwnerPrompt } from "./system-prompt.js";

export const CHAT_TURN_TIMEOUT_MS = 5 * 60 * 1000;

// One chat turn against the product's chat engine: records the turn, builds the
// role-scoped system prompt + SDK options, streams the engine's events to
// `onEvent`, and writes the assistant reply back into the session. Shared by
// /api/chat/turn (employee + owner chat) and the kit compat layer's /api/chat,
// so the staff read-scope rules live in exactly one place.
// `model` / `effort` are owner-only knobs (the kit page's chat popover); staff are
// always pinned to the engine defaults.
export async function runChatTurn({ ctx, user, session, prompt, onEvent, abortController = new AbortController(), model = null, systemAppend = "" }) {
  const { vaultPath, audit, chatSessions, runTurn, statusStore } = ctx;
  let timedOut = false;
  try {
    chatSessions.recordTurn(session.id, { role: "user", content: prompt });
    const base = user.role === "owner"
      ? buildOwnerPrompt({ vaultPath, name: user.displayName })
      : buildStaffPrompt({ vaultPath, name: user.displayName, folders: [...user.switches.folders, ...(user.switches.teamFolder ? [user.switches.teamFolder] : [])] });
    const systemPrompt = user.role === "owner" && systemAppend ? `${base}\n\n${systemAppend}` : base;
    const options = buildQueryOptions({ vaultPath, user, systemPrompt, claudeSessionId: session.claudeSessionId, audit });
    if (user.role === "owner" && model) options.model = model;
    options.abortController = abortController;
    let assistantText = "";
    const timer = setTimeout(() => {
      timedOut = true;
      onEvent({ type: "error", message: "Claude took too long. Try again." });
      abortController.abort();
    }, CHAT_TURN_TIMEOUT_MS);
    try {
      let observedThisTurn = false;
      for await (const ev of runTurn({ prompt, options })) {
        if (ev.type === "session" && ev.claudeSessionId) chatSessions.setClaudeSessionId(session.id, ev.claudeSessionId);
        if (ev.type === "text") assistantText += ev.delta;
        onEvent(ev);
        if (ev.type === "text" && !observedThisTurn) { observedThisTurn = true; statusStore?.recordClaudeObservation(true); }
        if (ev.type === "error") statusStore?.observeChatError(ev.message);
      }
      if (assistantText) chatSessions.recordTurn(session.id, { role: "assistant", content: assistantText });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (!timedOut) onEvent({ type: "error", message: err.message });
  }
  return { timedOut };
}
