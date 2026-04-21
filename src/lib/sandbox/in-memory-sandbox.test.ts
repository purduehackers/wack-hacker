import { describe, expect, it } from "vitest";

import { InMemorySandbox } from "./in-memory-sandbox.ts";

describe("InMemorySandbox — filesystem", () => {
  it("round-trips readFile and writeFile", async () => {
    const sandbox = new InMemorySandbox({ files: { "/vercel/sandbox/a.txt": "hello" } });
    expect(await sandbox.readFile("/vercel/sandbox/a.txt")).toBe("hello");

    await sandbox.writeFile("/vercel/sandbox/a.txt", "bye");
    expect(await sandbox.readFile("/vercel/sandbox/a.txt")).toBe("bye");
  });

  it("readFile throws ENOENT for missing paths", async () => {
    const sandbox = new InMemorySandbox();
    await expect(sandbox.readFile("/missing")).rejects.toThrow(/ENOENT/);
  });

  it("readdir lists immediate children (files + nested dirs)", async () => {
    const sandbox = new InMemorySandbox({
      files: {
        "/vercel/sandbox/a.txt": "",
        "/vercel/sandbox/dir/b.txt": "",
        "/vercel/sandbox/dir/sub/c.txt": "",
      },
    });
    const entries = await sandbox.readdir("/vercel/sandbox");
    const sorted = entries.map((e) => `${e.name}:${e.type}`).sort();
    expect(sorted).toEqual(["a.txt:file", "dir:directory"]);
  });

  it("stat distinguishes files from directories", async () => {
    const sandbox = new InMemorySandbox({ files: { "/vercel/sandbox/a.txt": "hi" } });
    const fileStat = await sandbox.stat("/vercel/sandbox/a.txt");
    expect(fileStat.isFile).toBe(true);
    expect(fileStat.isDirectory).toBe(false);
    expect(fileStat.size).toBe(2);

    const dirStat = await sandbox.stat("/vercel/sandbox");
    expect(dirStat.isDirectory).toBe(true);
    expect(dirStat.isFile).toBe(false);
  });
});

describe("InMemorySandbox — exec", () => {
  it("invokes the custom handler with the resolved cwd", async () => {
    let received: { command: string; cwd: string } | undefined;
    const sandbox = new InMemorySandbox({
      execHandler: (command, options) => {
        received = { command, cwd: options.cwd };
        return { exitCode: 0, stdout: "ok", stderr: "", truncated: false };
      },
    });
    const result = await sandbox.exec("git status", { cwd: "/vercel/sandbox/sub" });
    expect(result.stdout).toBe("ok");
    expect(received).toEqual({ command: "git status", cwd: "/vercel/sandbox/sub" });
  });

  it("default exec returns exit 0 with empty output", async () => {
    const sandbox = new InMemorySandbox();
    const result = await sandbox.exec("anything");
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "", truncated: false });
  });
});

describe("InMemorySandbox — lifecycle", () => {
  it("extendTimeout bumps the deadline and returns the new value", async () => {
    const sandbox = new InMemorySandbox();
    const first = await sandbox.extendTimeout(1000);
    const second = await sandbox.extendTimeout(2000);
    expect(second.expiresAt).toBe(first.expiresAt + 2000);
  });

  it("stop is idempotent and fires beforeStop at most once", async () => {
    let fired = 0;
    const sandbox = new InMemorySandbox({
      hooks: {
        beforeStop: async () => {
          fired += 1;
        },
      },
    });
    await sandbox.stop();
    await sandbox.stop();
    expect(fired).toBe(1);
  });

  it("swallows errors thrown by beforeStop (matches VercelSandbox semantics)", async () => {
    const sandbox = new InMemorySandbox({
      hooks: {
        beforeStop: async () => {
          throw new Error("boom");
        },
      },
    });
    await expect(sandbox.stop()).resolves.toBeUndefined();
  });

  it("operations fail after stop", async () => {
    const sandbox = new InMemorySandbox({ files: { "/vercel/sandbox/a": "x" } });
    await sandbox.stop();
    await expect(sandbox.readFile("/vercel/sandbox/a")).rejects.toThrow(/stopped/);
  });

  it("fireAfterStart invokes the afterStart hook", async () => {
    let called = false;
    const sandbox = new InMemorySandbox({
      hooks: {
        afterStart: async () => {
          called = true;
        },
      },
    });
    await sandbox.fireAfterStart();
    expect(called).toBe(true);
  });
});
