import { expect, spyOn, test } from "bun:test";

import { Result } from "@repo/shared/result";

import { createDashboardWriter } from "./dashboard.ts";

test("writes the displayed version verbatim to the dashboard's existing version key", async () => {
  const request = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ status: "ok" }));
  try {
    const writer = createDashboardWriter({
      vercelToken: "test-token",
      connectionString: "https://edge-config.vercel.com/ecfg_test?token=test-read-token",
    });
    if (Result.isError(writer)) throw writer.error;

    expect(Result.isOk(await writer.value.setVersion("v7.0"))).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "https://api.vercel.com/v1/global-config/ecfg_test/items",
      {
        method: "PATCH",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: [{ operation: "upsert", key: "version", value: "v7.0" }],
        }),
      },
    );
  } finally {
    request.mockRestore();
  }
});
