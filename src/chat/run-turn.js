import { query } from "@anthropic-ai/claude-agent-sdk";

export async function* runTurn({ prompt, options }) {
  let collected = "";
  let stats = null;
  try {
    for await (const event of query({ prompt, options })) {
      if (event.type === "system" && event.subtype === "init" && event.session_id) {
        yield { type: "session", claudeSessionId: event.session_id };
      } else if (event.type === "assistant" && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "text" && block.text) { collected += block.text; yield { type: "text", delta: block.text }; }
          else if (block.type === "tool_use") yield { type: "tool_use", name: block.name, input: block.input };
        }
      } else if (event.type === "user" && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "tool_result") yield { type: "tool_result", name: block.tool_name ?? "tool", output: block.content };
        }
      } else if (event.type === "result") {
        stats = { duration_ms: event.duration_ms, input_tokens: event.usage?.input_tokens, output_tokens: event.usage?.output_tokens };
      }
    }
    yield { type: "done", text: collected, stats };
  } catch (err) {
    yield { type: "error", message: err?.message ?? String(err) };
  }
}
