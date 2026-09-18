import { inflateRawSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

function findEocd(buf) {
  // The EOCD record's comment field means it isn't necessarily at a fixed
  // offset from the end, but scanning the trailing 66KB (max comment length
  // plus the 22-byte record) covers every zip we produce or download here.
  const searchStart = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= searchStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error("Not a valid zip file (End Of Central Directory not found)");
}

export function extractZip(buffer, destDir) {
  const eocdOffset = findEocd(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  const files = [];
  let p = centralDirOffset;
  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(p) !== CENTRAL_SIG) throw new Error(`Bad central directory entry at ${p}`);
    const method = buffer.readUInt16LE(p + 10);
    const compressedSize = buffer.readUInt32LE(p + 20);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const localHeaderOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue; // directory entry, nothing to write

    // zip-slip: reject any entry that would escape destDir via a ".." segment
    // before anything is written. Same check as installer/tar.js.
    const parts = name.split("/").filter(Boolean);
    if (parts.length === 0 || parts.some((p) => p === "..")) continue;

    // Re-read name/extra lengths from the LOCAL header: they can differ
    // slightly from the central directory copy (extra field padding tools add).
    if (buffer.readUInt32LE(localHeaderOffset) !== LOCAL_SIG) throw new Error(`Bad local header at ${localHeaderOffset}`);
    const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? compressed : inflateRawSync(compressed);

    const outPath = join(destDir, ...parts);
    mkdirSync(join(outPath, ".."), { recursive: true });
    writeFileSync(outPath, data);
    files.push(name);
  }
  return { files };
}
