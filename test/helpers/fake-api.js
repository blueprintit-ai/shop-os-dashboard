// Runs the REAL Claude Agent SDK / bundled CLI against a LOCAL fake Messages API with a fake key and a throwaway
// config dir, so no real account is used and no tokens are spent. Only for the opt-in RUN_FAKE_API=1 tests.
import http from "node:http";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { runTurn as realRunTurn } from "../../src/chat/run-turn.js";
import { runChatTurn } from "../../src/chat/turn.js";

export async function startFakeApi({ script = [] } = {}) {
  const requests = [];
  let step = 0;
  const sse = (res, blocks, stop) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    const w = (e, d) => res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`);
    w("message_start", { type: "message_start", message: { id: "msg_" + requests.length, type: "message", role: "assistant", model: "claude-sonnet-4-5", content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } });
    blocks.forEach((b, i) => {
      if (b.type === "text") { w("content_block_start", { type: "content_block_start", index: i, content_block: { type: "text", text: "" } }); w("content_block_delta", { type: "content_block_delta", index: i, delta: { type: "text_delta", text: b.text } }); }
      else { w("content_block_start", { type: "content_block_start", index: i, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } }); w("content_block_delta", { type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } }); }
      w("content_block_stop", { type: "content_block_stop", index: i });
    });
    w("message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } });
    w("message_stop", { type: "message_stop" }); res.end();
  };
  const server = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (!req.url.startsWith("/v1/messages") || req.url.includes("count_tokens")) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ input_tokens: 1 })); }
      let j = {}; try { j = JSON.parse(body); } catch { /* keep {} */ }
      const main = Array.isArray(j.tools) && j.tools.some((t) => t.name === "Read");
      if (main) requests.push({ body, json: j });
      if (!main) return sse(res, [{ type: "text", text: "ok" }], "end_turn");
      if (step < script.length) { const c = script[step++]; return sse(res, [{ type: "tool_use", id: "toolu_" + step, name: c.name, input: c.input }], "tool_use"); }
      return sse(res, [{ type: "text", text: "done" }], "end_turn");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { requests, port: server.address().port, close: () => server.close() };
}

// One staff chat turn through runChatTurn (so src/chat/turn.js is what is under test), on the real engine.
export async function staffTurn({ api, vault, home, user, prompt, systemPrompt = "test" }) {
  mkdirSync(home, { recursive: true });
  const events = [];
  const audit = { log: (e, f) => events.push({ e, ...f }) };
  const env = { PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), ANTHROPIC_API_KEY: "sk-ant-api03-FAKEFAKE", ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.port}`, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_TELEMETRY: "1", DISABLE_AUTOUPDATER: "1" };
  const runTurn = ({ prompt: p, options }) => realRunTurn({ prompt: p, options: { ...options, env } });
  const ctx = { vaultPath: vault, audit, chatSessions: { recordTurn() {}, setClaudeSessionId() {} }, runTurn, statusStore: null };
  const out = [];
  const before = api.requests.length;
  await runChatTurn({ ctx, user, session: { id: "s", claudeSessionId: null }, prompt, onEvent: (ev) => out.push(ev) });
  return { events, out, requests: api.requests.slice(before) };
}
