import { gunzipSync } from "node:zlib";
import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

const BLOCK = 512;

function readField(buf, start, len) {
  return buf.subarray(start, start + len).toString("utf8").replace(/\0.*$/s, "").trim();
}

function readOctal(buf, start, len) {
  const s = readField(buf, start, len);
  return s ? parseInt(s, 8) : 0;
}

// USTAR only. GNU long-name ('L' typeflag) entries are not handled — GitHub's
// codeload tarballs and Node's own dist tarballs use plain ustar with the
// prefix field for long paths, which this does handle.
export function extractTarGz(gzBuffer, destDir, { stripComponents = 0 } = {}) {
  const tar = gunzipSync(gzBuffer);
  const files = [];
  let offset = 0;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) break; // end-of-archive marker
    const name = readField(header, 0, 100);
    const prefix = readField(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const mode = readOctal(header, 100, 8);
    const size = readOctal(header, 124, 12);
    const typeflag = String.fromCharCode(header[156]) || "0";
    offset += BLOCK;
    const dataStart = offset;
    const paddedSize = Math.ceil(size / BLOCK) * BLOCK;
    offset += paddedSize;

    if (!fullName) continue;
    const parts = fullName.split("/").filter(Boolean).slice(stripComponents);
    if (parts.length === 0) continue;
    // tar-slip: an entry named "repo-main/../../pwned.txt" would otherwise
    // land two directories above destDir. Reject the entry outright rather
    // than normalizing it — this is an installer writing into the user's home.
    if (parts.some((p) => p === "..")) continue;
    const outPath = join(destDir, ...parts);

    if (typeflag === "5") {
      mkdirSync(outPath, { recursive: true });
    } else if (typeflag === "0" || typeflag === "\0") {
      mkdirSync(join(outPath, ".."), { recursive: true });
      writeFileSync(outPath, tar.subarray(dataStart, dataStart + size));
      // Without this the extracted `bin/node` lands at the default 0644 and is
      // not executable — which only bites on resolveNode's own download path
      // (the bootstrap scripts shell out to the OS tar, which does apply modes).
      if (mode) { try { chmodSync(outPath, mode & 0o777); } catch { /* no-op on Windows/odd filesystems */ } }
      files.push(parts.join("/"));
    }
    // Other typeflags (symlink, char/block device, fifo) are skipped — not
    // present in GitHub tarballs or Node's own dist archives.
  }
  return { files };
}
