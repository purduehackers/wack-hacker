/// <reference types="bun" />

const appRoot = new URL("../", import.meta.url).pathname;
const glob = new Bun.Glob("agent/subagents/*/lib/skills.generated.ts");
const paths = [...glob.scanSync({ cwd: appRoot, onlyFiles: true })].sort((left, right) =>
  left.localeCompare(right),
);
if (paths.length === 0) throw new Error("skill compiler produced no registries");

await Promise.all(
  paths.map(async (path) => {
    const process = Bun.spawn(["bunx", "oxfmt", "--stdin-filepath", "generated.ts"], {
      cwd: appRoot,
      stdin: Bun.file(new URL(path, new URL(appRoot, "file:"))),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [formatted, errorOutput, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(`could not format ${path}: ${errorOutput.trim()}`);
    }
    await Bun.write(new URL(path, new URL(appRoot, "file:")), formatted);
  }),
);
