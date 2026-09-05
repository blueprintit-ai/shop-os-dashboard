import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function localStamp(ts) {
  const d = new Date(ts);
  return {
    date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
    hhmm: `${pad2(d.getHours())}${pad2(d.getMinutes())}`,
  };
}

function slugify(name) {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // strip Unicode combining diacritical marks
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "anon"
  );
}

export function transcriptFilename(session) {
  const { date, hhmm } = localStamp(session.startedAt);
  return `${date}-${hhmm}-${slugify(session.name)}.md`;
}

export function buildTranscript(session) {
  const started = localStamp(session.startedAt);
  const ended = localStamp(session.lastActivityAt);
  const userSlug = slugify(session.name);

  const lines = [
    "---",
    "type: chat-transcript",
    "project: shop-os-chat",
    `date: ${started.date}`,
    `user: ${userSlug}`,
    `started: ${started.time}`,
    `ended: ${ended.time}`,
    `turn-count: ${session.turns.length}`,
    `tags: [chat-transcript, shop-os-chat]`,
    "---",
    "",
  ];

  for (const turn of session.turns) {
    const header = turn.role === "user" ? "## User" : "## Assistant";
    lines.push(header, "", turn.content, "");
  }

  return lines.join("\n");
}

const CHATS_CLAUDE_MD = `# Chats

This folder holds transcripts of Shop OS Chat sessions. Each file is one conversation between a team member and Claude (read-only mode). These are first-class vault content. Search them like any other note, reference them in wikilinks, summarize them when asked.

Files are named \`YYYY-MM-DD-HHmm-<name>.md\` using the time the session started.
`;

export function writeTranscript(vaultPath, session) {
  const chatsDir = join(vaultPath, "Chats");
  if (!existsSync(chatsDir)) {
    mkdirSync(chatsDir, { recursive: true });
  }
  const claudeMdPath = join(chatsDir, "CLAUDE.md");
  if (!existsSync(claudeMdPath)) {
    writeFileSync(claudeMdPath, CHATS_CLAUDE_MD, "utf8");
  }
  const filePath = join(chatsDir, transcriptFilename(session));
  writeFileSync(filePath, buildTranscript(session), "utf8");
  return filePath;
}
