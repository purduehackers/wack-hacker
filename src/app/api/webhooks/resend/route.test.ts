import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryRedis } from "@/lib/test/fixtures";

vi.mock("@/env", () => ({
  env: { RESEND_WEBHOOK_SECRET: "whsec_test" },
}));

const verifyMock = vi.fn();

class FakeWebhookVerificationError extends Error {}
class FakeWebhook {
  verify(body: string, headers: Record<string, string>) {
    return verifyMock(body, headers);
  }
}

vi.mock("svix", () => ({
  Webhook: FakeWebhook,
  WebhookVerificationError: FakeWebhookVerificationError,
}));

const applyMock = vi.fn();
vi.mock("@/lib/sales/resend-webhook", () => ({
  applyResendEvent: applyMock,
}));

const redis = createMemoryRedis();
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => redis },
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
});

describe("POST /api/webhooks/resend", () => {
  it("returns 401 on invalid signature", async () => {
    verifyMock.mockImplementationOnce(() => {
      throw new FakeWebhookVerificationError("bad sig");
    });
    const res = await POST(req("{}", GOOD_HEADERS));
    expect(res.status).toBe(401);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it("re-throws non-verification errors", async () => {
    verifyMock.mockImplementationOnce(() => {
      throw new Error("server exploded");
    });
    await expect(POST(req("{}", GOOD_HEADERS))).rejects.toThrow("server exploded");
  });

  it("applies the event on a good signature and returns 200", async () => {
    verifyMock.mockReturnValueOnce({
      type: "email.delivered",
      created_at: "t",
      data: { email_id: "re_1" },
    });
    const res = await POST(req("{}", { ...GOOD_HEADERS, "svix-id": "msg_ok" }));
    expect(res.status).toBe(200);
    expect(applyMock).toHaveBeenCalledTimes(1);
  });

  it("short-circuits duplicate svix-id deliveries", async () => {
    verifyMock.mockReturnValue({
      type: "email.delivered",
      created_at: "t",
      data: { email_id: "re_2" },
    });
    const r1 = await POST(req("{}", { ...GOOD_HEADERS, "svix-id": "dup-1" }));
    expect(r1.status).toBe(200);
    expect(applyMock).toHaveBeenCalledTimes(1);

    const r2 = await POST(req("{}", { ...GOOD_HEADERS, "svix-id": "dup-1" }));
    expect(r2.status).toBe(200);
    expect(applyMock).toHaveBeenCalledTimes(1);
  });

  it("returns 200 and logs when applyResendEvent throws", async () => {
    verifyMock.mockReturnValueOnce({
      type: "email.opened",
      created_at: "t",
      data: { email_id: "re_3" },
    });
    applyMock.mockRejectedValueOnce(new Error("notion down"));
    const res = await POST(req("{}", { ...GOOD_HEADERS, "svix-id": "err-1" }));
    expect(res.status).toBe(200);
    expect(applyMock).toHaveBeenCalledTimes(1);
  });
});
