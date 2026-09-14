import fs from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { loadConfig, configHash } from "./config.mjs";
import { discoverFiles, gitRoot, pathStat } from "./inventory.mjs";
import { parseGleam } from "./gleam.mjs";
import { parseJavaScript } from "./javascript.mjs";
import { parseAstro } from "./astro.mjs";
import { core } from "./core.mjs";
import { embeddedToolHash, hashToolFiles } from "./tool-hash.mjs";

export { queryIndex } from "./queries.mjs";

async function toolHash() {
  const embedded = embeddedToolHash();
  if (embedded) return embedded;
  const root = fileURLToPath(new URL("..", import.meta.url));
  try {
    return await hashToolFiles(root);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new Error("Code map's compiled helper is missing. Run pnpm run build in the code-map tool directory.", { cause: error });
  }
}

async function regularOrMissing(root, path) {
  try {
    const stat = await pathStat(root, path);
    if (stat.isSymbolicLink()) throw new Error(`Refusing symlink cache path: ${path}`);
    return stat;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function readCache(root, rebuild) {
  const directory = await regularOrMissing(root, ".code-map");
  if (directory && !directory.isDirectory()) throw new Error(".code-map must be a directory");
  const stat = await regularOrMissing(root, ".code-map/index.json");
  if (stat && !stat.isFile()) throw new Error(".code-map/index.json must be a regular file");
  if (!stat || rebuild) return { handle: core().decode_previous(null), serialized: null };
  const source = await fs.readFile(join(root, ".code-map/index.json"), "utf8");
  let index;
  try { index = JSON.parse(source); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error("Invalid code-map cache. Run refresh --rebuild.", { cause: error });
  }
  return { handle: core().decode_previous(index), serialized: `${JSON.stringify(index)}\n` };
}

async function persist(root, index, previous) {
  const encoded = `${JSON.stringify(index)}\n`;
  if (encoded === previous) return;
  const directory = join(root, ".code-map");
  await fs.mkdir(directory, { recursive: true });
  await regularOrMissing(root, ".code-map/index.json");
  const temporary = join(directory, `${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, encoded, { flag: "wx" });
    await fs.rename(temporary, join(directory, "index.json"));
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

/** Refresh on-disk source snapshots in a Git worktree. No project build or source execution. */
export async function refreshIndex(root, options = {}) {
  const request = core().refresh_options(root, options);
  root = await gitRoot(request.root);
  const config = request.config ?? await loadConfig(root);
  const previous = await readCache(root, request.rebuild);
  const tool = await toolHash();
  const sources = new Map();
  const candidates = (await discoverFiles(root, config)).map(({ source, ...file }) => {
    if (source !== undefined) sources.set(file.path, source);
    return file;
  });
  const plan = core().prepare_refresh(previous.handle, candidates, tool, configHash(config));
  const results = [];
  for (const job of core().parse_jobs(plan)) {
    const parse = job.language === "gleam" ? parseGleam : job.language === "astro" ? parseAstro : parseJavaScript;
    results.push({ path: job.path, result: await parse({ path: job.path, source: sources.get(job.path) }) });
  }
  const index = core().finish_refresh(plan, results);
  await persist(root, index, previous.serialized);
  return index;
}
