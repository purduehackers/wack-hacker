/// <reference types="bun" />

import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const composeFile = fileURLToPath(new URL("../tests/contracts/redis.compose.yml", import.meta.url));
const project = `wack-contracts-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
const token = `contract-${crypto.randomUUID()}`;
const composeEnvironment = { ...process.env, CONTRACT_REDIS_TOKEN: token };
const compose = ["docker", "compose", "--project-name", project, "--file", composeFile];

async function run(
  command: readonly string[],
  options: { readonly inherit?: boolean; readonly allowFailure?: boolean } = {},
): Promise<string> {
  const child = Bun.spawn([...command], {
    cwd: root,
    env: composeEnvironment,
    stdin: options.inherit ? "inherit" : "ignore",
    stdout: options.inherit ? "inherit" : "pipe",
    stderr: options.inherit ? "inherit" : "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    options.inherit ? Promise.resolve("") : new Response(child.stdout).text(),
    options.inherit ? Promise.resolve("") : new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0 && !options.allowFailure) {
    throw new Error(`${command.join(" ")} failed (${exitCode})
${stderr.trim()}`);
  }
  return stdout;
}

async function waitForRedis(url: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(["PING"]),
      });
      if (response.ok) return;
    } catch {
      // The proxy may be listening before its Redis connection is ready.
    }
    await Bun.sleep(250);
  }
  throw new Error("the local Upstash-compatible Redis proxy did not become ready");
}

let cleanupStarted = false;
async function cleanup(): Promise<void> {
  if (cleanupStarted) return;
  cleanupStarted = true;
  await run([...compose, "down", "--volumes", "--remove-orphans"], {
    inherit: true,
    allowFailure: true,
  });
}

for (const [signal, exitCode] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(exitCode));
  });
}

let failed = false;
try {
  await run([...compose, "up", "--detach"], { inherit: true });
  const address = (await run([...compose, "port", "srh", "80"])).trim();
  const match = /^127\.0\.0\.1:(\d+)$/.exec(address);
  if (match === null) throw new Error(`unexpected Redis proxy address: ${address}`);
  const url = `http://${address}`;
  await waitForRedis(url);

  const tests = Bun.spawn(
    ["bun", "test", "--max-concurrency=1", "--timeout=30000", "tests/contracts"],
    {
      cwd: root,
      env: {
        ...process.env,
        CONTRACT_REDIS_URL: url,
        CONTRACT_REDIS_TOKEN: token,
        SKIP_ENV_VALIDATION: "1",
      },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  failed = (await tests.exited) !== 0;
} catch (cause) {
  failed = true;
  console.error(cause);
} finally {
  if (failed) {
    await run([...compose, "logs", "--no-color"], { inherit: true, allowFailure: true });
  }
  await cleanup();
}

if (failed) process.exitCode = 1;
