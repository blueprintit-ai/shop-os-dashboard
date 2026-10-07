import { join } from "node:path";

// Candidate paths. NOT yet verified on a real machine: the manual checklist
// (Task 17) confirms them, and any new path found there is added here.
export function detectClaudeDesktop({ platform, env, homeDir, exists }) {
  const local = env.LOCALAPPDATA ?? join(homeDir, "AppData", "Local");
  const candidates = platform === "darwin"
    ? ["/Applications/Claude.app", join(homeDir, "Applications", "Claude.app")]
    : [
        join(local, "AnthropicClaude"),
        join(local, "Programs", "Claude"),
        join(env.ProgramFiles ?? "C:\\Program Files", "Claude"),
      ];
  const hit = candidates.find((p) => exists(p));
  return { installed: !!hit, path: hit ?? null };
}
