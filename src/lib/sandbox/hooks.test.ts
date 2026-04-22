import { describe, expect, it } from "vitest";

import { InMemorySandbox } from "@/lib/test/fixtures";

import { buildSandboxHooks } from "./hooks.ts";

function recordingSandbox(
  responses: Record<string, { exitCode: number; stdout?: string; stderr?: string }> = {},
) {
  const invocations: string[] = [];
  const sandbox = new InMemorySandbox({
    execHandler: (command) => {
      invocations.push(command);
      const match = Object.keys(responses).find((pattern) => command.includes(pattern));
      const response = match ? responses[match]! : { exitCode: 0 };
      return {
        exitCode: response.exitCode,
        stdout: response.stdout ?? "",
        stderr: response.stderr ?? "",
        truncated: false,
      };
    },
  });
  return { sandbox, invocations };
}

const BASE_CONFIG = {
  repo: "purduehackers/agent-sandbox-test",
  branch: "phoenix-agent/test",
  gitUser: { name: "Phoenix Bot", email: "bot@example.com" },
};

describe("buildSandboxHooks — skipCloneAndBranch", () => {
  it("skips clone + branch when resuming from hibernation but still configures git", async () => {
    const { sandbox, invocations } = recordingSandbox();
    const hooks = buildSandboxHooks({
      ...BASE_CONFIG,
      hasBaseSnapshot: true,
      skipCloneAndBranch: true,
    });
    await hooks.afterStart!(sandbox);

    expect(invocations.some((c) => c.includes("git clone"))).toBe(false);
    expect(invocations.some((c) => c.includes("git checkout -b"))).toBe(false);
    // Git identity still configured so any resumed commits have author info.
    expect(invocations.some((c) => c.includes("git config --global user.name"))).toBe(true);
  });

  it("surfaces the stdout tail when stderr is empty on failure", async () => {
    const { sandbox } = recordingSandbox({
      "git clone": { exitCode: 128, stdout: "fatal from stdout", stderr: "" },
    });
    const hooks = buildSandboxHooks({ ...BASE_CONFIG, hasBaseSnapshot: true });
    await expect(hooks.afterStart!(sandbox)).rejects.toThrow(/fatal from stdout/);
  });
});

describe("buildSandboxHooks — afterStart ordering", () => {
  it("runs install → git config → clone → branch when no base snapshot", async () => {
    const { sandbox, invocations } = recordingSandbox();
    const hooks = buildSandboxHooks({ ...BASE_CONFIG, hasBaseSnapshot: false });
    await hooks.afterStart!(sandbox);

    const first = invocations.findIndex((c) => c.includes("dnf install"));
    const userName = invocations.findIndex((c) => c.includes("git config --global user.name"));
    const clone = invocations.findIndex((c) => c.includes("git clone"));
    const branch = invocations.findIndex((c) => c.includes("git checkout -b"));

    expect(first).toBeGreaterThanOrEqual(0);
    expect(userName).toBeGreaterThan(first);
    expect(clone).toBeGreaterThan(userName);
    expect(branch).toBeGreaterThan(clone);
  });

  it("skips the toolchain install when a base snapshot is provided", async () => {
    const { sandbox, invocations } = recordingSandbox();
    const hooks = buildSandboxHooks({ ...BASE_CONFIG, hasBaseSnapshot: true });
    await hooks.afterStart!(sandbox);

    expect(invocations.some((c) => c.includes("dnf install"))).toBe(false);
    // Still configures git, clones, and branches.
    expect(invocations.some((c) => c.includes("git config --global user.name"))).toBe(true);
    expect(invocations.some((c) => c.includes("git clone"))).toBe(true);
    expect(invocations.some((c) => c.includes("git checkout -b"))).toBe(true);
  });

  it("uses --branch when baseBranch is set", async () => {
    const { sandbox, invocations } = recordingSandbox();
    const hooks = buildSandboxHooks({
      ...BASE_CONFIG,
      baseBranch: "develop",
      hasBaseSnapshot: true,
    });
    await hooks.afterStart!(sandbox);

    const cloneCmd = invocations.find((c) => c.includes("git clone"))!;
    expect(cloneCmd).toContain(`--branch "develop"`);
  });

  it("omits --branch when baseBranch is unset", async () => {
    const { sandbox, invocations } = recordingSandbox();
    const hooks = buildSandboxHooks({ ...BASE_CONFIG, hasBaseSnapshot: true });
    await hooks.afterStart!(sandbox);

    const cloneCmd = invocations.find((c) => c.includes("git clone"))!;
    expect(cloneCmd).not.toContain("--branch");
  });
});

describe("buildSandboxHooks — error surfacing", () => {
  it("throws a descriptive error when clone fails", async () => {
    const { sandbox } = recordingSandbox({
      "git clone": { exitCode: 128, stderr: "fatal: Authentication failed" },
    });
    const hooks = buildSandboxHooks({ ...BASE_CONFIG, hasBaseSnapshot: true });
    await expect(hooks.afterStart!(sandbox)).rejects.toThrow(
      /clone purduehackers\/agent-sandbox-test failed \(exit 128\).*Authentication failed/,
    );
  });

  it("throws when git config fails", async () => {
    const { sandbox } = recordingSandbox({
      "git config --global user.name": { exitCode: 1, stderr: "permission denied" },
    });
    const hooks = buildSandboxHooks({ ...BASE_CONFIG, hasBaseSnapshot: true });
    await expect(hooks.afterStart!(sandbox)).rejects.toThrow(/git user.name failed/);
  });

  it("throws when branch creation fails", async () => {
    const { sandbox } = recordingSandbox({
      "git checkout -b": { exitCode: 1, stderr: "branch already exists" },
    });
    const hooks = buildSandboxHooks({ ...BASE_CONFIG, hasBaseSnapshot: true });
    await expect(hooks.afterStart!(sandbox)).rejects.toThrow(/checkout -b/);
  });
});

describe("buildSandboxHooks — beforeStop", () => {
  it("runs without error", async () => {
    const { sandbox } = recordingSandbox();
    const hooks = buildSandboxHooks({ ...BASE_CONFIG, hasBaseSnapshot: true });
    await expect(hooks.beforeStop!(sandbox)).resolves.toBeUndefined();
  });
});
