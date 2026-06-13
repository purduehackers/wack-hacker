import type { UIMessage } from "ai";

import { describe, expect, it, vi } from "vitest";

import { InMemorySandbox, octokitClass } from "@/lib/test/fixtures";

// Third-party SDK mocks — neutralize clients so the module imports cleanly.
vi.mock("@sentry/nextjs", () => ({ metrics: { count: vi.fn(), distribution: vi.fn() } }));
vi.mock("octokit", () => ({ Octokit: octokitClass() }));
vi.mock("@octokit/auth-app", () => ({ createAppAuth: vi.fn(() => ({})) }));

const { codePostFinish, getCodeDelegationPrompt } = await import("./delegation.ts");
const { octokit } = await import("../github/client.ts");

const FINAL_TEXT = [
  "## Summary",
  "Implemented the fix.",
  "",
  "## Test Plan",
  "- bun run validate",
  "",
  "**Commit message**: fix: handle empty input",
  "",
  "```entities",
  "PR branch | branch | wack/feature | https://github.com/purduehackers/site/tree/wack/feature",
  "```",
].join("\n");

function sandboxContext(sandbox: InMemorySandbox) {
  return {
    sandbox,
    repo: "purduehackers/site",
    branch: "wack/feature",
    repoDir: "/vercel/sandbox/site",
    threadKey: "thread-1",
  };
}

async function drainTexts(gen: AsyncGenerator<UIMessage, void, void>): Promise<string[]> {
  const texts: string[] = [];
  for await (const msg of gen) {
    const part = msg.parts.find((p): p is { type: "text"; text: string } => p.type === "text");
    if (part) texts.push(part.text);
  }
  return texts;
}

/** Sandbox whose git status reports a dirty tree and all git commands succeed. */
function dirtySandbox() {
  return new InMemorySandbox({
    execHandler: (command) => ({
      exitCode: 0,
      stdout: command.startsWith("git status") ? " M src/index.ts" : "",
      stderr: "",
      truncated: false,
    }),
  });
}

function mockPullRequestApis(htmlUrl: string) {
  const rest = vi.mocked(octokit.rest, { deep: true });
  rest.repos.get.mockResolvedValue({ data: { default_branch: "main" } } as never);
  rest.pulls.list.mockResolvedValue({ data: [] } as never);
  rest.pulls.create.mockResolvedValue({ data: { html_url: htmlUrl } } as never);
  return rest;
}

describe("getCodeDelegationPrompt", () => {
  it("returns the verbatim task from the validated input", () => {
    expect(getCodeDelegationPrompt({ repo: "purduehackers/site", task: "fix the bug" })).toBe(
      "fix the bug",
    );
  });

  it("throws on input that fails the schema", () => {
    expect(() => getCodeDelegationPrompt({ repo: "evil/site/extra", task: "x" })).toThrow();
  });
});

describe("codePostFinish — clean run", () => {
  it("reports no changes without a step-cap note", async () => {
    const sandbox = new InMemorySandbox();
    const texts = await drainTexts(
      codePostFinish({
        experimentalContext: sandboxContext(sandbox),
        lastAssistantText: FINAL_TEXT,
        exhausted: false,
        hitStepCap: false,
      }),
    );
    expect(texts).toEqual(["No changes to commit. Nothing pushed; no PR opened."]);
  });

  it("opens a PR without partial-work labeling and strips the entities trailer", async () => {
    const rest = mockPullRequestApis("https://github.com/purduehackers/site/pull/7");
    const texts = await drainTexts(
      codePostFinish({
        experimentalContext: sandboxContext(dirtySandbox()),
        lastAssistantText: FINAL_TEXT,
        exhausted: false,
        hitStepCap: false,
      }),
    );

    expect(rest.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "fix: handle empty input" }),
    );
    const body = rest.pulls.create.mock.calls.at(-1)![0] as unknown as { body: string };
    expect(body.body).not.toContain("```entities");
    expect(body.body).not.toContain("[!WARNING]");

    const finalMessage = texts.at(-1)!;
    expect(finalMessage).toContain("**PR**: https://github.com/purduehackers/site/pull/7");
    expect(finalMessage).not.toContain("```entities");
    expect(finalMessage).not.toContain("step cap");
  });
});

describe("codePostFinish — cap-hit run", () => {
  it("labels the no-changes message when the run hit its step cap", async () => {
    const sandbox = new InMemorySandbox();
    const texts = await drainTexts(
      codePostFinish({
        experimentalContext: sandboxContext(sandbox),
        lastAssistantText: FINAL_TEXT,
        exhausted: false,
        hitStepCap: true,
      }),
    );
    expect(texts.at(-1)).toContain("hit its step cap");
    expect(texts.at(-1)).toContain("No changes to commit.");
  });

  it("labels the PR title, body, and status message as partial work", async () => {
    const rest = mockPullRequestApis("https://github.com/purduehackers/site/pull/8");
    const texts = await drainTexts(
      codePostFinish({
        experimentalContext: sandboxContext(dirtySandbox()),
        lastAssistantText: FINAL_TEXT,
        // The forced wrap-up step usually reports hitStepCap without strict
        // exhaustion — labeling must still kick in.
        exhausted: false,
        hitStepCap: true,
      }),
    );

    const createArgs = rest.pulls.create.mock.calls.at(-1)![0] as unknown as {
      title: string;
      body: string;
    };
    expect(createArgs.title).toBe("[partial] fix: handle empty input");
    expect(createArgs.body).toContain("[!WARNING]");
    expect(createArgs.body).toContain("may contain partial work");
    expect(createArgs.body).not.toContain("```entities");

    const finalMessage = texts.at(-1)!;
    expect(finalMessage).toContain("hit its step cap");
    expect(finalMessage).toContain("**PR**: https://github.com/purduehackers/site/pull/8");
  });
});
