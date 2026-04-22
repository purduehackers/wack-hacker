import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TOOLS_DIR = join(import.meta.dirname);

const DESTRUCTIVE_NAME_PATTERN =
  /^(delete|remove|archive|suspend|unsuspend|send|bulk|clear|merge|trigger|kick|ban|cancel|transfer|revoke)_/;

const SKIP_FILES = new Set(["index.ts", "client.ts", "constants.ts"]);

const EXPORT_PATTERN = /^export\s+const\s+(\w+)\s*=/;

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

function previousNonBlankLine(allLines: string[], index: number): string | null {
  for (let i = index - 1; i >= 0; i--) {
    const trimmed = allLines[i].trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

interface Violation {
  file: string;
  line: number;
  name: string;
  previous: string | null;
}

async function findViolations(): Promise<Violation[]> {
  const discoveredPaths = await walk(TOOLS_DIR);
  const violations: Violation[] = [];

  for (const target of discoveredPaths) {
    const source = await readFile(target, "utf8");
    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(EXPORT_PATTERN);
      if (!match) continue;
      const name = match[1];
      if (!DESTRUCTIVE_NAME_PATTERN.test(name)) continue;
      const prev = previousNonBlankLine(lines, i);
      if (prev !== "// destructive") {
        violations.push({
          file: target.slice(target.indexOf("/src/") + 1),
          line: i + 1,
          name,
          previous: prev,
        });
      }
    }
  }

  return violations;
}

describe("destructive tool tagging coverage", () => {
  it("every tool whose name matches the destructive pattern has `// destructive` above it", async () => {
    const violations = await findViolations();
    if (violations.length > 0) {
      const details = violations
        .map((v) => `  ${v.file}:${v.line} — ${v.name} (prev line: ${JSON.stringify(v.previous)})`)
        .join("\n");
      throw new Error(
        `Tools with destructive-looking names must have \`// destructive\` on the preceding line:\n${details}`,
      );
    }
    expect(violations).toHaveLength(0);
  });
});
