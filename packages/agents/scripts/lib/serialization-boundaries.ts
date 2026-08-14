/**
 * @fileoverview Static counterpart to `serialization.ts`.
 *
 * `serialization.ts` rejects a non-JSON value at runtime, but only if it is
 * actually reached. This module proves, by reading the source, that execution
 * reaches it: every `defineTool` executor must return through
 * `guardToolExecution`, and every `defineState` initializer through
 * `assertStateValue`. This analysis refuses namespace imports of `eve/tools` /
 * `eve/context` outright, because a call behind one would be invisible to the
 * patterns below. The analysis is textual, so it bans the indirection it
 * cannot follow rather than pretending to see through it.
 *
 * Pure and I/O-free. `scripts/check-serialization-boundaries.ts` walks `agent/**`
 * and feeds each file in.
 */

interface SerializationBoundaryDiagnostic {
  readonly column: number;
  readonly line: number;
  readonly message: string;
  readonly path: string;
}

interface SerializationBoundaryAnalysis {
  readonly diagnostics: readonly SerializationBoundaryDiagnostic[];
  readonly stateInitializers: number;
  readonly toolExecutors: number;
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function importedBindings(source: string, moduleName: string, symbol: string): Set<string> {
  const bindings = new Set<string>();
  const pattern = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*["']${escapePattern(moduleName)}["']`,
    "gu",
  );
  for (const match of source.matchAll(pattern)) {
    for (const entry of (match[1] ?? "").split(",")) {
      const parts = entry
        .trim()
        .replace(/^type\s+/u, "")
        .split(/\s+as\s+/u);
      if (parts[0] === symbol) bindings.add(parts[1] ?? parts[0]);
    }
  }
  return bindings;
}

function occurrences(source: string, pattern: RegExp): number[] {
  return [...source.matchAll(pattern)].flatMap((match) =>
    match.index === undefined ? [] : [match.index],
  );
}

function callPositions(source: string, symbols: ReadonlySet<string>, generic = false): number[] {
  return [...symbols].flatMap((importedName) =>
    occurrences(
      source,
      new RegExp(
        `\\b${escapePattern(importedName)}${generic ? "(?:<[^;()]+>)?" : ""}\\s*\\(`,
        "gu",
      ),
    ),
  );
}

function executePositions(source: string): number[] {
  return [
    ...occurrences(source, /\bexecute\s*:\s*(?:async\s*)?\([^)]*\)\s*=>/gu),
    ...occurrences(source, /\basync\s+execute\s*\([^)]*\)\s*\{/gu),
  ].sort((left, right) => left - right);
}

interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

function lineAndColumn(source: string, index: number): SourcePosition {
  const before = source.slice(0, index);
  const lines = before.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function guardPattern(bindings: ReadonlySet<string>): string {
  return [...bindings].map(escapePattern).join("|");
}

/**
 * Scans one file's source for tool and state guard violations.
 *
 * The counts in the result let the caller prove the scan saw real
 * definitions. An empty diagnostics list from a misparsed tree then cannot
 * pass as a clean one.
 */
export function analyzeSerializationBoundaries(
  source: string,
  path = "source.ts",
): SerializationBoundaryAnalysis {
  const defineTools = importedBindings(source, "eve/tools", "defineTool");
  const defineStates = importedBindings(source, "eve/context", "defineState");
  const toolGuards = importedBindings(
    source,
    source.includes('from "../../agent/lib/serialization.ts"') ? "./serialization.ts" : "",
    "guardToolExecution",
  );
  for (const match of source.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*["']([^"']*\/lib\/serialization\.ts)["']/gu,
  )) {
    const moduleName = match[2];
    if (moduleName !== undefined) {
      for (const binding of importedBindings(source, moduleName, "guardToolExecution")) {
        toolGuards.add(binding);
      }
    }
  }
  const stateGuards = new Set<string>();
  for (const match of source.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*["']([^"']*(?:\/lib\/serialization|\.\/serialization)\.ts)["']/gu,
  )) {
    const moduleName = match[2];
    if (moduleName !== undefined) {
      for (const binding of importedBindings(source, moduleName, "assertStateValue")) {
        stateGuards.add(binding);
      }
    }
  }

  const diagnostics: SerializationBoundaryDiagnostic[] = [];
  const report = (index: number, message: string): void => {
    diagnostics.push({ path, ...lineAndColumn(source, index), message });
  };
  for (const match of source.matchAll(
    /import\s*\*\s*as\s+\w+\s*from\s*["']eve\/(?:tools|context)["']/gu,
  )) {
    report(match.index, "namespace imports can bypass defineTool/defineState boundary analysis");
  }

  const toolCalls = callPositions(source, defineTools);
  const executors = defineTools.size === 0 ? [] : executePositions(source);
  if (toolCalls.length !== executors.length) {
    report(
      toolCalls[0] ?? 0,
      `found ${toolCalls.length} defineTool calls but ${executors.length} inline execute functions`,
    );
  }
  const toolGuardPattern = guardPattern(toolGuards);
  for (const position of executors) {
    const declaration = source.slice(position, position + 600);
    const signature =
      /^(?:execute\s*:\s*(?:async\s*)?\([^)]*\)\s*=>|async\s+execute\s*\([^)]*\)\s*\{)/u;
    const rest = declaration.replace(signature, "");
    const guarded =
      toolGuardPattern !== "" &&
      new RegExp(
        `^\\s*(?:\\{\\s*)?(?:return\\s+)?(?:await\\s+)?(?:${toolGuardPattern})\\s*\\(`,
        "u",
      ).test(rest);
    if (!guarded) {
      report(position, "defineTool execute must have one outer return through guardToolExecution");
    }
  }

  const stateCalls = callPositions(source, defineStates, true);
  const stateGuardPattern = guardPattern(stateGuards);
  for (const position of stateCalls) {
    const declaration = source.slice(position, position + 800);
    const guarded =
      stateGuardPattern !== "" &&
      new RegExp(`=>\\s*(?:\\{\\s*return\\s+)?(?:${stateGuardPattern})\\s*\\(`, "u").test(
        declaration,
      );
    if (!guarded) {
      report(position, "defineState initializer must return directly through assertStateValue");
    }
  }

  return {
    diagnostics,
    toolExecutors: toolCalls.length,
    stateInitializers: stateCalls.length,
  };
}
