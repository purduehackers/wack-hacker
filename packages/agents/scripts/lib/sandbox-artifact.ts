import { isDeepStrictEqual } from "node:util";
import { runInNewContext } from "node:vm";

import { serializeModelInputSchema } from "eve/tools";
import { bash } from "eve/tools/bash";
import { writeFile } from "eve/tools/write_file";
import { z } from "zod";

const compiledToolSchema = z.object({
  name: z.string(),
  behavior: z.object({
    handling: z.object({
      kind: z.literal("workflow-tool"),
      entryPoint: z.literal("execute"),
      workflowId: z.string(),
    }),
  }),
});

const nativeToolSchema = z.object({
  name: z.enum(["bash", "write_file"]),
  description: z.string(),
  behavior: z.json(),
  hasExecute: z.literal(true),
  hasModelOutputProjection: z.literal(false),
  requiresApproval: z.literal(false),
  modelInputSchema: z.json(),
});

function verifyNativeTool(value: unknown): void {
  const tool = nativeToolSchema.parse(value);
  const original = tool.name === "bash" ? bash : writeFile;
  if (
    tool.description !== original.description ||
    !isDeepStrictEqual(tool.behavior, { availability: [], shape: { suspend: "none" } }) ||
    !isDeepStrictEqual(tool.modelInputSchema, serializeModelInputSchema(original.inputSchema))
  )
    throw new Error(`Native ${tool.name} must retain its framework definition and inline handling`);
}

function inspectAgentTools(definitions: z.output<ReturnType<typeof z.json>>[]) {
  const workflows: { name: string; workflowId: string }[] = [];
  const mutations: unknown[] = [];
  const observedNames = new Set<string>();
  let openers = 0;
  for (const item of definitions) {
    const named = z
      .object({ name: z.literal(["bash", "write_file", "workspace_open"]) })
      .safeParse(item);
    if (!named.success) continue;
    if (named.data.name === "workspace_open") {
      openers += 1;
      continue;
    }
    mutations.push(item);
    observedNames.add(named.data.name);
    const tool = compiledToolSchema.safeParse(item);
    if (tool.success)
      workflows.push({
        name: tool.data.name,
        workflowId: tool.data.behavior.handling.workflowId,
      });
  }
  if (mutations.length !== 2 || observedNames.size !== 2)
    throw new Error("Each agent must expose exactly one bash and one write_file");
  if (workflows.length === 0 && openers === 0) {
    for (const candidate of mutations) verifyNativeTool(candidate);
    return { mode: "native" as const, workflows };
  }
  if (workflows.length === 2 && openers === 1) return { mode: "durable" as const, workflows };
  throw new Error("Each candidate agent needs checkpointed bash/write_file and workspace_open");
}

/** Validate each agent separately so a missing tool cannot be masked by another. */
export function sandboxManifestTools(tree: z.output<ReturnType<typeof z.json>>) {
  const workflows: { name: string; workflowId: string }[] = [];
  const modes: ("native" | "durable")[] = [];
  const visit = (value: z.output<ReturnType<typeof z.json>>): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = z.record(z.string(), z.json()).safeParse(value);
    if (!record.success) return;
    if (Array.isArray(record.data["tools"])) {
      const result = inspectAgentTools(record.data["tools"]);
      modes.push(result.mode);
      workflows.push(...result.workflows);
    }
    for (const item of Object.values(record.data)) visit(item);
  };
  visit(tree);
  if (modes.length !== 13 || new Set(modes).size !== 1)
    throw new Error("Root and all 12 specialists must select the same sandbox tool mode");
  return { mode: modes[0] ?? "native", workflows, agents: modes.length };
}

/** Inspect the emitted artifact, not the authored definitions before transforms. */
export function sandboxWorkflowArtifact(source: string) {
  const manifest = /const manifest = (\{[\s\S]*?\n\});/u.exec(source)?.[1];
  if (manifest === undefined) throw new Error("Compiled Eve manifest is missing");
  // Rolldown emits JS numeric literals, so the manifest is not always JSON.
  // This is the locally built literal in an empty VM, with no host capabilities.
  const tree = z.json().parse(runInNewContext(`(${manifest})`, {}, { timeout: 1000 }));
  const selection = sandboxManifestTools(tree);
  if (selection.mode === "native") return { ...selection, driver: "" };
  const start = source.indexOf("const workflowCode = Buffer.from(");
  const end = source.indexOf('].join(""), "base64")', start);
  if (start < 0 || end < start) throw new Error("Compiled Workflow driver is missing");
  const chunks = source.slice(start, end).match(/"[A-Za-z0-9+/=]+"/gu);
  if (chunks === null) throw new Error("Compiled Workflow driver encoding changed");
  const driver = Buffer.from(
    chunks.map((part) => z.string().parse(JSON.parse(part))).join(""),
    "base64",
  ).toString("utf8");
  return { ...selection, driver };
}
