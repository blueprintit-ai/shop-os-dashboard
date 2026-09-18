import { gunzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
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
    const size = readOctal(header, 124, 12);
    const typeflag = String.fromCharCode(header[156]) || "0";
    offset += BLOCK;
    const dataStart = offset;
    const paddedSize = Math.ceil(size / BLOCK) * BLOCK;
    offset += paddedSize;

    if (!fullName) continue;
    const parts = fullName.split("/").filter(Boolean).slice(stripComponents);
    if (parts.length === 0) continue;
    const outPath = join(destDir, ...parts);

    if (typeflag === "5") {
      mkdirSync(outPath, { recursive: true });
    } else if (typeflag === "0" || typeflag === "\0") {
      mkdirSync(join(outPath, ".."), { recursive: true });
      writeFileSync(outPath, tar.subarray(dataStart, dataStart + size));
      files.push(parts.join("/"));
    }
    // Other typeflags (symlink, char/block device, fifo) are skipped — not
    // present in GitHub tarballs or Node's own dist archives.
  }
  return { files };
}
