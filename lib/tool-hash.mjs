import fs from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { compare } from "./symbols.mjs";

export const toolPaths = [
  "cli.mjs",
  "lib",
  "src",
  "gleam.toml",
  "manifest.toml",
  "package.json",
  "pnpm-lock.yaml",
  "build/dev/javascript",
];

export function embeddedToolHash() {
  return typeof CODE_MAP_TOOL_HASH === "undefined" ? null : CODE_MAP_TOOL_HASH;
}

export async function hashToolFiles(root) {
  const hash = createHash("sha256");
  async function add(path) {
    const full = join(root, path);
    const stat = await fs.lstat(full);
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(full)).sort(compare)) await add(`${path}/${name}`);
    } else if (stat.isFile()) {
      hash.update(path).update("\0").update(await fs.readFile(full)).update("\0");
    } else {
      throw new Error(`Unexpected tool resource: ${path}`);
    }
  }
  for (const path of toolPaths) await add(path);
  return hash.digest("hex");
}
