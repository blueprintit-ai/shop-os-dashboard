import { readJsonBody, sendJson } from "../lib/http.js";
import { requireUser } from "../auth.js";
import { buildQueryOptions } from "../chat/options.js";
import { buildStaffPrompt, buildOwnerPrompt } from "../chat/system-prompt.js";
import { writeTranscript } from "../chat/transcript.js";

export function chatRoutes(ctx) {
  const { vaultPath, auth, audit, guard, chatSessions, runTurn, statusStore } = ctx;
  return async (req, res, url) => {
    const p = url.pathname;
    if (!p.startsWith("/api/chat/")) return false;
    const user = requireUser(req, res, auth); if (!user) return true;

    if (req.method === "GET" && p === "/api/chat/status") return sendJson(res, 200, guard.stats()), true;

    if (req.method === "POST" && p === "/api/chat/session") {
      const s = chatSessions.create({ name: user.displayName, userId: user.id });
      audit.log("chat.session.start", { userId: user.id, username: user.username, sessionId: s.id, role: user.role });
      return sendJson(res, 200, { sessionId: s.id }), true;
    }

    if (req.method === "POST" && p === "/api/chat/turn") {
      const b = await readJsonBody(req);
      const session = chatSessions.get(b.sessionId);
      if (!session) return sendJson(res, 404, { error: "Unknown sessionId" }), true;
      if (session.userId !== user.id) return sendJson(res, 403, { error: "Not your session" }), true;
      if (!b.prompt || typeof b.prompt !== "string") return sendJson(res, 400, { error: "prompt is required" }), true;

      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const write = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
      if (guard.stats().running >= guard.max) write({ type: "queue", position: guard.stats().queued + 1 });
      const release = await guard.acquire(session.id);
      let timedOut = false;
      try {
        chatSessions.recordTurn(session.id, { role: "user", content: b.prompt });
        const systemPrompt = user.role === "owner"
          ? buildOwnerPrompt({ vaultPath, name: user.displayName })
          : buildStaffPrompt({ vaultPath, name: user.displayName, folders: [...user.switches.folders, ...(user.switches.teamFolder ? [user.switches.teamFolder] : [])] });
        const options = buildQueryOptions({ vaultPath, user, systemPrompt, claudeSessionId: session.claudeSessionId, audit });
        let assistantText = "";
        const abortController = new AbortController();
        options.abortController = abortController;
        const timer = setTimeout(() => {
          timedOut = true;
          write({ type: "error", message: "Claude took too long. Try again." });
          abortController.abort();
        }, 5 * 60 * 1000);
        try {
          let observedThisTurn = false;
          for await (const ev of runTurn({ prompt: b.prompt, options })) {
            if (ev.type === "session" && ev.claudeSessionId) chatSessions.setClaudeSessionId(session.id, ev.claudeSessionId);
            if (ev.type === "text") assistantText += ev.delta;
            write(ev);
            if (ev.type === "text" && !observedThisTurn) { observedThisTurn = true; ctx.statusStore?.recordClaudeObservation(true); }
            if (ev.type === "error") ctx.statusStore?.observeChatError(ev.message);
          }
          if (assistantText) chatSessions.recordTurn(session.id, { role: "assistant", content: assistantText });
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        if (!timedOut) write({ type: "error", message: err.message });
      } finally {
        release();
        res.end();
      }
      return true;
    }

    if (req.method === "POST" && p === "/api/chat/end") {
      const b = await readJsonBody(req);
      const session = chatSessions.get(b.sessionId);
      if (!session) return sendJson(res, 404, { error: "Unknown sessionId" }), true;
      if (session.userId !== user.id) return sendJson(res, 403, { error: "Not your session" }), true;
      if (session.turns.length) writeTranscript(vaultPath, { ...session, name: user.username });
      chatSessions.end(session.id);
      audit.log("chat.session.end", { userId: user.id, username: user.username, role: user.role, sessionId: session.id, turns: session.turns.length });
      res.writeHead(204); res.end(); return true;
    }
    return false;
  };
}
