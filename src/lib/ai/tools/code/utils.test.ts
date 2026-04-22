import { describe, expect, it } from "vitest";

import { InMemorySandbox } from "@/lib/test/fixtures";

import { getSandboxContext, resolvePath, toRelative } from "./utils.ts";

describe("getSandboxContext", () => {
  it("returns the context when sandbox is present", () => {
    const sandbox = new InMemorySandbox();
    const ctx = {
      sandbox,
      repo: "purduehackers/x",
      branch: "wack-hacker/a",
      repoDir: "/vercel/sandbox",
      threadKey: "T1",
    };
    expect(getSandboxContext(ctx, "read").sandbox).toBe(sandbox);
  });

  it("throws a loud error when sandbox is missing", () => {
    expect(() => getSandboxContext(undefined, "read")).toThrow(/wiring bug/i);
    expect(() => getSandboxContext({}, "read")).toThrow(/wiring bug/i);
    expect(() => getSandboxContext(null, "read")).toThrow(/wiring bug/i);
  });
});

describe("resolvePath", () => {
  const repoDir = "/vercel/sandbox";

  it("resolves repo-relative paths", () => {
    expect(resolvePath(repoDir, "README.md")).toBe("/vercel/sandbox/README.md");
    expect(resolvePath(repoDir, "src/index.ts")).toBe("/vercel/sandbox/src/index.ts");
  });

  it("accepts already-absolute paths inside the repo", () => {
    expect(resolvePath(repoDir, "/vercel/sandbox/src/a.ts")).toBe("/vercel/sandbox/src/a.ts");
  });

  it("accepts the repo root itself", () => {
    expect(resolvePath(repoDir, ".")).toBe(repoDir);
    expect(resolvePath(repoDir, "/vercel/sandbox")).toBe(repoDir);
  });

  it("rejects paths that escape the repo via ..", () => {
    expect(() => resolvePath(repoDir, "../etc/passwd")).toThrow(/outside the repo/);
    expect(() => resolvePath(repoDir, "src/../../etc/passwd")).toThrow(/outside the repo/);
  });

  it("rejects absolute paths outside the repo", () => {
    expect(() => resolvePath(repoDir, "/etc/passwd")).toThrow(/outside the repo/);
    expect(() => resolvePath(repoDir, "/vercel/sandbox2/a")).toThrow(/outside the repo/);
  });
});

describe("toRelative", () => {
  it("produces repo-relative paths", () => {
    expect(toRelative("/vercel/sandbox", "/vercel/sandbox/src/a.ts")).toBe("src/a.ts");
  });

  it("returns '.' for the repo root itself", () => {
    expect(toRelative("/vercel/sandbox", "/vercel/sandbox")).toBe(".");
  });
});
