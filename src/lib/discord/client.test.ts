import { API } from "@discordjs/core/http-only";
import { describe, expect, it } from "vitest";

import { createDiscordAPI } from "./client";

describe("createDiscordAPI", () => {
  it("returns a Discord API instance bound to the bot token", () => {
    const api = createDiscordAPI();
    expect(api).toBeInstanceOf(API);
    // The REST client is private; we just verify the factory produced the
    // expected surface and that channels/users/interactions are reachable.
    expect(api.channels).toBeDefined();
    expect(api.users).toBeDefined();
    expect(api.interactions).toBeDefined();
  });

  it("returns independent instances on each call", () => {
    expect(createDiscordAPI()).not.toBe(createDiscordAPI());
  });
});
