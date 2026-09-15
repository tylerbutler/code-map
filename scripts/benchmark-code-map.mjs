#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import { closeSync, openSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { spawn, spawnSync } from "node:child_process";

const script = fileURLToPath(import.meta.url);
const toolRoot = resolve(dirname(script), "..");
const codeMapCli = resolve(toolRoot, "cli.mjs");

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    prompt: { type: "string" },
    output: { type: "string", default: ".tmp/code-map-benchmark" },
    runs: { type: "string", default: "5" },
    model: { type: "string", default: "gpt-5.6-sol" },
    effort: { type: "string", default: "medium" },
    cache: { type: "string", default: "warm" },
    variant: { type: "string" },
    help: { type: "boolean" },
  },
  strict: true,
});

if (values.help) {
  console.log(`Usage:
  mise run benchmark -- --root <repo> --prompt <file> [options]

Options:
  --runs <n>        Runs per variant (default: 5)
  --model <model>   Copilot model (default: gpt-5.6-sol)
  --effort <level>  Reasoning effort (default: medium)
  --cache warm|cold Code-map cache state (default: warm)
  --output <dir>    Result directory (default: .tmp/code-map-benchmark)`);
  process.exit(0);
}

if (values.variant) {
  await runVariant(values.variant);
} else {
  await runBenchmark();
}

async function runBenchmark() {
  if (!values.root || !values.prompt) fail("--root and --prompt are required");
  if (!/^[1-9]\d*$/.test(values.runs)) fail("--runs must be a positive integer");
  if (!["warm", "cold"].includes(values.cache)) fail("--cache must be warm or cold");

  const root = resolve(values.root);
  const prompt = resolve(values.prompt);
  const output = resolve(values.output);
  await Promise.all([access(root), access(prompt), access(codeMapCli), mkdir(output, { recursive: true })]);

  if (values.cache === "warm") {
    const warmed = spawnSync(process.execPath, [codeMapCli, "--root", root, "overview"], {
      stdio: "inherit",
    });
    if (warmed.status !== 0 && warmed.status !== 2) process.exit(warmed.status ?? 1);
  }

  const environment = {
    ...process.env,
    CODE_MAP_BENCH_ROOT: root,
    CODE_MAP_BENCH_PROMPT: prompt,
    CODE_MAP_BENCH_OUTPUT: output,
    CODE_MAP_BENCH_MODEL: values.model,
    CODE_MAP_BENCH_EFFORT: values.effort,
    CODE_MAP_BENCH_CACHE: values.cache,
  };
  const command = (variant) =>
    `${shellQuote(process.execPath)} ${shellQuote(script)} --variant ${variant}`;
  const result = spawnSync("hyperfine", [
    "--runs", values.runs,
    "--warmup", "0",
    "--export-json", resolve(output, `timing-${values.cache}.json`),
    "--command-name", "without code-map", command("control"),
    "--command-name", "with code-map", command("code-map"),
  ], { env: environment, stdio: "inherit" });

  process.exit(result.status ?? 1);
}

async function runVariant(variant) {
  if (!["control", "code-map"].includes(variant)) fail("invalid benchmark variant");
  const root = process.env.CODE_MAP_BENCH_ROOT;
  const promptFile = process.env.CODE_MAP_BENCH_PROMPT;
  const output = process.env.CODE_MAP_BENCH_OUTPUT;
  if (!root || !promptFile || !output) fail("benchmark environment is incomplete");

  if (variant === "code-map" && process.env.CODE_MAP_BENCH_CACHE === "cold") {
    await rm(resolve(root, ".code-map"), { recursive: true, force: true });
  }

  const task = await readFile(promptFile, "utf8");
  const guidance = variant === "code-map"
    ? `Use code-map before reading source. Start with:
${process.execPath} ${codeMapCli} --root ${root} overview
Then use its find, files, and file commands to narrow the source you read.`
    : "Do not use code-map. Use the normal repository search and file-reading tools.";
  const prompt = `${guidance}

This is a read-only benchmark. Do not modify files.

Task:
${task}`;
  const id = randomUUID();
  const usage = resolve(output, `${variant}-${id}-usage.json`);
  const events = resolve(output, `${variant}-${id}-events.jsonl`);
  const eventFd = openSync(events, "wx");
  const child = spawn("copilot", [
    "-C", root,
    "-p", prompt,
    "--session-id", id,
    "--model", process.env.CODE_MAP_BENCH_MODEL,
    "--effort", process.env.CODE_MAP_BENCH_EFFORT,
    "--allow-all-tools",
    "--no-ask-user",
    "--no-remote",
    "--output-format", "json",
    "--usage-output-file", usage,
  ], { stdio: ["ignore", eventFd, "inherit"] });
  closeSync(eventFd);
  const status = await new Promise((resolveStatus, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolveStatus(code ?? 1));
  });
  process.exit(status);
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}
