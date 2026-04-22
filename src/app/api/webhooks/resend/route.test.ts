import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryRedis, notionClientClass, svixMocks } from "@/lib/test/fixtures";

const mocks = vi.hoisted(() => {
  // Set the webhook secret before any module that reads `env` is imported.
  // vi.hoisted runs before top-level imports and vi.mock factories, so this
  // is the earliest point we can inject process.env safely.
  process.env.RESEND_WEBHOOK_SECRET = "whsec_test";
  return {
    verify: vi.fn(),
    query: vi.fn().mockResolvedValue({ results: [] }),
    pagesUpdate: vi.fn(),
    redis: undefined as ReturnType<typeof createMemoryRedis> | undefined,
  };
});

vi.mock("svix", () => svixMocks({ verify: mocks.verify }));

vi.mock("@notionhq/client", () => ({
  Client: notionClientClass({
    dataSourcesQuery: mocks.query,
    pagesUpdate: mocks.pagesUpdate,
  }),
}));

// `route.ts` constructs a fresh `ConversationStore` per request, which in
// turn calls `Redis.fromEnv()` each time — so it's safe to swap `mocks.redis`
// between tests (no caller caches the returned instance).
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => mocks.redis! },
}));

const { POST } = await import("./route.ts");

function req(body: string, headers: Record<string, string>) {
  return new Request("https://example.com/api/webhooks/resend", {
    method: "POST",
    headers,
    body,
  });
}

const GOOD_HEADERS = {
  "svix-id": "msg_1",
  "svix-timestamp": "1",
  "svix-signature": "v1,sig",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue({ results: [] });
  mocks.redis = createMemoryRedis();
});

describe("POST /api/webhooks/resend", () => {
  it("returns 401 on invalid signature", async () => {
    const { WebhookVerificationError } = await import("svix");
    mocks.verify.mockImplementationOnce(() => {
      throw new WebhookVerificationError("bad sig");
    });
    const res = await POST(req("{}", GOOD_HEADERS));
    expect(res.status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("re-throws non-verification errors", async () => {
    mocks.verify.mockImplementationOnce(() => {
      throw new Error("server exploded");
    });
    await expect(POST(req("{}", GOOD_HEADERS))).rejects.toThrow("server exploded");
  });

  it("applies the event on a good signature and returns 200", async () => {
    mocks.verify.mockReturnValueOnce({
      type: "email.delivered",
      created_at: "t",
      data: { email_id: "re_1" },
    });
    const res = await POST(req("{}", { ...GOOD_HEADERS, "svix-id": "msg_ok" }));
    expect(res.status).toBe(200);
    expect(mocks.query).toHaveBeenCalled();
  });

  it("short-circuits duplicate svix-id deliveries", async () => {
    mocks.verify.mockReturnValue({
      type: "email.delivered",
      created_at: "t",
      data: { email_id: "re_2" },
    });
    const r1 = await POST(req("{}", { ...GOOD_HEADERS, "svix-id": "dup-1" }));
    expect(r1.status).toBe(200);
    const callCount = mocks.query.mock.calls.length;

    const r2 = await POST(req("{}", { ...GOOD_HEADERS, "svix-id": "dup-1" }));
    expect(r2.status).toBe(200);
    // No additional query — short-circuited.
    expect(mocks.query.mock.calls.length).toBe(callCount);
  });

  it("returns 500 when applyResendEvent throws so Resend retries", async () => {
    mocks.verify.mockReturnValueOnce({
      type: "email.opened",
      created_at: "t",
      data: { email_id: "re_3" },
    });
    mocks.query.mockRejectedValueOnce(new Error("notion down"));
    const res = await POST(req("{}", { ...GOOD_HEADERS, "svix-id": "err-1" }));
    expect(res.status).toBe(500);
  });

  it("releases the dedup claim on failure so the next delivery retries", async () => {
    mocks.verify.mockReturnValue({
      type: "email.opened",
      created_at: "t",
      data: { email_id: "re_4" },
    });
    mocks.query.mockRejectedValueOnce(new Error("notion down"));
    const r1 = await POST(req("{}", { ...GOOD_HEADERS, "svix-id": "retry-1" }));
    expect(r1.status).toBe(500);

    // Second delivery — notion recovers.
    mocks.query.mockResolvedValue({ results: [] });
    const r2 = await POST(req("{}", { ...GOOD_HEADERS, "svix-id": "retry-1" }));
    expect(r2.status).toBe(200);
  });
});
