import { describe, expect, test } from "bun:test";

import { decodeDiscordCommand } from "./discord-command-wire.ts";
import { Result } from "./result/index.ts";

describe("Discord command wire", () => {
  test("decodes the closed operation union and applies operation defaults", () => {
    const result = decodeDiscordCommand({
      operation: "fetch_messages",
      input: { channel_id: "20000000000000001" },
    });

    expect(Result.isError(result)).toBe(false);
    if (Result.isError(result)) return;
    expect(result.value).toEqual({
      operation: "fetch_messages",
      input: { channel_id: "20000000000000001", limit: 25 },
    });
  });

  test("rejects unknown operations and authority-bearing extra input", () => {
    expect(
      Result.isError(
        decodeDiscordCommand({
          operation: "execute_raw_request",
          input: {},
        }),
      ),
    ).toBe(true);
    expect(
      Result.isError(
        decodeDiscordCommand({
          operation: "send_message",
          input: {
            channel_id: "20000000000000001",
            content: "hello",
            guild_id: "90000000000000000",
          },
        }),
      ),
    ).toBe(true);
  });
});
