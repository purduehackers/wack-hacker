import { afterAll, describe, expect, test } from "bun:test";

import { UserRole } from "@repo/shared/discord";
import type { SessionAuthContext } from "eve/context";
import type { DynamicResolveContext } from "eve/tools";

process.env["SKIP_ENV_VALIDATION"] = "1";
let budgetReads = 0;
const redis = Bun.serve({
  port: 0,
  async fetch(request) {
    const commands: unknown = await request.json();
    if (!Array.isArray(commands)) return new Response("expected Redis pipeline", { status: 400 });
    budgetReads += commands.length;
    // oxlint-disable-next-line unicorn/no-null -- Upstash represents a missing GET as JSON null.
    return Response.json(commands.map(() => ({ result: null })));
  },
});
process.env["UPSTASH_REDIS_REST_URL"] = redis.url.toString();
process.env["UPSTASH_REDIS_REST_TOKEN"] = "native-tool-policy-test";

const cmsCatalog = (await import("../agent/subagents/cms/tools/catalog.ts")).default;
const { CMS_TOOLS } = await import("../agent/subagents/cms/lib/tool-registry.ts");
const { visibleCmsToolNames } = await import("../agent/subagents/cms/lib/runtime.ts");
const discordCatalog = (await import("../agent/subagents/discord/tools/catalog.ts")).default;
const { DISCORD_TOOLS } = await import("../agent/subagents/discord/lib/tool-registry.ts");
const { visibleDiscordToolNames } = await import("../agent/subagents/discord/lib/runtime.ts");
const figmaCatalog = (await import("../agent/subagents/figma/tools/catalog.ts")).default;
const { FIGMA_TOOLS } = await import("../agent/subagents/figma/lib/tool-registry.ts");
const { visibleFigmaToolNames } = await import("../agent/subagents/figma/lib/runtime.ts");
const financeCatalog = (await import("../agent/subagents/finance/tools/catalog.ts")).default;
const { FINANCE_TOOLS } = await import("../agent/subagents/finance/lib/tool-registry.ts");
const { visibleFinanceToolNames } = await import("../agent/subagents/finance/lib/runtime.ts");
const githubCatalog = (await import("../agent/subagents/github/tools/catalog.ts")).default;
const { GITHUB_TOOLS } = await import("../agent/subagents/github/lib/tool-registry.ts");
const { visibleGithubToolNames } = await import("../agent/subagents/github/lib/runtime.ts");
const linearCatalog = (await import("../agent/subagents/linear/tools/catalog.ts")).default;
const { LINEAR_TOOLS } = await import("../agent/subagents/linear/lib/tool-registry.ts");
const { visibleLinearToolNames } = await import("../agent/subagents/linear/lib/runtime.ts");
const notionCatalog = (await import("../agent/subagents/notion/tools/catalog.ts")).default;
const { NOTION_TOOLS } = await import("../agent/subagents/notion/lib/tool-registry.ts");
const { visibleNotionToolNames } = await import("../agent/subagents/notion/lib/runtime.ts");
const outreachCatalog = (await import("../agent/subagents/outreach/tools/catalog.ts")).default;
const { OUTREACH_TOOLS } = await import("../agent/subagents/outreach/lib/tool-registry.ts");
const { visibleOutreachToolNames } = await import("../agent/subagents/outreach/lib/runtime.ts");
const sentryCatalog = (await import("../agent/subagents/sentry/tools/catalog.ts")).default;
const { SENTRY_TOOLS } = await import("../agent/subagents/sentry/lib/tool-registry.ts");
const { visibleSentryToolNames } = await import("../agent/subagents/sentry/lib/runtime.ts");
const shoppingCatalog = (await import("../agent/subagents/shopping/tools/catalog.ts")).default;
const { SHOPPING_TOOLS } = await import("../agent/subagents/shopping/lib/tool-registry.ts");
const { visibleShoppingToolNames } = await import("../agent/subagents/shopping/lib/runtime.ts");
const vercelCatalog = (await import("../agent/subagents/vercel/tools/catalog.ts")).default;
const { VERCEL_TOOLS } = await import("../agent/subagents/vercel/lib/tool-registry.ts");
const { visibleVercelToolNames } = await import("../agent/subagents/vercel/lib/runtime.ts");

const adapters = [
  {
    name: "cms",
    catalog: cmsCatalog,
    tools: CMS_TOOLS,
    visible: visibleCmsToolNames,
    counts: [16, 49, 54],
  },
  {
    name: "discord",
    catalog: discordCatalog,
    tools: DISCORD_TOOLS,
    visible: visibleDiscordToolNames,
    counts: [18, 56, 68],
  },
  {
    name: "figma",
    catalog: figmaCatalog,
    tools: FIGMA_TOOLS,
    visible: visibleFigmaToolNames,
    counts: [20, 28, 33],
  },
  {
    name: "finance",
    catalog: financeCatalog,
    tools: FINANCE_TOOLS,
    visible: visibleFinanceToolNames,
    counts: [16, 16, 16],
  },
  {
    name: "github",
    catalog: githubCatalog,
    tools: GITHUB_TOOLS,
    visible: visibleGithubToolNames,
    counts: [49, 109, 119],
  },
  {
    name: "linear",
    catalog: linearCatalog,
    tools: LINEAR_TOOLS,
    visible: visibleLinearToolNames,
    counts: [23, 55, 64],
  },
  {
    name: "notion",
    catalog: notionCatalog,
    tools: NOTION_TOOLS,
    visible: visibleNotionToolNames,
    counts: [13, 24, 24],
  },
  {
    name: "outreach",
    catalog: outreachCatalog,
    tools: OUTREACH_TOOLS,
    visible: visibleOutreachToolNames,
    counts: [18, 38, 41],
  },
  {
    name: "sentry",
    catalog: sentryCatalog,
    tools: SENTRY_TOOLS,
    visible: visibleSentryToolNames,
    counts: [45, 55, 68],
  },
  {
    name: "shopping",
    catalog: shoppingCatalog,
    tools: SHOPPING_TOOLS,
    visible: visibleShoppingToolNames,
    counts: [2, 6, 6],
  },
  {
    name: "vercel",
    catalog: vercelCatalog,
    tools: VERCEL_TOOLS,
    visible: visibleVercelToolNames,
    counts: [104, 166, 166],
  },
] as const;

const roles = [UserRole.Public, UserRole.Organizer, UserRole.Admin] as const;

function auth(role: UserRole): SessionAuthContext {
  return {
    authenticator: "native-tool-test",
    principalType: "user",
    principalId: "10000000000000000",
    attributes: { role },
  };
}

async function resolveCatalog(
  catalog: (typeof adapters)[number]["catalog"],
  current: SessionAuthContext | null,
  messages: DynamicResolveContext["messages"] = [],
): Promise<Readonly<Record<string, unknown>>> {
  const handler = catalog.events["step.started"];
  if (handler === undefined) throw new Error("native tool catalog lacks step.started");
  const context: DynamicResolveContext = {
    session: { id: "native-tool-test-session", auth: { current, initiator: current } },
    channel: {},
    messages,
  };
  const result = await handler({}, context);
  if (result === null || result === undefined || typeof result !== "object") {
    throw new Error("native tool catalog must resolve to a tool map");
  }
  return Object.fromEntries(Object.entries(result));
}

afterAll(async () => await redis.stop(true));

describe("independent integration tool policy", () => {
  test("fails closed without a current principal", async () => {
    for (const adapter of adapters) {
      // oxlint-disable-next-line unicorn/no-null -- Eve models absent current auth as null.
      expect(await resolveCatalog(adapter.catalog, null), adapter.name).toEqual({});
    }
  });

  test("resolves every registry through role policy without history or readiness filtering", async () => {
    for (const adapter of adapters) {
      const candidates = Object.keys(adapter.tools);
      expect(candidates, `${adapter.name}/custom-loader`).not.toContain("load_skill");

      for (const [index, role] of roles.entries()) {
        const expected = await adapter.visible(auth(role), candidates);
        const actual = Object.keys(await resolveCatalog(adapter.catalog, auth(role)));
        expect(actual, `${adapter.name}/${role}/policy`).toEqual(expected);
        const expectedCount = adapter.counts[index];
        if (expectedCount === undefined) throw new Error(`missing ${adapter.name}/${role} count`);
        expect(actual, `${adapter.name}/${role}/count`).toHaveLength(expectedCount);
      }

      const admin = Object.keys(await resolveCatalog(adapter.catalog, auth(UserRole.Admin)));
      expect(admin, `${adapter.name}/all-registry`).toEqual(candidates);
      const withHistory = Object.keys(
        await resolveCatalog(adapter.catalog, auth(UserRole.Admin), [
          { role: "assistant", content: "legacy load_skill and activation markers" },
        ]),
      );
      expect(withHistory, `${adapter.name}/history-independent`).toEqual(admin);
    }
    expect(budgetReads).toBe(adapters.length * 2);
  });
});
