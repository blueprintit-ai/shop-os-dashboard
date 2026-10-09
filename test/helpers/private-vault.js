// A throwaway vault with Private material at several depths, for the staff-visibility tests.
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

export const STAFF = { id: "s1", username: "marco", displayName: "Marco", role: "staff", switches: { folders: ["Projects", "Resources"], teamFolder: null } };
export const OWNER = { id: "o1", username: "pat", displayName: "Pat", role: "owner", switches: { folders: [], teamFolder: null } };

const FILES = {
  "Projects/Acme.md": "# Acme\nKitchen job. See [[Salary Review]] and [[Handbook]].\n",
  "Projects/Private/job-margins.md": "# Margins\nsecret-margin-token\n",
  "Projects/Deep/er/Private/x/y.md": "# Deep\nsecret-deep-token\n",
  "Resources/Handbook.md": "# Handbook\nOpening hours. Link to [[Salary Review]] and [[Acme]].\n",
  "Resources/Private/hr.md": "# Salary Review\nsecret-hr-token\n",
  "Resources/Private/_processed/orig.txt": "secret-orig-token\n",
  "Resources/fm-true.md": "---\nprivate: true\n---\n# Quiet Note\nsecret-fm-token\n",
  "Resources/fm-yes.md": "---\r\nPrivate : \"Yes\"\r\n---\r\nsecret-fm-yes-token\n",
  "Resources/fm-quoted.md": "---\ntitle: x\n'private': 'true'\n---\nsecret-fm-quoted-token\n",
  "Resources/fm-false.md": "---\nprivate: false\n---\n# Public Note\nvisible-fm-false-token\n",
  "Resources/not-fm.md": "# Body\n\nprivate: true\n\nvisible-body-private-token\n",
  "Resources/salary-2025.md": "# Pay\nsecret-pattern-token\n",
  "Resources/bank-statement.txt": "secret-bank-token\n",
  "Resources/ok.md": "# Ok\nvisible-ok-token\n",
  "Resources/Payroll Notes/q1.md": "secret-payroll-folder-token\n",
  "Resources/Finance/Owner Draw/draw.md": "secret-listed-path-token\n",
  "Private/Salaries.md": "# Salaries\nsecret-root-private-token\n",
  "Raw/Private/inbox.txt": "secret-raw-token\n",
  "Context/payroll.md": "secret-context-token\n",
  "Team/Salaries/s.md": "secret-team-token\n",
  "Dashboard/artifacts/placeholder.txt": "x\n",
};

export function makeVault({ config } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sod-private-"));
  const vault = join(root, "vault");
  for (const [rel, body] of Object.entries(FILES)) {
    const abs = join(vault, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  if (config !== undefined) writeConfig(vault, config);
  return { root, vault, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

let bump = 1;
export function writeConfig(vault, config) {
  const f = join(vault, "Dashboard", "private-paths.json");
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, typeof config === "string" ? config : JSON.stringify(config));
  // distinct mtime on every write so the re-read-on-change logic is deterministic on coarse clocks
  const t = new Date(Date.now() + 1000 * bump++);
  utimesSync(f, t, t);
}

export function link(target, path) {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path);
}

export const OWNER_LIST = { paths: ["Resources/Finance/Owner Draw", "Context/payroll.md", "Team/Salaries"], patterns: ["salary*", "*payroll*", "bank-*"] };
