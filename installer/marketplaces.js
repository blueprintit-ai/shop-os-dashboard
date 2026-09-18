import { rmSync, mkdirSync, existsSync } from "node:fs";
import { extractTarGz } from "./tar.js";

export async function fetchMarketplaceTarball({ repo, ref = "main", destDir, fetchImpl = fetch }) {
  const url = `https://codeload.github.com/${repo}/tar.gz/refs/heads/${ref}`;
  try {
    const resp = await fetchImpl(url);
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status} fetching ${url}` };
    const buf = Buffer.from(await resp.arrayBuffer());

    if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
    mkdirSync(destDir, { recursive: true });

    // GitHub's tarball has exactly one top-level directory (e.g. "repo-main/");
    // strip it so destDir's contents match the repo root directly.
    const { files } = extractTarGz(buf, destDir, { stripComponents: 1 });
    return { ok: true, files };
  } catch (e) {
    return { ok: false, error: e.message ?? String(e) };
  }
}
