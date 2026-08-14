/// <reference types="node" />

/**
 * @fileoverview Cross-file invariants for the agent's capability surface.
 *
 * Every check here is a relationship *between* files, which is exactly what a
 * code review cannot see. Each hunk reads as correct on its own and the defect
 * only exists in the pairing. A skill listing a tool the registry no longer
 * defines, or a registry tool no skill can reach, is a silent runtime failure.
 * The tool either fails to resolve or is undiscoverable by any role.
 *
 * Deriving the surface also imports every registry, so a top-level throw in any
 * of them fails here rather than at boot.
 *
 * This deliberately does NOT snapshot the surface. A `minRole` change is one
 * line in a registry and shows up in the diff on its own. Pinning a generated
 * copy of it only adds a second file to update. It also invites regenerating
 * past the very change the pin was meant to surface.
 */

import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { UserRole } from "@repo/shared/discord";
import {
  InvalidInput,
  InvariantViolated,
  NotFound,
  Transient,
  messageOf,
  serializeError,
} from "@repo/shared/errors";
import { Result, panic } from "better-result";
import { z } from "zod";

import { parseSkillDoc } from "../agent/lib/policy/skill-catalog.ts";
import { normalizeReadme, renderSubagentReadme, type SkillDoc } from "./lib/subagent-readme.ts";

const packageRoot = fileURLToPath(
  URL.parse("..", import.meta.url) ?? panic("import.meta.url is always a valid URL base"),
);
const agentRoot = join(packageRoot, "agent");

/**
 * A skill as declared today: policy here, prose in `lib/skill_defs/<name>.md`.
 *
 * Converted domains export these as `<DOMAIN>_SKILLS` from `lib/registry.ts`
 * alongside the tools. The rest still export `<DOMAIN>_SKILL_DEFINITIONS` from
 * `skills/catalog.ts` until their tools are split. The shape is the same either
 * way — only the module differs.
 */
const registrySkillSchema = z.strictObject({
  name: z.string().trim().min(1),
  minRole: z.enum(UserRole),
  tools: z.array(z.string()),
  doc: z.string().trim().min(1),
});

const accessSchema = z.looseObject({
  risk: z.string(),
  minRole: z.enum(UserRole).optional(),
});
const toolSpecSchema = z.looseObject({
  description: z.string().trim().min(1),
  access: accessSchema,
});

interface DomainSurface {
  readonly name: string;
  readonly toolCount: number;
  readonly skillCount: number;
  readonly converted: boolean;
}

/** Every way a capability check can fail, so signatures stay readable. */
type SurfaceError = InvalidInput | InvariantViolated | NotFound | Transient;

/** Duplicate entries in a capability list are always a declaration mistake. */
function checkUnique(label: string, entries: readonly string[]): Result<void, InvalidInput> {
  const repeated = entries.filter((entry, index) => entries.indexOf(entry) !== index);
  if (repeated.length > 0) {
    return Result.err(
      new InvalidInput({ subject: label, issues: [`contains duplicates: ${repeated.join(",")}`] }),
    );
  }
  return Result.ok(undefined);
}

function constantName(domain: string): string {
  return domain.toUpperCase().replaceAll("-", "_");
}

async function fileExists(path: string): Promise<boolean> {
  return Result.isOk(await Result.tryPromise(() => access(path)));
}

/** Converts a schema failure on a registry export into one `InvalidInput`. */
function exportError(subject: string, error: z.ZodError): InvalidInput {
  return new InvalidInput({ subject, issues: [z.prettifyError(error)] });
}

/**
 * Imports one capability module. A registry that throws at import time is a
 * defect this script exists to catch before boot does.
 */
function importModule(domain: string, root: string, modulePath: string) {
  return Result.tryPromise({
    try: () => import(pathToFileURL(join(root, modulePath)).href),
    catch: (cause) =>
      new InvariantViolated({
        invariant: `${domain}/${modulePath} imports cleanly`,
        detail: messageOf(cause),
      }),
  });
}

/** A subagent directory is only complete with both an agent and its instructions. */
async function subagentNames(): Promise<Result<string[], SurfaceError>> {
  return Result.gen(async function* () {
    const subagentsRoot = join(agentRoot, "subagents");
    const entries = yield* Result.await(
      Result.tryPromise({
        try: () => readdir(subagentsRoot, { withFileTypes: true }),
        catch: (cause) =>
          new Transient({ operation: `list ${subagentsRoot}`, detail: messageOf(cause) }),
      }),
    );
    const discoveredSubagents = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
    for (const subagent of discoveredSubagents) {
      for (const required of ["agent.ts", "instructions.md"]) {
        const path = join(subagentsRoot, subagent, required);
        if (!(await fileExists(path))) {
          return Result.err(new NotFound({ kind: "required subagent file", id: path }));
        }
      }
    }
    return Result.ok(discoveredSubagents);
  });
}

/** Skills and a tool registry are meaningless apart: one resolves against the other. */
async function integrationDomains(
  subagents: readonly string[],
): Promise<Result<string[], InvalidInput>> {
  const domains: string[] = [];
  for (const name of subagents) {
    const root = join(agentRoot, "subagents", name);
    const converted = await fileExists(join(root, "lib/registry.ts"));
    const hasSkills = converted || (await fileExists(join(root, "skills/catalog.ts")));
    const hasTools = converted || (await fileExists(join(root, "lib/tool-registry.ts")));
    if (hasSkills !== hasTools) {
      return Result.err(
        new InvalidInput({
          subject: `${name} capability surface`,
          issues: ["must declare both a native skill catalog and tool registry"],
        }),
      );
    }
    if (hasSkills) domains.push(name);
  }
  return Result.ok(domains);
}

/** The registry must claim every `.md` in `lib/skill_defs/`, and vice versa. */
async function skillDocNames(root: string): Promise<Result<string[], Transient>> {
  return Result.gen(async function* () {
    const dir = join(root, "lib/skill_defs");
    if (!(await fileExists(dir))) return Result.ok([]);
    const entries = yield* Result.await(
      Result.tryPromise({
        try: () => readdir(dir),
        catch: (cause) => new Transient({ operation: `list ${dir}`, detail: messageOf(cause) }),
      }),
    );
    return Result.ok(
      entries
        .filter((entry) => entry.endsWith(".md"))
        .map((entry) => entry.slice(0, -3))
        .sort((left, right) => left.localeCompare(right)),
    );
  });
}

async function checkDomain(domain: string): Promise<Result<DomainSurface, SurfaceError>> {
  return Result.gen(async function* () {
    const root = join(agentRoot, "subagents", domain);
    const constant = constantName(domain);
    const converted = await fileExists(join(root, "lib/registry.ts"));

    // A dynamic import always resolves to a module namespace object. Registry
    // modules export functions and schemas, so no record schema can name their
    // shape. The checks below parse each export against its own concrete schema.
    const modulePath = converted ? "lib/registry.ts" : "skills/catalog.ts";
    const skillModule = yield* Result.await(importModule(domain, root, modulePath));
    const registryModule = converted
      ? skillModule
      : yield* Result.await(importModule(domain, root, "lib/tool-registry.ts"));

    const baseToolsParsed = z
      .array(z.string())
      .safeParse(skillModule[`${constant}_BASE_TOOL_NAMES`]);
    if (!baseToolsParsed.success) {
      return Result.err(exportError(`${constant}_BASE_TOOL_NAMES`, baseToolsParsed.error));
    }
    const baseTools = baseToolsParsed.data;

    const toolSpecsParsed = z
      .record(z.string(), toolSpecSchema)
      .safeParse(registryModule[`${constant}_TOOLS`]);
    if (!toolSpecsParsed.success) {
      return Result.err(exportError(`${constant}_TOOLS`, toolSpecsParsed.error));
    }
    const toolSpecs = toolSpecsParsed.data;
    const tools = Object.keys(toolSpecs);

    const skillsExport = converted ? `${constant}_SKILLS` : `${constant}_SKILL_DEFINITIONS`;
    const skillsParsed = z.array(registrySkillSchema).safeParse(skillModule[skillsExport]);
    if (!skillsParsed.success) {
      return Result.err(exportError(skillsExport, skillsParsed.error));
    }
    const skills = skillsParsed.data;

    yield* checkUnique(`${domain} base tools`, baseTools);
    yield* checkUnique(
      `${domain} skill names`,
      skills.map((entry) => entry.name),
    );
    yield* checkUnique(`${domain} tools`, tools);

    // Every referenced tool must exist…
    const knownTools = new Set(tools);
    for (const [label, toolNames] of [
      ["base", baseTools],
      ...skills.map((entry) => [entry.name, entry.tools] as const),
    ] as const) {
      yield* checkUnique(`${domain}/${label} tools`, toolNames);
      const unknown = toolNames.filter((name) => !knownTools.has(name));
      if (unknown.length > 0) {
        return Result.err(
          new InvalidInput({
            subject: `${domain}/${label}`,
            issues: [`references unknown tools: ${unknown.join(",")}`],
          }),
        );
      }
    }

    // …and every defined tool must be reachable by some role.
    const coveredTools = new Set([...baseTools, ...skills.flatMap((entry) => entry.tools)]);
    const uncovered = tools.filter((name) => !coveredTools.has(name));
    if (uncovered.length > 0) {
      return Result.err(
        new InvalidInput({
          subject: `${domain} registry`,
          issues: [`tools lack skill/base coverage: ${uncovered.join(",")}`],
        }),
      );
    }

    // Prose lives in files for every domain now, so these run everywhere. The
    // README check is the only part that waits for `lib/registry.ts`.
    yield* Result.await(checkSkillDocs(domain, root, skills));
    yield* Result.await(checkToolLayout(domain, root, skills, baseTools, tools));
    if (converted) yield* Result.await(checkReadme(domain, root, skills, baseTools, toolSpecs));

    return Result.ok({
      name: domain,
      toolCount: tools.length,
      skillCount: skills.length,
      converted,
    });
  });
}

type RegistrySkill = z.output<typeof registrySkillSchema>;
type ToolSpecs =
  z.output<typeof toolSpecSchema> extends infer Spec ? Readonly<Record<string, Spec>> : never;

/** The invariants that only exist once prose and policy live in separate files. */
/**
 * `lib/tool_defs/` must mirror the skill list: one directory per skill plus
 * `base`, one file per tool, each file in the bundle whose skill lists it.
 *
 * Nothing else enforces this. The registry compiles whatever it imports. An
 * orphan file, a tool filed under the wrong skill, or a directory named after a
 * skill that no longer exists all ship silently. That is the exact drift the
 * split set out to remove.
 */
async function checkToolLayout(
  domain: string,
  root: string,
  skills: readonly RegistrySkill[],
  baseTools: readonly string[],
  toolNames: readonly string[],
): Promise<Result<void, InvalidInput | Transient>> {
  return Result.gen(async function* () {
    const defsRoot = join(root, "lib/tool_defs");
    if (!(await fileExists(defsRoot))) return Result.ok(undefined);

    const expectedBundles = new Set(skills.map((entry) => entry.name));
    if (baseTools.length > 0) expectedBundles.add("base");

    // More than one skill may list a tool, so it may legitimately live in
    // any bundle that claims it.
    const claimedBy = new Map<string, Set<string>>();
    const claim = (tool: string, bundle: string) =>
      claimedBy.set(tool, (claimedBy.get(tool) ?? new Set()).add(bundle));
    for (const entry of skills) for (const name of entry.tools) claim(name, entry.name);
    for (const name of baseTools) claim(name, "base");

    const problems: string[] = [];
    const seen = new Set<string>();
    const bundleEntries = yield* Result.await(
      Result.tryPromise({
        try: () => readdir(defsRoot, { withFileTypes: true }),
        catch: (cause) =>
          new Transient({ operation: `list ${defsRoot}`, detail: messageOf(cause) }),
      }),
    );
    for (const bundle of bundleEntries) {
      if (!bundle.isDirectory()) {
        problems.push(`lib/tool_defs/${bundle.name} is not a bundle directory`);
        continue;
      }
      if (!expectedBundles.has(bundle.name)) {
        problems.push(`lib/tool_defs/${bundle.name}/ matches no skill`);
        continue;
      }
      const bundleDir = join(defsRoot, bundle.name);
      const bundleFiles = yield* Result.await(
        Result.tryPromise({
          try: () => readdir(bundleDir),
          catch: (cause) =>
            new Transient({ operation: `list ${bundleDir}`, detail: messageOf(cause) }),
        }),
      );
      for (const file of bundleFiles) {
        if (!file.endsWith(".ts")) continue;
        const tool = file.slice(0, -3);
        seen.add(tool);
        const owners = claimedBy.get(tool);
        if (owners === undefined) problems.push(`${tool} is not in the registry`);
        else if (!owners.has(bundle.name)) {
          problems.push(
            `${tool} sits in ${bundle.name}/ but only ${[...owners].join(", ")} claims it`,
          );
        }
      }
    }
    const unfiled = toolNames.filter((name) => !seen.has(name));
    if (unfiled.length > 0) problems.push(`no tool_defs file for: ${unfiled.join(",")}`);

    if (problems.length > 0) {
      return Result.err(
        new InvalidInput({ subject: `${domain} tool_defs layout`, issues: problems }),
      );
    }
    return Result.ok(undefined);
  });
}

/** Prose and policy are separate files. Neither may name a skill the other lacks. */
async function checkSkillDocs(
  domain: string,
  root: string,
  skills: readonly RegistrySkill[],
): Promise<Result<void, InvalidInput | Transient>> {
  return Result.gen(async function* () {
    const declared = skills.map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
    const documented = yield* Result.await(skillDocNames(root));
    const missingDoc = declared.filter((name) => !documented.includes(name));
    const orphanDoc = documented.filter((name) => !declared.includes(name));
    const issues: string[] = [];
    if (missingDoc.length > 0) issues.push(`no prose for: ${missingDoc.join(",")}`);
    if (orphanDoc.length > 0) issues.push(`no registry entry for: ${orphanDoc.join(",")}`);
    if (issues.length > 0) {
      return Result.err(
        new InvalidInput({ subject: `${domain} skills vs lib/skill_defs/*.md`, issues }),
      );
    }
    for (const entry of skills) {
      if (parseSkillDoc(entry.doc).description === "") {
        return Result.err(
          new InvalidInput({
            subject: `${domain}/${entry.name}.md`,
            issues: ["needs a `description` in its frontmatter"],
          }),
        );
      }
    }
    return Result.ok(undefined);
  });
}

/** The README's tool table derives from the registry, so this check refuses to let it rot. */
async function checkReadme(
  domain: string,
  root: string,
  skills: readonly RegistrySkill[],
  baseTools: readonly string[],
  toolSpecs: ToolSpecs,
): Promise<Result<void, InvalidInput | Transient>> {
  return Result.gen(async function* () {
    const docs: SkillDoc[] = skills.map((entry) => ({
      name: entry.name,
      minRole: entry.minRole,
      tools: entry.tools,
      description: parseSkillDoc(entry.doc).description,
    }));

    const readmePath = join(root, "README.md");
    if (!(await fileExists(readmePath))) {
      return Result.err(
        new InvalidInput({
          subject: `${domain}/README.md`,
          issues: [`${readmePath} is required; run \`bun run readmes\` to create it`],
        }),
      );
    }
    const current = yield* Result.await(
      Result.tryPromise({
        try: () => readFile(readmePath, "utf8"),
        catch: (cause) =>
          new Transient({ operation: `read ${readmePath}`, detail: messageOf(cause) }),
      }),
    );
    const expected = renderSubagentReadme({
      domain,
      skills: docs,
      baseTools: [...baseTools],
      tools: toolSpecs,
      existing: current,
    });
    if (normalizeReadme(expected) !== normalizeReadme(current)) {
      return Result.err(
        new InvalidInput({
          subject: `${domain}/README.md`,
          issues: ["is stale; run `bun run readmes`"],
        }),
      );
    }
    return Result.ok(undefined);
  });
}

const outcome = await Result.gen(async function* () {
  const subagents = yield* Result.await(subagentNames());
  const domains = yield* Result.await(integrationDomains(subagents));
  const surfaces = yield* Result.all(await Promise.all(domains.map(checkDomain)));
  const auxiliary = subagents.filter((name) => !domains.includes(name));
  const pending = surfaces.filter((entry) => !entry.converted).map((entry) => entry.name);

  for (const entry of surfaces) {
    console.info(`${entry.name}: ${entry.toolCount} tools / ${entry.skillCount} skills`);
  }
  console.info(
    `capabilities: ${domains.length} native domains, ` +
      `${surfaces.reduce((total, entry) => total + entry.toolCount, 0)} tools, ` +
      `${surfaces.reduce((total, entry) => total + entry.skillCount, 0)} skills, ` +
      `${subagents.length} subagents (${auxiliary.join(", ")} auxiliary)`,
  );
  if (pending.length > 0) {
    console.info(`awaiting the registry shape: ${pending.join(", ")}`);
  }
  return Result.ok(undefined);
});

outcome.match({
  ok: () => undefined,
  err: (failure) => {
    const { tag, message } = serializeError(failure);
    console.error(`check-capabilities failed [${tag}]: ${message}`);
    process.exit(1);
  },
});
