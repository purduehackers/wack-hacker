import { Result } from "@repo/shared/result";
import { expect, test } from "vitest";

import { ping } from "./ping.ts";
import { latencyFromSnowflake } from "./ping.ts";

/** 2024-01-01T00:00:00Z expressed as a Discord snowflake. */
const SNOWFLAKE = String((1_704_067_200_000n - 1_420_070_400_000n) << 22n);

test("latency is derived from the snowflake, not from our own clock", () => {
  const latency = latencyFromSnowflake(SNOWFLAKE, 1_704_067_200_250);

  expect(Result.isOk(latency) && latency.value).toBe(250);
});

test("an unparseable snowflake is a typed failure, not a NaN", () => {
  for (const bad of ["", "abc", "-1", "0"]) {
    expect(Result.isError(latencyFromSnowflake(bad, Date.now()))).toBe(true);
  }
});

test("the command is named ping and takes no options", () => {
  const json = ping.builder.toJSON();

  expect(json.name).toBe("ping");
  expect(json.options ?? []).toHaveLength(0);
});
