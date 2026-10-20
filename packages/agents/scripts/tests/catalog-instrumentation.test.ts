import { expect, test } from "bun:test";

test("production instrumentation has one OTel owner and preserves Sentry exports", async () => {
  for (const sampleRate of ["1", "0"]) {
    const child = Bun.spawn(
      [
        process.execPath,
        new URL("./fixtures/instrumentation-bootstrap.ts", import.meta.url).pathname,
      ],
      {
        env: { ...process.env, SENTRY_TRACES_SAMPLE_RATE: sampleRate },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(stdout).toContain("instrumentation bootstrap passed");
  }
}, 20_000);
