import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { hashToolFiles } from "../lib/tool-hash.mjs";

const targets = new Set([
  "bun-darwin-arm64",
  "bun-darwin-x64",
  "bun-linux-arm64",
  "bun-linux-x64",
  "bun-windows-x64",
]);
const { values } = parseArgs({
  options: {
    target: { type: "string" },
    outfile: { type: "string" },
  },
  strict: true,
});
if (values.target && !targets.has(values.target)) {
  throw new Error(`Unsupported executable target: ${values.target}`);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const outputName = values.outfile ?? "dist/code-map";
if (isAbsolute(outputName)) throw new Error("Executable output must be relative to the repository root");
const output = resolve(root, outputName);
const outputPath = relative(root, output);
if (!outputPath || outputPath === ".." || outputPath.startsWith(`..${sep}`)) {
  throw new Error("Executable output must be inside the repository");
}

const hash = await hashToolFiles(root);
await mkdir(dirname(output), { recursive: true });

const result = spawnSync(process.execPath, [
  "build",
  "--compile",
  ...(values.target ? [`--target=${values.target}`] : []),
  "entry.mjs",
  `--define=CODE_MAP_TOOL_HASH=${JSON.stringify(hash)}`,
  "--outfile",
  output,
], { cwd: root, stdio: "inherit" });

if (result.error) throw result.error;
process.exitCode = result.status;
