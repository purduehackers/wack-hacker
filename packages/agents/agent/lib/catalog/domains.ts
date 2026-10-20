import cloudflareInstructions from "../../subagents/cloudflare/instructions.md" with { type: "text" };
import { CLOUDFLARE_TOOLS, CLOUDFLARE_SKILLS } from "../../subagents/cloudflare/lib/registry.ts";
import { CLOUDFLARE_RUNTIME } from "../../subagents/cloudflare/lib/runtime.ts";
import cmsInstructions from "../../subagents/cms/instructions.md" with { type: "text" };
import { CMS_TOOLS, CMS_SKILLS } from "../../subagents/cms/lib/registry.ts";
import { CMS_RUNTIME } from "../../subagents/cms/lib/runtime.ts";
import discordInstructions from "../../subagents/discord/instructions.md" with { type: "text" };
import { DISCORD_TOOLS, DISCORD_SKILLS } from "../../subagents/discord/lib/registry.ts";
import { DISCORD_RUNTIME } from "../../subagents/discord/lib/runtime.ts";
import figmaInstructions from "../../subagents/figma/instructions.md" with { type: "text" };
import { FIGMA_TOOLS, FIGMA_SKILLS } from "../../subagents/figma/lib/registry.ts";
import { FIGMA_RUNTIME } from "../../subagents/figma/lib/runtime.ts";
import financeInstructions from "../../subagents/finance/instructions.md" with { type: "text" };
import { FINANCE_TOOLS, FINANCE_SKILLS } from "../../subagents/finance/lib/registry.ts";
import { FINANCE_RUNTIME } from "../../subagents/finance/lib/runtime.ts";
import githubInstructions from "../../subagents/github/instructions.md" with { type: "text" };
import { GITHUB_TOOLS, GITHUB_SKILLS } from "../../subagents/github/lib/registry.ts";
import { GITHUB_RUNTIME } from "../../subagents/github/lib/runtime.ts";
import linearInstructions from "../../subagents/linear/instructions.md" with { type: "text" };
import { LINEAR_TOOLS, LINEAR_SKILLS } from "../../subagents/linear/lib/registry.ts";
import { LINEAR_RUNTIME } from "../../subagents/linear/lib/runtime.ts";
import notionInstructions from "../../subagents/notion/instructions.md" with { type: "text" };
import { NOTION_TOOLS, NOTION_SKILLS } from "../../subagents/notion/lib/registry.ts";
import { NOTION_RUNTIME } from "../../subagents/notion/lib/runtime.ts";
import outreachInstructions from "../../subagents/outreach/instructions.md" with { type: "text" };
import { OUTREACH_TOOLS, OUTREACH_SKILLS } from "../../subagents/outreach/lib/registry.ts";
import { OUTREACH_RUNTIME } from "../../subagents/outreach/lib/runtime.ts";
import sentryInstructions from "../../subagents/sentry/instructions.md" with { type: "text" };
import { SENTRY_TOOLS, SENTRY_SKILLS } from "../../subagents/sentry/lib/registry.ts";
import { SENTRY_RUNTIME } from "../../subagents/sentry/lib/runtime.ts";
import shoppingInstructions from "../../subagents/shopping/instructions.md" with { type: "text" };
import { SHOPPING_TOOLS, SHOPPING_SKILLS } from "../../subagents/shopping/lib/registry.ts";
import { SHOPPING_RUNTIME } from "../../subagents/shopping/lib/runtime.ts";
import vercelInstructions from "../../subagents/vercel/instructions.md" with { type: "text" };
import { VERCEL_TOOLS, VERCEL_SKILLS } from "../../subagents/vercel/lib/registry.ts";
import { VERCEL_RUNTIME } from "../../subagents/vercel/lib/runtime.ts";
import { integrationDomain } from "./domain.ts";

/** Provider code and credentials remain application-side; only names enter closures. */
export const INTEGRATION_DOMAINS = {
  cloudflare: integrationDomain({
    name: "cloudflare",
    tools: CLOUDFLARE_TOOLS,
    skills: CLOUDFLARE_SKILLS,
    runtime: CLOUDFLARE_RUNTIME,
    instructions: cloudflareInstructions,
  }),
  cms: integrationDomain({
    name: "cms",
    tools: CMS_TOOLS,
    skills: CMS_SKILLS,
    runtime: CMS_RUNTIME,
    instructions: cmsInstructions,
  }),
  discord: integrationDomain({
    name: "discord",
    tools: DISCORD_TOOLS,
    skills: DISCORD_SKILLS,
    runtime: DISCORD_RUNTIME,
    instructions: discordInstructions,
  }),
  figma: integrationDomain({
    name: "figma",
    tools: FIGMA_TOOLS,
    skills: FIGMA_SKILLS,
    runtime: FIGMA_RUNTIME,
    instructions: figmaInstructions,
  }),
  finance: integrationDomain({
    name: "finance",
    tools: FINANCE_TOOLS,
    skills: FINANCE_SKILLS,
    runtime: FINANCE_RUNTIME,
    instructions: financeInstructions,
  }),
  github: integrationDomain({
    name: "github",
    tools: GITHUB_TOOLS,
    skills: GITHUB_SKILLS,
    runtime: GITHUB_RUNTIME,
    instructions: githubInstructions,
  }),
  linear: integrationDomain({
    name: "linear",
    tools: LINEAR_TOOLS,
    skills: LINEAR_SKILLS,
    runtime: LINEAR_RUNTIME,
    instructions: linearInstructions,
  }),
  notion: integrationDomain({
    name: "notion",
    tools: NOTION_TOOLS,
    skills: NOTION_SKILLS,
    runtime: NOTION_RUNTIME,
    instructions: notionInstructions,
  }),
  outreach: integrationDomain({
    name: "outreach",
    tools: OUTREACH_TOOLS,
    skills: OUTREACH_SKILLS,
    runtime: OUTREACH_RUNTIME,
    instructions: outreachInstructions,
  }),
  sentry: integrationDomain({
    name: "sentry",
    tools: SENTRY_TOOLS,
    skills: SENTRY_SKILLS,
    runtime: SENTRY_RUNTIME,
    instructions: sentryInstructions,
  }),
  shopping: integrationDomain({
    name: "shopping",
    tools: SHOPPING_TOOLS,
    skills: SHOPPING_SKILLS,
    runtime: SHOPPING_RUNTIME,
    instructions: shoppingInstructions,
  }),
  vercel: integrationDomain({
    name: "vercel",
    tools: VERCEL_TOOLS,
    skills: VERCEL_SKILLS,
    runtime: VERCEL_RUNTIME,
    instructions: vercelInstructions,
  }),
};
