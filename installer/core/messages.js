export function renderFailure({ stepTitle, supportCode, logPath }) {
  return [
    "",
    `Setup hit a problem at "${stepTitle}". We've been notified and will email you shortly. If you contact us, quote support code ${supportCode}.`,
    "",
    `A detailed log was saved at ${logPath}`,
    "",
  ].join("\n");
}

export function renderSuccess({ desktopInstalled, vaultPath, warnings = [] }) {
  const lines = ["", "Blueprint OS is installed.", `Your vault: ${vaultPath}`, ""];
  if (desktopInstalled) {
    lines.push(
      "Claude Desktop was found. Your Blueprint OS skills work in Claude Code in the terminal and in the Code tab of Claude Desktop.",
      "The Chat and Cowork tabs of Claude Desktop keep their own list, so ask Blueprint IT if you want the skills there too.",
      "",
    );
  }
  for (const w of warnings) lines.push(`Note: ${w}`);
  if (warnings.length) lines.push("");
  return lines.join("\n");
}
