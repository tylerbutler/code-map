import { promises as fs } from "node:fs";
import astroWasm from "@astrojs/compiler/astro.wasm" with { type: "file" };
import { main } from "./cli.mjs";

const readFile = fs.readFile.bind(fs);
fs.readFile = async (path, ...args) => String(path).replaceAll("\\", "/").endsWith("/$bunfs/astro.wasm")
  ? Buffer.from(await Bun.file(astroWasm).arrayBuffer())
  : readFile(path, ...args);

process.exitCode = await main(process.argv.slice(2));
