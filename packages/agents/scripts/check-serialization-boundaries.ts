/// <reference types="node" />

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeSerializationBoundaries } from "./serialization-invariant.ts";
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const agentRoot = join(packageRoot, "agent");

async function authoredTypeScriptFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await authoredTypeScriptFiles(candidate)));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(candidate);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

let toolExecutors = 0;
let stateInitializers = 0;
const failures: string[] = [];
for (const path of await authoredTypeScriptFiles(agentRoot)) {
  const displayPath = relative(packageRoot, path);
  const analysis = analyzeSerializationBoundaries(await readFile(path, "utf8"), displayPath);
  toolExecutors += analysis.toolExecutors;
  stateInitializers += analysis.stateInitializers;
  failures.push(
    ...analysis.diagnostics.map(
      (diagnostic) =>
        `${diagnostic.path}:${diagnostic.line}:${diagnostic.column}: ${diagnostic.message}`,
    ),
  );
}
if (failures.length > 0) {
  throw new Error(`serialization boundary invariant failed:\n${failures.join("\n")}`);
}
if (toolExecutors === 0 || stateInitializers === 0) {
  throw new Error(
    `serialization boundary scan found ${toolExecutors} tool executors and ` +
      `${stateInitializers} state initializers; expected both surfaces to be non-empty`,
  );
}
console.info(
  `serialization boundaries: ${toolExecutors} defineTool executors and ` +
    `${stateInitializers} defineState initializers guarded`,
);
