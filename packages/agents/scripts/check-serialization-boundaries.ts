/// <reference types="node" />

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeSerializationBoundaries } from "./lib/serialization-boundaries.ts";
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

const INTEGRATION_DOMAINS = new Set([
  "cloudflare",
  "cms",
  "discord",
  "figma",
  "finance",
  "github",
  "linear",
  "notion",
  "outreach",
  "sentry",
  "shopping",
  "vercel",
]);
let integrationCatalogs = 0;
let toolExecutors = 0;
let stateInitializers = 0;
const failures: string[] = [];
for (const path of await authoredTypeScriptFiles(agentRoot)) {
  const displayPath = relative(packageRoot, path);
  const source = await readFile(path, "utf8");
  const analysis = analyzeSerializationBoundaries(source, displayPath);
  toolExecutors += analysis.toolExecutors;
  stateInitializers += analysis.stateInitializers;
  failures.push(
    ...analysis.diagnostics.map(
      (diagnostic) =>
        `${diagnostic.path}:${diagnostic.line}:${diagnostic.column}: ${diagnostic.message}`,
    ),
  );
  const catalogMatch = displayPath.match(/^agent\/subagents\/([^/]+)\/tools\/catalog\.ts$/u);
  if (catalogMatch !== null && INTEGRATION_DOMAINS.has(catalogMatch[1] ?? "")) {
    integrationCatalogs += 1;
    if (analysis.toolExecutors !== 1) {
      failures.push(
        `${displayPath}: each integration catalog must directly author one inline Eve defineTool executor`,
      );
    }
    if (!/\bapproval\s*:\s*async\s*\([^)]*\)\s*=>/u.test(source)) {
      failures.push(`${displayPath}: Eve defineTool approval must remain an inline async function`);
    }
  }
}
if (failures.length > 0) {
  throw new Error(`serialization boundary invariant failed:\n${failures.join("\n")}`);
}
// Derived from INTEGRATION_DOMAINS rather than written out, so adding a domain
// is one edit in one place. A hardcoded count here drifts silently: the scan
// would keep passing on the old number while the new domain went unchecked.
const expectedCatalogs = INTEGRATION_DOMAINS.size;
// `stateInitializers` is deliberately not asserted non-empty. It was, back when
// the code subagent's workspace machine was the only `defineState` in the repo,
// and removing that subagent turned a scan with nothing to find into a failure.
// The two counts below still prove the scan is looking at real files: executors
// come from every tool in the tree, and the catalog count is derived from
// `INTEGRATION_DOMAINS` so a new domain cannot slip past unscanned.
if (toolExecutors === 0 || integrationCatalogs !== expectedCatalogs) {
  throw new Error(
    `serialization boundary scan found ${toolExecutors} tool executors, ` +
      `${stateInitializers} state initializers, and ${integrationCatalogs} integration catalogs; ` +
      `expected non-empty executors and exactly ${expectedCatalogs} direct integration catalogs`,
  );
}
console.info(
  `serialization boundaries: ${toolExecutors} defineTool executors and ` +
    `${stateInitializers} defineState initializers guarded; ` +
    `${integrationCatalogs} integration catalogs remain inline`,
);
