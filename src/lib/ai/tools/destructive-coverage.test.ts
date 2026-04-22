import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TOOLS_DIR = join(import.meta.dirname);

const DESTRUCTIVE_NAME_PATTERN =
  /^(delete|remove|archive|suspend|unsuspend|send|bulk|clear|merge|trigger|kick|ban|cancel|transfer|revoke)_/;

const SKIP_FILES = new Set(["index.ts", "client.ts", "constants.ts"]);

const EXPORT_PATTERN = /^export\s+const\s+(\w+)\s*=\s*(.+)$/;

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path, out);
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !SKIP_FILES.has(entry.name)
    ) {
      out.push(path);
    }
  }
  return out;
}

interface Violation {
  file: string;
  line: number;
  name: string;
  snippet: string;
}

function isApprovedExport(lines: readonly string[], exportIdx: number): boolean {
  if (lines[exportIdx].includes("approval(")) return true;
  // Multiline admin wrap: check the first non-blank line after the export.
  const lookahead = lines.slice(exportIdx + 1, exportIdx + 4);
  const nextContent = lookahead.find((l) => l.trim().length > 0);
  return nextContent !== undefined && nextContent.trim().startsWith("approval(");
}

function scanFile(sourceText: string, relPath: string): Violation[] {
  const out: Violation[] = [];
  const lines = sourceText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(EXPORT_PATTERN);
    if (!match) continue;
    const name = match[1];
    if (!DESTRUCTIVE_NAME_PATTERN.test(name)) continue;
    if (isApprovedExport(lines, i)) continue;
    out.push({ file: relPath, line: i + 1, name, snippet: lines[i].trim() });
  }
  return out;
}

async function findViolations(): Promise<Violation[]> {
  const discoveredPaths = await walk(TOOLS_DIR);
  const violations: Violation[] = [];
  for (const target of discoveredPaths) {
    const source = await readFile(target, "utf8");
    const relPath = target.slice(target.indexOf("/src/") + 1);
    violations.push(...scanFile(source, relPath));
  }
  return violations;
}

describe("destructive tool approval coverage", () => {
  it("every tool whose name matches the destructive pattern is wrapped with approval()", async () => {
    const violations = await findViolations();
    if (violations.length > 0) {
      const details = violations
        .map((v) => `  ${v.file}:${v.line} — ${v.name}  (${v.snippet})`)
        .join("\n");
      throw new Error(
        `Tools with destructive-looking names must be wrapped with approval():\n${details}`,
      );
    }
    expect(violations).toHaveLength(0);
  });
});
