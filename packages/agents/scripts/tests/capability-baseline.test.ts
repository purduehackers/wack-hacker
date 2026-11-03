import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkMigrationParity, parseMigrationBaseline } from "../lib/capability-baseline.ts";
import { capabilityId, checkToolLayout } from "../lib/capability-surface.ts";

const baseline = parseMigrationBaseline({
  version: 1,
  sourceCommit: "a".repeat(40),
  domains: [
    {
      name: "discord",
      baseTools: ["discord__get_server_info"],
      skills: [{ id: "discord__messages", tools: ["discord__send_message"] }],
    },
  ],
});

function currentDomain() {
  return {
    name: "discord",
    baseTools: ["discord__get_server_info"],
    tools: [{ id: "discord__get_server_info" }, { id: "discord__send_message" }],
    skills: [{ id: "discord__messages", tools: ["discord__send_message"] }],
  };
}

describe("migration parity", () => {
  test("allows additional capabilities without rewriting the original baseline", () => {
    const domain = currentDomain();
    domain.tools.push({ id: "discord__new_operation" });
    domain.skills.push({ id: "discord__new_skill", tools: ["discord__new_operation"] });
    expect(() => checkMigrationParity([domain], baseline)).not.toThrow();
  });

  test("rejects a removed domain, tool, or skill even when current layout is internally valid", () => {
    expect(() => checkMigrationParity([], baseline)).toThrow("missing domain discord");
    expect(() => checkMigrationParity([{ ...currentDomain(), tools: [] }], baseline)).toThrow(
      "missing tool discord__send_message",
    );
    expect(() => checkMigrationParity([{ ...currentDomain(), skills: [] }], baseline)).toThrow(
      "missing skill discord__messages",
    );
  });

  test("preserves base and skill access paths when all tool identities still exist", () => {
    expect(() => checkMigrationParity([{ ...currentDomain(), baseTools: [] }], baseline)).toThrow(
      "base discovery no longer includes discord__get_server_info",
    );
    expect(() =>
      checkMigrationParity(
        [
          {
            ...currentDomain(),
            skills: [{ id: "discord__messages", tools: [] }],
          },
        ],
        baseline,
      ),
    ).toThrow("discord__messages no longer reaches discord__send_message");
  });

  test("rejects ambiguous, duplicate, or cross-domain baseline identities", () => {
    expect(() => capabilityId("a__b", "c")).toThrow("Ambiguous capability identity");
    expect(() => capabilityId("a", "b__c")).toThrow("Ambiguous capability identity");
    expect(() => capabilityId("discord", "../messages")).toThrow("Ambiguous capability identity");
    expect(() => capabilityId("eve", "search")).toThrow("Unsupported capability identity");
    expect(capabilityId("a", "b".repeat(61))).toHaveLength(64);
    expect(() => capabilityId("a", "b".repeat(62))).toThrow("Unsupported capability identity");
    expect(() =>
      parseMigrationBaseline({ ...baseline, domains: [...baseline.domains, ...baseline.domains] }),
    ).toThrow("baseline domains contains duplicates");
    expect(() =>
      parseMigrationBaseline({
        ...baseline,
        domains: [
          {
            name: "discord",
            baseTools: ["github__send_message"],
            skills: [],
          },
        ],
      }),
    ).toThrow("is not an identity in discord");
    expect(() =>
      parseMigrationBaseline({
        ...baseline,
        domains: [
          {
            name: "discord",
            baseTools: [],
            skills: [
              { id: "discord__messages", tools: [] },
              { id: "discord__messages", tools: [] },
            ],
          },
        ],
      }),
    ).toThrow("baseline skills contains duplicates");
  });
});

const temporaryDirectories: string[] = [];
afterEach(async () => {
  for (const path of temporaryDirectories.splice(0))
    await rm(path, { recursive: true, force: true });
});

test("source provenance rejects duplicate tool files even when both bundles claim the tool", async () => {
  const root = await mkdtemp(join(tmpdir(), "wack-capability-layout-"));
  temporaryDirectories.push(root);
  await Bun.write(join(root, "lib/tool_defs/base/read.ts"), "export const read = {};\n");
  await Bun.write(join(root, "lib/tool_defs/extra/read.ts"), "export const read = {};\n");
  await checkToolLayout(
    "fixture",
    root,
    [{ name: "extra", minRole: "organizer", tools: ["read"], doc: "fixture" }],
    ["read"],
    ["read"],
  ).then(
    () => {
      throw new Error("Expected duplicate tool files to fail validation");
    },
    (cause: unknown) =>
      expect(cause).toMatchObject({
        message: expect.stringContaining("read has multiple source files"),
      }),
  );
});
