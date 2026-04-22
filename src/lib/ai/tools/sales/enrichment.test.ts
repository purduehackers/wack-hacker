import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockFetch, notionClientClass, toolOpts } from "@/lib/test/fixtures";

const mocks = vi.hoisted(() => ({
  pagesRetrieve: vi.fn(),
}));

vi.mock("@notionhq/client", () => ({
  Client: notionClientClass({ pagesRetrieve: mocks.pagesRetrieve }),
}));

const { find_email_for_lead, verify_email } = await import("./enrichment.ts");

let hunterResponses: Array<(url: URL) => Response>;
let fetched: URL[];
let restoreFetch: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  hunterResponses = [];
  fetched = [];
  ({ restore: restoreFetch } = mockFetch((url) => {
    fetched.push(url);
    const next = hunterResponses.shift();
    if (!next) throw new Error(`Unstubbed Hunter request to ${url}`);
    return next(url);
  }));
});

afterEach(() => {
  restoreFetch();
});

function respondWith(body: unknown, status = 200): (url: URL) => Response {
  return () => new Response(JSON.stringify(body), { status });
}

function hunterPath(url: URL): string {
  return url.pathname.replace(/^\/v2\//, "");
}

describe("find_email_for_lead", () => {
  it("uses email-finder when a name is provided", async () => {
    hunterResponses.push(
      respondWith({
        data: {
          email: "alice@acme.com",
          score: 92,
          verification: { status: "valid" },
        },
      }),
    );
    const raw = await find_email_for_lead.execute!(
      { domain: "acme.com", full_name: "Alice Smith" },
      toolOpts,
    );
    const parsed = JSON.parse(raw as string);
    expect(parsed.email).toBe("alice@acme.com");
    expect(hunterPath(fetched[0])).toBe("email-finder");
    expect(fetched[0].searchParams.get("domain")).toBe("acme.com");
    expect(fetched[0].searchParams.get("full_name")).toBe("Alice Smith");
  });

  it("falls back to domain-search when only a domain is given", async () => {
    hunterResponses.push(
      respondWith({
        data: {
          organization: "Acme",
          emails: [{ value: "info@acme.com", type: "generic", confidence: 80 }],
        },
      }),
    );
    const raw = await find_email_for_lead.execute!({ domain: "https://acme.com/team" }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.organization).toBe("Acme");
    expect(parsed.emails[0].value).toBe("info@acme.com");
    expect(hunterPath(fetched[0])).toBe("domain-search");
    expect(fetched[0].searchParams.get("domain")).toBe("acme.com");
    expect(fetched[0].searchParams.get("limit")).toBe("10");
  });

  it("derives the domain from a Notion page's Website property", async () => {
    mocks.pagesRetrieve.mockResolvedValueOnce({
      id: "p1",
      properties: { Website: { type: "url", url: "https://www.acme.com/about" } },
    });
    hunterResponses.push(respondWith({ data: { organization: "Acme", emails: [] } }));
    await find_email_for_lead.execute!({ page_id: "p1" }, toolOpts);
    expect(fetched[0].searchParams.get("domain")).toBe("acme.com");
  });

  it("falls back to email-derived domain when Website is missing", async () => {
    mocks.pagesRetrieve.mockResolvedValueOnce({
      id: "p2",
      properties: { Email: { type: "email", email: "contact@beta.io" } },
    });
    hunterResponses.push(respondWith({ data: { organization: "Beta", emails: [] } }));
    await find_email_for_lead.execute!({ page_id: "p2" }, toolOpts);
    expect(fetched[0].searchParams.get("domain")).toBe("beta.io");
  });

  it("returns an error when no domain can be resolved", async () => {
    mocks.pagesRetrieve.mockResolvedValueOnce({ id: "p3", properties: {} });
    const raw = await find_email_for_lead.execute!({ page_id: "p3" }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.error).toMatch(/no domain/i);
    expect(fetched).toHaveLength(0);
  });
});

describe("verify_email", () => {
  it("forwards the email to the Hunter verifier and summarizes the response", async () => {
    hunterResponses.push(
      respondWith({
        data: { status: "valid", result: "deliverable", score: 99, disposable: false },
      }),
    );
    const raw = await verify_email.execute!({ email: "a@b.com" }, toolOpts);
    const parsed = JSON.parse(raw as string);
    expect(parsed.status).toBe("valid");
    expect(parsed.result).toBe("deliverable");
    expect(hunterPath(fetched[0])).toBe("email-verifier");
    expect(fetched[0].searchParams.get("email")).toBe("a@b.com");
  });
});
