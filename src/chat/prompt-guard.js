// What a staff member types is untrusted input to Claude Code, which interprets some of it BEFORE any tool call and
// therefore before our PreToolUse hook or canUseTool can see it:
//   - `@path` mentions are expanded by the CLI itself: the file (or a directory listing) is put in front of the model,
//     for any path the dashboard account can read (vault Private folders, the dashboard's own users.json, ~/.ssh, .env);
//   - a prompt that starts with `/` runs a slash command (/insights, /context, /init, ...) and one that starts with `!`
//     runs a shell line.
// For staff both are made inert here. Owner prompts are left alone (the owner has the whole vault and the terminal).
const ZWSP = "​";

// "@" followed by anything but whitespace or an existing zero-width space gets a zero-width space after it, so the
// text still reads the same but is no longer a mention. Emails, a lone "@" and repeats are all fine.
export function neutralizeMentions(text) {
  return String(text).replace(/@(?=[^\s​])/g, "@" + ZWSP);
}

// A leading "/" or "!" (after optional whitespace or zero-width characters) would be read as a command: put plain
// words in front of it.
export function neutralizeCommandPrefix(text) {
  const s = String(text);
  return /^[\s​-‏⁠﻿]*[\/!]/.test(s) ? `Message from the user: ${s}` : s;
}

export function guardStaffPrompt(prompt) {
  if (typeof prompt === "string") return neutralizeCommandPrefix(neutralizeMentions(prompt));
  if (Array.isArray(prompt)) { // content blocks: only text blocks carry mentions or commands
    let first = true;
    return prompt.map((b) => {
      if (b && b.type === "text" && typeof b.text === "string") {
        const t = neutralizeMentions(b.text);
        const out = { ...b, text: first ? neutralizeCommandPrefix(t) : t };
        first = false;
        return out;
      }
      return b;
    });
  }
  return prompt;
}
