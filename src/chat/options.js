import { statSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { isPathAllowed, isPrivatePath } from "../scope.js";
import { VAULT_SERVER_NAME, VAULT_TOOL_NAMES, UNAVAILABLE, createVaultServer } from "./vault-tools.js";

// Staff get Read (path-checked below, on the real path, private rules included) and two in-process tools, search and
// list (src/chat/vault-tools.js). They do NOT get the SDK's built-in Grep and Glob: those return matches from every
// file below the folder they are pointed at, so checking only the folder they were asked about let a staff user
// granted `Resources` search into `Resources/Private/...`.
export const STAFF_TOOLS = Object.freeze(["Read"]);
export const STAFF_MCP_TOOLS = VAULT_TOOL_NAMES;

function pathFromInput(toolName, input, cwd) {
  const raw = input?.file_path ?? input?.path ?? input?.notebook_path ?? input?.folder ?? null;
  if (typeof raw !== "string" || raw === "") return null;
  return isAbsolute(raw) ? raw : resolve(cwd, raw);
}

// Single source of truth for the staff scope decision, shared by canUseTool
// (the SDK's permission callback) and the PreToolUse hook below. Both are
// wired up for staff: on the real Claude Agent SDK, permissionMode "default"
// auto-approves read-only tools (Read) internally and never calls
// canUseTool for them at all -- confirmed against a live SDK session while
// building this. The PreToolUse hook fires unconditionally for every tool
// call regardless of that internal auto-approval, so it is the mechanism
// that actually closes the gap; canUseTool is kept as defense-in-depth (it
// is exercised directly by the unit tests below, and covers any tool/mode
// combination where the SDK does still invoke it). The vault tools check
// every entry they return themselves too; the folder check here is a second lock.
function isRegularFile(p) { try { return statSync(p).isFile(); } catch { return false; } }

function staffDecision(toolName, input, vaultPath, user) {
  const isVaultTool = STAFF_MCP_TOOLS.includes(toolName);
  if (!STAFF_TOOLS.includes(toolName) && !isVaultTool) {
    return { deny: true, reason: "tool-not-allowed", message: `${toolName} is not available in this chat. Ask the owner if you need changes made.` };
  }
  const p = pathFromInput(toolName, input, vaultPath);
  if (p !== null && !isPathAllowed(vaultPath, user, p)) {
    // "private" and "out-of-scope" are told apart only in the audit log; the person (and the model) get one neutral answer.
    return { deny: true, reason: isPrivatePath(vaultPath, p) ? "private" : "out-of-scope", path: p, message: UNAVAILABLE };
  }
  // Read only ever runs on a file that exists and is a plain file. Its own errors (EISDIR, "does not exist ... your
  // current working directory is /abs/path") carry absolute paths, and "missing" vs "denied" would tell a guesser
  // which private files exist, so for staff every one of those is the same neutral answer.
  if (p !== null && toolName === "Read" && !isRegularFile(p)) return { deny: true, reason: "not-a-file", path: p, message: UNAVAILABLE };
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
        audit?.log("chat.tool", { userId: user.id, username: user.username, role: user.role, tool: toolName, path: pathFromInput(toolName, input, vaultPath) ?? undefined });
        return { behavior: "allow", updatedInput: input };
      },
    };
  }

  return {
    ...base,
    tools: [...STAFF_TOOLS],
    mcpServers: { [VAULT_SERVER_NAME]: createVaultServer({ vaultPath, user, audit }) },
    strictMcpConfig: true, // no other MCP server from user, project or plugin config
    settings: { autoMemoryEnabled: false, disableBundledSkills: true }, // the owner's chat memory must not surface in a staff turn; no bundled skills
    skills: [],
    // belt and braces: the allow-list above is `tools`; these names are also refused outright
    disallowedTools: ["Skill", "SlashCommand", "Agent", "Task", "Bash", "Write", "Edit", "NotebookEdit", "Grep", "Glob", "WebFetch", "WebSearch", "ToolSearch"],
    settingSources: [],
    maxTurns: 20,
    canUseTool: async (toolName, input) => {
      const d = staffDecision(toolName, input, vaultPath, user);
      if (d.deny) {
        audit?.log("chat.denied", { userId: user.id, username: user.username, role: user.role, tool: toolName, path: d.path, reason: d.reason });
        return { behavior: "deny", message: d.message };
      }
      return { behavior: "allow", updatedInput: input };
    },
    // Belt-and-suspenders: the real SDK auto-approves read-only tools under
    // permissionMode "default" without ever calling canUseTool, so this hook
    // is the enforcement point that actually runs for every Read and vault tool
    // call. See staffDecision's comment for how this was discovered.
    hooks: {
      PreToolUse: [
        {
          hooks: [
            async (hookInput) => {
              if (hookInput.hook_event_name !== "PreToolUse") return {};
              const d = staffDecision(hookInput.tool_name, hookInput.tool_input, vaultPath, user);
              if (d.deny) {
                audit?.log("chat.denied", { userId: user.id, username: user.username, role: user.role, tool: hookInput.tool_name, path: d.path, reason: d.reason, via: "hook" });
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
