import { access } from "node:fs/promises";
import { embeddedToolHash } from "./tool-hash.mjs";

const entry = new URL("../build/dev/javascript/code_map/code_map/bridge.mjs", import.meta.url);
let missing;
let loaded;
try {
  if (!embeddedToolHash()) await access(entry);
  loaded = await import("../build/dev/javascript/code_map/code_map/bridge.mjs");
}
catch (error) {
  if (error.code !== "ENOENT") throw error;
  missing = new Error("Code map's compiled core is missing. Run pnpm run build in the code-map tool directory.", { cause: error });
}

export function core() {
  if (missing) throw missing;
  return loaded;
}
