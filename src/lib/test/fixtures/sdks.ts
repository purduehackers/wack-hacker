import { vi, type Mock } from "vitest";

import type { NotionClientMocks } from "../types";

/**
 * Shared class builders for stubbing third-party SDKs. Keep SDK-shape
 * knowledge here so individual test files don't need to rediscover which
 * property lives under which sub-object.
 *
 * Pattern — because `vi.mock` is hoisted above module-scope declarations,
 * mock fns must live inside `vi.hoisted(() => ...)` and the builder call goes
 * *inside* the `vi.mock` factory. Example:
 *
 * ```ts
 * const mocks = vi.hoisted(() => ({ query: vi.fn(), pagesRetrieve: vi.fn() }));
 *
 * vi.mock("@notionhq/client", () => ({
 *   Client: notionClientClass({
 *     dataSourcesQuery: mocks.query,
 *     pagesRetrieve: mocks.pagesRetrieve,
 *   }),
 * }));
 *
 * // In tests:
 * mocks.query.mockResolvedValueOnce({ results: [] });
 * ```
 */

/** Build a Notion `Client` mock class. Call inside `vi.mock("@notionhq/client", ...)`. */
export function notionClientClass(mocks: NotionClientMocks = {}) {
  return class MockNotionClient {
    dataSources = {
      query: mocks.dataSourcesQuery ?? vi.fn(),
      retrieve: mocks.dataSourcesRetrieve ?? vi.fn(),
    };
    pages = {
      retrieve: mocks.pagesRetrieve ?? vi.fn(),
      update: mocks.pagesUpdate ?? vi.fn(),
      create: mocks.pagesCreate ?? vi.fn(),
    };
    users = { list: mocks.usersList ?? vi.fn() };
    databases = { retrieve: mocks.databasesRetrieve ?? vi.fn() };
    search = mocks.search ?? vi.fn();
  };
}

/** Build a Resend mock class. Call inside `vi.mock("resend", ...)`. */
export function resendClass(mocks: { send?: Mock } = {}) {
  return class MockResend {
    emails = { send: mocks.send ?? vi.fn() };
  };
}

/** Build a Linear SDK mock class. Call inside `vi.mock("@linear/sdk", ...)`. */
export function linearClientClass() {
  return class MockLinearClient {
    issues = vi.fn();
    projects = vi.fn();
    teams = vi.fn();
    users = vi.fn();
    searchIssues = vi.fn();
    searchProjects = vi.fn();
    searchDocuments = vi.fn();
  };
}

/** Build an Octokit mock class. Call inside `vi.mock("octokit", ...)`. */
export function octokitClass() {
  return class MockOctokit {
    rest = {
      repos: { listForOrg: vi.fn(), get: vi.fn() },
      search: { code: vi.fn(), issuesAndPullRequests: vi.fn() },
    };
  };
}

/** Build a `@discordjs/rest` REST mock class with a no-op `setToken`. */
export function discordRESTClass() {
  return class MockREST {
    setToken(_: string) {
      return this;
    }
  };
}

/** Svix `Webhook` + `WebhookVerificationError` stubs. Call inside `vi.mock("svix", ...)`. */
export function svixMocks(mocks: { verify?: Mock } = {}) {
  const verify = mocks.verify ?? vi.fn();

  class WebhookVerificationError extends Error {}
  class Webhook {
    verify(body: string, headers: Record<string, string>) {
      return verify(body, headers);
    }
  }

  return { Webhook, WebhookVerificationError };
}
