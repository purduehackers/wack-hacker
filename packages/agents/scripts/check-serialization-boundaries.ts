/// <reference types="node" />

import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  InvalidInput,
  InvariantViolated,
  messageOf,
  serializeError,
  Transient,
} from "@repo/shared/errors";
import { panic, Result } from "@repo/shared/result";

import { analyzeSerializationBoundaries } from "./lib/serialization-boundaries.ts";
const packageRoot = fileURLToPath(
  URL.parse("..", import.meta.url) ?? panic("import.meta.url is not a valid file URL"),
);
const agentRoot = join(packageRoot, "agent");

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

const outcome = await Result.gen(async function* () {
  // `dot: true` keeps parity with the readdir walk this replaced, which
  // descended into every directory regardless of a leading dot.
  const paths = yield* Result.await(
    Result.tryPromise({
      try: () =>
        Array.fromAsync(
          new Bun.Glob("**/*.ts").scan({ cwd: agentRoot, absolute: true, dot: true }),
        ),
      catch: (cause) => new Transient({ operation: `scan ${agentRoot}`, detail: messageOf(cause) }),
    }),
  );
  paths.sort((left, right) => left.localeCompare(right));

  let integrationCatalogs = 0;
  let toolExecutors = 0;
  let stateInitializers = 0;
  const failures: string[] = [];
  for (const sourcePath of paths) {
    const displayPath = relative(packageRoot, sourcePath);
    const source = yield* Result.await(
      Result.tryPromise({
        try: () => Bun.file(sourcePath).text(),
        catch: (cause) =>
          new Transient({ operation: `read ${displayPath}`, detail: messageOf(cause) }),
      }),
    );
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
        failures.push(
          `${displayPath}: Eve defineTool approval must remain an inline async function`,
        );
      }
    }
  }
  if (failures.length > 0) {
    yield* new InvalidInput({ subject: "serialization boundaries", issues: failures });
  }
  // Derived from INTEGRATION_DOMAINS rather than written out, so adding a domain
  // is one edit in one place. A hardcoded count here drifts silently: the scan
  // would keep passing on the old number while the new domain went unchecked.
  const expectedCatalogs = INTEGRATION_DOMAINS.size;
  // `stateInitializers` is deliberately not asserted non-empty. It was, back when
  // the code subagent's workspace machine was the only `defineState` in the repo,
  // and removing that subagent turned a scan with nothing to find into a failure.
  // The two counts below still prove the scan looks at real files. Executors
  // come from every tool in the tree. The catalog count comes from
  // `INTEGRATION_DOMAINS`, so a new domain cannot slip past unscanned.
  if (toolExecutors === 0 || integrationCatalogs !== expectedCatalogs) {
    yield* new InvariantViolated({
      invariant: "serialization boundary scan coverage",
      detail:
        `found ${toolExecutors} tool executors, ${stateInitializers} state initializers, ` +
        `and ${integrationCatalogs} integration catalogs; expected non-empty executors ` +
        `and exactly ${expectedCatalogs} direct integration catalogs`,
    });
  }
  return Result.ok({ toolExecutors, stateInitializers, integrationCatalogs });
});

outcome.match({
  ok: ({ toolExecutors, stateInitializers, integrationCatalogs }) => {
    console.info(
      `serialization boundaries: ${toolExecutors} defineTool executors and ` +
        `${stateInitializers} defineState initializers guarded; ` +
        `${integrationCatalogs} integration catalogs remain inline`,
    );
  },
  err: (error) => {
    // Diagnostics keep their one-per-line shape so CI logs stay greppable.
    if (InvalidInput.is(error)) {
      console.error(`serialization boundary invariant failed:\n${error.issues.join("\n")}`);
    } else {
      const failure = serializeError(error);
      console.error(`check-serialization-boundaries failed: ${failure.tag}: ${failure.message}`);
    }
    process.exitCode = 1;
  },
});
