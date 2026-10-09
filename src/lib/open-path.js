// The --open <path> CLI option: the page the browser opens (e.g. /employee).
// Strictly an absolute path on this server: never a scheme, host or "//" that
// could turn http://localhost:<port><path> into somewhere else.
export function validateOpenPath(value) {
  if (typeof value !== "string" || value === "") return { ok: false, error: "--open needs a path such as /employee." };
  if (value.length > 100) return { ok: false, error: "--open path is too long (100 characters at most)." };
  if (!value.startsWith("/")) return { ok: false, error: "--open path must start with /, for example /employee." };
  if (value.includes("//")) return { ok: false, error: "--open path must not contain //." };
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return { ok: false, error: "--open path must not include a scheme." };
  if (!/^[A-Za-z0-9/_\-.?=&%]+$/.test(value)) return { ok: false, error: "--open path may only contain letters, digits and / _ - . ? = & %" };
  return { ok: true, path: value };
}
