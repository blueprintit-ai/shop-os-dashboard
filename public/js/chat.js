import { api, sse, escapeHtml, toast } from "/static/js/api.js";
import { renderMarkdown as renderMarkdownSafe } from "/static/js/render-markdown.js";

const root = document.getElementById("chat-root");

const STATE = {
  sessionId: null,
  turns: [],
  name: "",
  role: "staff",
  sending: false,
};

root.innerHTML = `
  <div class="chat-app">
    <div class="messages" id="chat-messages"></div>
    <form class="composer" id="chat-composer">
      <textarea id="chat-prompt" rows="1" placeholder="Ask a question…"></textarea>
      <button type="submit" id="chat-send">Send</button>
      <button type="button" id="chat-end" title="End conversation">End</button>
    </form>
  </div>
`;

const els = {
  messages: document.getElementById("chat-messages"),
  composer: document.getElementById("chat-composer"),
  prompt: document.getElementById("chat-prompt"),
  send: document.getElementById("chat-send"),
  end: document.getElementById("chat-end"),
};

function renderMarkdown(md) {
  return renderMarkdownSafe(md, (s) => window.marked.parse(s), escapeHtml);
}

root.addEventListener("click", (e) => {
  const a = e.target.closest("a.wikilink[data-target]");
  if (!a) return;
  e.preventDefault();
  window.openNoteByTarget?.(a.dataset.target);
});

function appendMessage(role, who, content) {
  const node = document.createElement("div");
  node.className = `msg ${role}`;
  node.innerHTML = `<span class="who"></span><div class="tool-lines"></div><div class="body"></div>`;
  node.querySelector(".who").textContent = who;
  if (content) node.querySelector(".body").innerHTML = renderMarkdown(content);
  els.messages.appendChild(node);
  els.messages.scrollTop = els.messages.scrollHeight;
  return node;
}

function toolLineText(ev) {
  const input = ev.input || {};
  const path = input.file_path ?? input.path ?? input.notebook_path ?? "";
  return path ? `${ev.name} ${path}` : ev.name;
}

async function ensureSession() {
  if (STATE.sessionId) return STATE.sessionId;
  const res = await api("POST", "/api/chat/session", {});
  if (!res.ok) { toast("Could not start a chat session."); throw new Error("session"); }
  const { sessionId } = await res.json();
  STATE.sessionId = sessionId;
  STATE.turns = [];
  return sessionId;
}

async function sendPrompt(prompt) {
  if (STATE.sending) return;
  STATE.sending = true;
  els.send.disabled = true;
  try {
    const sessionId = await ensureSession();
    appendMessage("user", STATE.name || "You", prompt);
    STATE.turns.push({ role: "user", content: prompt });

    const assistantNode = appendMessage("assistant", "Shop OS", "");
    const toolLines = assistantNode.querySelector(".tool-lines");
    const body = assistantNode.querySelector(".body");
    let queueLine = null;
    let text = "";

    await sse("/api/chat/turn", { sessionId, prompt }, (ev) => {
      if (ev.type === "queue") {
        if (!queueLine) {
          queueLine = document.createElement("div");
          queueLine.className = "queue-line";
          toolLines.appendChild(queueLine);
        }
        queueLine.textContent = `Waiting for a free slot (#${ev.position})`;
      } else if (ev.type === "tool_use") {
        if (queueLine) { queueLine.remove(); queueLine = null; }
        const line = document.createElement("div");
        line.className = "tool-line";
        line.textContent = toolLineText(ev);
        toolLines.appendChild(line);
      } else if (ev.type === "text") {
        if (queueLine) { queueLine.remove(); queueLine = null; }
        text += ev.delta;
        body.innerHTML = renderMarkdown(text);
        els.messages.scrollTop = els.messages.scrollHeight;
      } else if (ev.type === "done") {
        if (queueLine) { queueLine.remove(); queueLine = null; }
        if (text) STATE.turns.push({ role: "assistant", content: text });
      } else if (ev.type === "error") {
        if (queueLine) { queueLine.remove(); queueLine = null; }
        const err = document.createElement("div");
        err.className = "tool-line";
        err.textContent = "Sorry, something went wrong: " + (ev.message || "unknown error");
        toolLines.appendChild(err);
      }
    });
  } catch {
    // ensureSession already surfaced a toast
  } finally {
    STATE.sending = false;
    els.send.disabled = false;
  }
}

els.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  const prompt = els.prompt.value.trim();
  if (!prompt) return;
  els.prompt.value = "";
  sendPrompt(prompt);
});

els.prompt.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    els.composer.requestSubmit();
  }
});

async function endConversation() {
  await endSession(api);
  STATE.sessionId = null;
  STATE.turns = [];
  els.messages.innerHTML = "";
  try { await ensureSession(); } catch {}
}

async function endSession(sender) {
  if (!STATE.sessionId || STATE.turns.length === 0) return;
  await sender("POST", "/api/chat/end", { sessionId: STATE.sessionId });
}

els.end.addEventListener("click", () => { endConversation(); });

window.addEventListener("beforeunload", () => {
  if (!STATE.sessionId || STATE.turns.length === 0) return;
  const payload = JSON.stringify({ sessionId: STATE.sessionId });
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/chat/end", new Blob([payload], { type: "application/json" }));
  } else {
    fetch("/api/chat/end", { method: "POST", headers: { "content-type": "application/json" }, body: payload, keepalive: true });
  }
});

(async () => {
  try {
    const me = await (await api("GET", "/api/me")).json();
    STATE.name = me.user.displayName;
    STATE.role = me.user.role;
  } catch {
    // /api/me redirects to /login on 401 via api()
  }
})();
