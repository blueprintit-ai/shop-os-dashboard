import { resolve, isAbsolute } from "node:path";
import { isPathAllowed } from "../scope.js";

export const STAFF_TOOLS = Object.freeze(["Read", "Glob", "Grep"]);

function pathFromInput(toolName, input, cwd) {
  const raw = input?.file_path ?? input?.path ?? input?.notebook_path ?? null;
  if (raw == null) return null;
  return isAbsolute(raw) ? raw : resolve(cwd, raw);
}

// Single source of truth for the staff scope decision, shared by canUseTool
// (the SDK's permission callback) and the PreToolUse hook below. Both are
// wired up for staff: on the real Claude Agent SDK, permissionMode "default"
// auto-approves read-only tools (Read/Glob/Grep) internally and never calls
// canUseTool for them at all -- confirmed against a live SDK session while
// building this. The PreToolUse hook fires unconditionally for every tool
// call regardless of that internal auto-approval, so it is the mechanism
// that actually closes the gap; canUseTool is kept as defense-in-depth (it
// is exercised directly by the unit tests below, and covers any tool/mode
// combination where the SDK does still invoke it).
function staffDecision(toolName, input, vaultPath, user) {
  if (!STAFF_TOOLS.includes(toolName)) {
    return { deny: true, reason: "tool-not-allowed", message: `${toolName} is not available in this chat. Ask the owner if you need changes made.` };
  }
  const p = pathFromInput(toolName, input, vaultPath);
  if (toolName === "Grep" && p === null) {
    return { deny: true, reason: "grep-needs-path", message: "Search inside one of your folders by passing its path." };
  }
  if (p !== null && !isPathAllowed(vaultPath, user, p)) {
    return { deny: true, reason: "out-of-scope", path: p, message: "That file is outside the folders you have access to. Answer from the folders you can read." };
  }
  return { deny: false, path: p };
}

export function buildQueryOptions({ vaultPath, user, systemPrompt, claudeSessionId, audit }) {
  const base = { cwd: vaultPath, systemPrompt, permissionMode: "default" };
  if (claudeSessionId) base.resume = claudeSessionId;

  if (user.role === "owner") {
    return {
      ...base,
      permissionMode: "acceptEdits",
      settingSources: ["user", "project"],
      skills: "all",
      maxTurns: 60,
      canUseTool: async (toolName, input) => {
        audit?.log("chat.tool", { userId: user.id, tool: toolName, path: pathFromInput(toolName, input, vaultPath) ?? undefined });
        return { behavior: "allow", updatedInput: input };
      },
    };
  }

  return {
    ...base,
    tools: [...STAFF_TOOLS],
    settingSources: [],
    maxTurns: 20,
    canUseTool: async (toolName, input) => {
      const d = staffDecision(toolName, input, vaultPath, user);
      if (d.deny) {
        audit?.log("chat.denied", { userId: user.id, tool: toolName, path: d.path, reason: d.reason });
        return { behavior: "deny", message: d.message };
      }
      return { behavior: "allow", updatedInput: input };
    },
    // Belt-and-suspenders: the real SDK auto-approves read-only tools under
    // permissionMode "default" without ever calling canUseTool, so this hook
    // is the enforcement point that actually runs for every Read/Glob/Grep
    // call. See staffDecision's comment for how this was discovered.
    hooks: {
      PreToolUse: [
        {
          hooks: [
            async (hookInput) => {
              if (hookInput.hook_event_name !== "PreToolUse") return {};
              const d = staffDecision(hookInput.tool_name, hookInput.tool_input, vaultPath, user);
              if (d.deny) {
                audit?.log("chat.denied", { userId: user.id, tool: hookInput.tool_name, path: d.path, reason: d.reason, via: "hook" });
                return {
                  decision: "block",
                  reason: d.message,
                  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: d.message },
                };
              }
              return {};
            },
          ],
        },
      ],
    },
  };
}
