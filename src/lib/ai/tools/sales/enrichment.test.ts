import { beforeEach, describe, expect, it, vi } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

const hunterMock = vi.fn();
const retrieveMock = vi.fn();

vi.mock("./client.ts", () => ({
  notion: { pages: { retrieve: retrieveMock } },
  hunter: hunterMock,
}));

const { find_email_for_lead, verify_email } = await import("./enrichment.ts");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("find_email_for_lead", () => {
  it("uses email-finder when a name is provided", async () => {
    hunterMock.mockResolvedValueOnce({
      data: {
        email: "alice@acme.com",
        score: 92,
        verification: { status: "valid" },
      },
    });
    const raw = await find_email_for_lead.execute!(
      { domain: "acme.com", full_name: "Alice Smith" },
      toolOpts,
    );
    const parsed = JSON.parse(raw as string);
    expect(parsed.email).toBe("alice@acme.com");
    expect(hunterMock).toHaveBeenCalledWith(
      "email-finder",
      expect.objectContaining({ domain: "acme.com", full_name: "Alice Smith" }),
    );
  });

  it("falls back to domain-search when only a domain is given", async () => {
    hunterMock.mockResolvedValueOnce({
      data: {
        organization: "Acme",
        emails: [{ value: "info@acme.com", type: "generic", confidence: 80 }],
      },
    });
    const raw = await find_email_for_lead.execute!({ domain: "https://acme.com/team" }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.organization).toBe("Acme");
    expect(parsed.emails[0].value).toBe("info@acme.com");
    expect(hunterMock).toHaveBeenCalledWith("domain-search", { domain: "acme.com", limit: "10" });
  });

  it("derives the domain from a Notion page's Website property", async () => {
    retrieveMock.mockResolvedValueOnce({
      id: "p1",
      properties: { Website: { type: "url", url: "https://www.acme.com/about" } },
    });
    hunterMock.mockResolvedValueOnce({ data: { organization: "Acme", emails: [] } });
    await find_email_for_lead.execute!({ page_id: "p1" }, toolOpts);
    expect(hunterMock).toHaveBeenCalledWith("domain-search", { domain: "acme.com", limit: "10" });
  });

  it("falls back to email-derived domain when Website is missing", async () => {
    retrieveMock.mockResolvedValueOnce({
      id: "p2",
      properties: { Email: { type: "email", email: "contact@beta.io" } },
    });
    hunterMock.mockResolvedValueOnce({ data: { organization: "Beta", emails: [] } });
    await find_email_for_lead.execute!({ page_id: "p2" }, toolOpts);
    expect(hunterMock).toHaveBeenCalledWith("domain-search", { domain: "beta.io", limit: "10" });
  });

  it("returns an error when no domain can be resolved", async () => {
    retrieveMock.mockResolvedValueOnce({ id: "p3", properties: {} });
    const raw = await find_email_for_lead.execute!({ page_id: "p3" }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.error).toMatch(/no domain/i);
    expect(hunterMock).not.toHaveBeenCalled();
  });
});

describe("verify_email", () => {
  it("forwards the email to the Hunter verifier and summarizes the response", async () => {
    hunterMock.mockResolvedValueOnce({
      data: { status: "valid", result: "deliverable", score: 99, disposable: false },
    });
    const raw = await verify_email.execute!({ email: "a@b.com" }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.status).toBe("valid");
    expect(parsed.result).toBe("deliverable");
    expect(hunterMock).toHaveBeenCalledWith("email-verifier", { email: "a@b.com" });
  });
});
