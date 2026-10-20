/** Check runtime dependencies using only files present in the built output. */
import { cp, lstat, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sandboxWorkflowArtifact } from "./lib/sandbox-artifact.ts";
import { verifyCompiledWorkspaceReplay } from "./lib/sandbox-replay-probe.ts";

const source = process.argv[3] ?? new URL("../.output/server", import.meta.url).pathname;
const temporary = await mkdtemp(join(tmpdir(), "wack-bash-bundle-"));
const target = join(temporary, "server");
const maximumBytes = 200 * 1024 * 1024;

async function size(path: string, root: string, visited = new Set<string>()): Promise<number> {
  const actual = await realpath(path);
  if (actual !== root && !actual.startsWith(`${root}/`))
    throw new Error("Build output symlink escapes its artifact");
  if (visited.has(actual)) return 0;
  visited.add(actual);
  const metadata = await lstat(actual);
  if (!metadata.isDirectory()) return metadata.size;
  let bytes = 0;
  for (const name of await readdir(actual)) bytes += await size(join(actual, name), root, visited);
  return bytes;
}

try {
  // Preserve relative symlinks; never repair missing dependencies by copying
  // files from the source checkout's node_modules through an external link.
  await cp(source, target, { recursive: true, verbatimSymlinks: true });
  const root = await realpath(target);
  const bytes = await size(root, root);
  if (bytes > maximumBytes)
    throw new Error(`Server artifact exceeds the 200 MiB candidate budget (${bytes} bytes)`);
  // Tracing a second copy is insufficient if authored provider code still uses
  // an inlined engine whose import.meta.url now points at the server chunk.
  const chunkNames = await readdir(join(target, "_chunks"));
  const authoredName = chunkNames.find(
    (name) => name === "node-server.mjs" || name === "vercel.web.mjs",
  );
  if (!authoredName) throw new Error("Built server has no supported authored runtime chunk");
  const authored = await Bun.file(join(target, "_chunks", authoredName)).text();
  const workspace = sandboxWorkflowArtifact(authored);
  if (workspace.mode === "durable") await verifyCompiledWorkspaceReplay(workspace);
  if (
    !authored.includes('from "just-bash"') ||
    authored.includes('new URL("./worker.js", import.meta.url)')
  ) {
    throw new Error(
      "Authored sandbox must import the external just-bash package, not an inlined engine",
    );
  }
  const probe = join(target, "sandbox-bundle-probe.mjs");
  await Bun.write(
    probe,
    `
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Bash, InMemoryFs } from 'just-bash';
const root = realpathSync(fileURLToPath(new URL('.', import.meta.url)));
globalThis.fetch = () => { throw new Error('The build probe must not access the network'); };
const resolved = realpathSync(fileURLToPath(import.meta.resolve('just-bash')));
if (!resolved.startsWith(root + '/')) throw new Error('just-bash resolved outside the built artifact');
const fs = new InMemoryFs();
await fs.mkdir('/workspace');
const shell = new Bash({ fs, cwd: '/workspace', env: { HOME: '/home/wack' }, python: true, javascript: true, executionLimitProfile: 'hardened' });
const commands = [
  { command: "python3 -c 'import json,datetime; print(json.dumps([datetime.date(2026,10,19).isoformat(), 7]))'", expected: '["2026-10-19", 7]\\n' },
  { command: "js-exec -c 'console.log(String(BigInt(123) * 2n))'", expected: '246\\n' },
];
for (const entry of commands) {
  const result = await shell.exec(entry.command);
  if (result.exitCode !== 0 || result.stdout !== entry.expected) throw new Error(JSON.stringify(result));
}
console.log(JSON.stringify({ runtime: process.version, engines: ['CPython/WASM', 'QuickJS'], workspaceMode: ${JSON.stringify(workspace.mode)}, agents: ${workspace.agents}, artifactBytes: ${bytes} }));
`,
  );
  const processHandle = Bun.spawn([process.argv[2] ?? process.execPath, probe], {
    cwd: target,
    env: {},
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
    processHandle.exited,
  ]);
  if (exitCode !== 0)
    throw new Error(`Built sandbox engines failed (${exitCode}): ${stderr}${stdout}`);
  process.stdout.write(stdout);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
