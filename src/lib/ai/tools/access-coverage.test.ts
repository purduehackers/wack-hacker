import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  discordRESTClass,
  linearClientClass,
  messagePacket,
  notionClientClass,
  octokitClass,
  resendClass,
} from "@/lib/test/fixtures";

// Third-party SDK mocks — neutralize clients that our tool modules
// instantiate at import time so the real tool definitions load safely.
vi.mock("@linear/sdk", () => ({ LinearClient: linearClientClass() }));
vi.mock("octokit", () => ({ Octokit: octokitClass() }));
vi.mock("@octokit/auth-app", () => ({ createAppAuth: vi.fn(() => ({})) }));
vi.mock("@discordjs/rest", () => ({ REST: discordRESTClass() }));
vi.mock("@notionhq/client", () => ({ Client: notionClientClass() }));
vi.mock("resend", () => ({ Resend: resendClass() }));
vi.mock("@vercel/edge-config", () => ({
  createClient: vi.fn(() => ({ getAll: vi.fn().mockResolvedValue({}) })),
}));
vi.mock("workflow/api", () => ({
  start: vi.fn().mockResolvedValue({ runId: "run-test" }),
  getRun: vi.fn(() => ({ cancel: vi.fn().mockResolvedValue(undefined) })),
}));
vi.mock("@vercel/sandbox", () => ({
  Sandbox: class MockSandbox {},
}));

// Dynamic imports so the SDK mocks above are installed before any tool module
// (and its import-time client construction) loads.
const { AgentContext } = await import("@/lib/ai/context");
const { access, getAccessSpec } = await import("@/lib/ai/policy");
const { getToolMeta } = await import("./_shared/define-tool.ts");
const { SkillRegistry, createLoadSkillTool } = await import("@/lib/ai/skills");
const { createScheduleTask } = await import("./schedule/index.ts");

/** Explicit access declaration from either authoring path (factory or marker). */
function explicitSpec(value: unknown) {
  return getToolMeta(value)?.access ?? getAccessSpec(value);
}

const TOOLS_DIR = import.meta.dirname;

const RISKS = new Set(["read", "write", "destructive"]);

/**
 * The old destructive-coverage heuristic, demoted to a secondary lint: a tool
 * whose name screams destruction may not declare itself a harmless read.
 */
const DESTRUCTIVE_NAME_PATTERN =
  /^(delete|remove|archive|suspend|unsuspend|send|bulk|clear|merge|trigger|kick|ban|cancel|transfer|revoke)_/;

interface Violation {
  file: string;
  name: string;
  problem: string;
}

/** A tool built by the AI SDK's `tool()` always carries `inputSchema`. */
function isToolLike(v: unknown): v is object {
  return !!v && typeof v === "object" && "inputSchema" in v;
}

function checkExports(moduleExports: Record<string, unknown>, relPath: string): Violation[] {
  const out: Violation[] = [];
  for (const [name, value] of Object.entries(moduleExports)) {
    if (!isToolLike(value)) continue;
    const spec = explicitSpec(value);
    if (!spec || !RISKS.has(spec.risk)) {
      out.push({
        file: relPath,
        name,
        problem: "missing access() descriptor with a declared risk",
      });
      continue;
    }
    if (DESTRUCTIVE_NAME_PATTERN.test(name) && spec.risk === "read") {
      out.push({
        file: relPath,
        name,
        problem: 'destructive-looking name declared risk "read"',
      });
    }
  }
  return out;
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path, out);
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(path);
    }
  }
  return out;
}

function formatViolations(violations: Violation[]): string {
  return violations.map((v) => `  ${v.file} — ${v.name}: ${v.problem}`).join("\n");
}

describe("access declaration coverage", () => {
  it("every exported tool in tools/** carries access() with a declared risk", async () => {
    const files = await walk(TOOLS_DIR);
    const violations: Violation[] = [];
    for (const filePath of files) {
      const mod = (await import(filePath)) as Record<string, unknown>;
      violations.push(...checkExports(mod, relative(TOOLS_DIR, filePath)));
    }
    if (violations.length > 0) {
      throw new Error(
        `Tools must declare access({ risk, ... }) — enforcement is by declaration, not name:\n${formatViolations(violations)}`,
      );
    }
    expect(violations).toHaveLength(0);
  });
});

describe("factory-built tools (invisible to the static walk)", () => {
  it("createScheduleTask output carries a self-confirmed write spec", () => {
    const t = createScheduleTask(AgentContext.fromPacket(messagePacket("hello")));
    const spec = explicitSpec(t);
    expect(spec?.risk).toBe("write");
    expect(spec?.confirm).toBe("self");
  });

  it("createLoadSkillTool output carries a public read spec", () => {
    const t = createLoadSkillTool(new SkillRegistry({}), "admin");
    const spec = explicitSpec(t);
    expect(spec?.risk).toBe("read");
    expect(spec?.minRole).toBe("public");
  });
});

describe("checkExports (fixture proof that the scanner catches offenders)", () => {
  function unmarkedTool() {
    return { description: "x", inputSchema: {}, execute: async () => "y" };
  }

  it("reports a tool without an access marker", () => {
    const violations = checkExports({ bad_tool: unmarkedTool() }, "fixture.ts");
    expect(violations).toEqual([
      {
        file: "fixture.ts",
        name: "bad_tool",
        problem: "missing access() descriptor with a declared risk",
      },
    ]);
  });

  it("accepts a marked tool and ignores non-tool exports", () => {
    const marked = access({ risk: "read" }, unmarkedTool());
    const violations = checkExports(
      { list_things: marked, A_CONSTANT: "str", helper: () => 1 },
      "fixture.ts",
    );
    expect(violations).toHaveLength(0);
  });

  it("flags a destructive-looking name declared as read", () => {
    const sneaky = access({ risk: "read" }, unmarkedTool());
    const violations = checkExports({ delete_things: sneaky }, "fixture.ts");
    expect(violations).toEqual([
      {
        file: "fixture.ts",
        name: "delete_things",
        problem: 'destructive-looking name declared risk "read"',
      },
    ]);
  });
});
