import { beforeEach, expect, test } from "vitest";

import { onShutdown, resetLifecycleForTest, shutdown } from "./lifecycle.ts";

beforeEach(() => {
  resetLifecycleForTest();
});

test("runs handlers in reverse registration order", async () => {
  const order: string[] = [];
  onShutdown("gateway", () => void order.push("gateway"));
  onShutdown("server", () => void order.push("server"));
  onShutdown("locks", () => void order.push("locks"));

  await shutdown("SIGTERM");

  // Newest first: a resource tears down before whatever it depends on.
  expect(order).toEqual(["locks", "server", "gateway"]);
});

test("a failing handler does not strand the handlers behind it", async () => {
  const ran: string[] = [];
  onShutdown("gateway", () => void ran.push("gateway"));
  onShutdown("broken", () => {
    throw new Error("boom");
  });

  const failed = await shutdown("SIGTERM");

  expect(failed).toEqual(["broken"]);
  expect(ran).toEqual(["gateway"]);
});

test("awaits async handlers before moving on", async () => {
  const ran: string[] = [];
  onShutdown("slow", async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    ran.push("slow");
  });
  onShutdown("fast", () => void ran.push("fast"));

  await shutdown("SIGTERM");

  expect(ran).toEqual(["fast", "slow"]);
});

test("is idempotent so a second signal is ignored", async () => {
  let calls = 0;
  onShutdown("gateway", () => {
    calls += 1;
  });

  await shutdown("SIGTERM");
  await shutdown("SIGINT");

  expect(calls).toBe(1);
});
