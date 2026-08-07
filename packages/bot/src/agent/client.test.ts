import { describe, expect, test } from "bun:test";

import type { DeliveryPayload } from "@repo/shared/wire";

import { createAgentClient, type AgentFetch } from "./client.ts";

const delivery: DeliveryPayload = {
  kind: "mention",
  continuationKey: "30000000000000000",
  content: "hello",
  messageId: "40000000000000000",
  principal: {
    userId: "10000000000000000",
    username: "member",
    nickname: "Member",
    memberRoles: [],
  },
  channel: { id: "30000000000000000", name: "bot-test" },
  dispatchId: "00000000-0000-4000-8000-000000000000",
};

describe("agent seam client", () => {
  test("presents the ingress bearer and preserves the immutable delivery", async () => {
    const requests: Request[] = [];
    const fakeFetch: AgentFetch = async (input, init) => {
      requests.push(
        typeof input === "string" || input instanceof URL
          ? new Request(input.toString(), init)
          : new Request(input, init),
      );
      return Response.json({
        ok: true,
        sessionId: "session-1",
        continuationToken: "continuation-1",
      });
    };
    const client = createAgentClient({
      baseUrl: "https://agent.example",
      secret: "ingress-secret",
      fetch: fakeFetch,
    });

    const result = await client.sendMessage(delivery);
    expect(result).toMatchObject({
      status: "ok",
      value: { sessionId: "session-1", continuationToken: "continuation-1" },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer ingress-secret");
    expect(await requests[0]?.json()).toEqual(delivery);
  });

  test("does not retry ambiguous message admission", async () => {
    let attempts = 0;
    const fakeFetch: AgentFetch = async () => {
      attempts += 1;
      throw new Error("socket closed after write");
    };
    const client = createAgentClient({
      baseUrl: "https://agent.example",
      secret: "ingress-secret",
      fetch: fakeFetch,
    });

    expect((await client.sendMessage(delivery)).status).toBe("error");
    expect(attempts).toBe(1);
  });

  test("rejects a successful HTTP response outside the wire contract", async () => {
    const fakeFetch: AgentFetch = async () => Response.json({ ok: true });
    const client = createAgentClient({
      baseUrl: "https://agent.example",
      secret: "ingress-secret",
      fetch: fakeFetch,
    });
    expect((await client.sendMessage(delivery)).status).toBe("error");
  });
  test("restores the originating trace after a durable queue handoff", async () => {
    const traceparent = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01";
    let request: Request | undefined;
    const fakeFetch: AgentFetch = async (input, init) => {
      request =
        typeof input === "string" || input instanceof URL
          ? new Request(input.toString(), init)
          : new Request(input, init);
      return Response.json({
        ok: true,
        sessionId: "session-1",
        continuationToken: "continuation-1",
      });
    };
    const client = createAgentClient({
      baseUrl: "https://agent.example",
      secret: "ingress-secret",
      fetch: fakeFetch,
    });

    await client.sendMessage({ ...delivery, traceparent });

    expect(request?.headers.get("traceparent")).toBe(traceparent);
  });
});
