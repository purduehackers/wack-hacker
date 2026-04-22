import { beforeEach, describe, expect, it, vi } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

const aliases = {
  listAliases: vi.fn(),
  getAlias: vi.fn(),
  listDeploymentAliases: vi.fn(),
  assignAlias: vi.fn(),
  deleteAlias: vi.fn(),
};
const domains = {
  getDomains: vi.fn(),
  getDomain: vi.fn(),
  getDomainConfig: vi.fn(),
  deleteDomain: vi.fn(),
};
const dns = {
  getRecords: vi.fn(),
  removeRecord: vi.fn(),
};
const registrar = {
  getSupportedTlds: vi.fn(),
  getDomainAvailability: vi.fn(),
  getDomainPrice: vi.fn(),
  getDomainAuthCode: vi.fn(),
  getDomainTransferIn: vi.fn(),
  getOrder: vi.fn(),
};
const certs = {
  getCertById: vi.fn(),
  issueCert: vi.fn(),
  removeCert: vi.fn(),
};

vi.mock("./client.ts", () => ({
  vercel: () => ({
    aliases,
    domains,
    dns,
    domainsRegistrar: registrar,
    certs,
  }),
}));

vi.mock("./constants.ts", () => ({
  VERCEL_TEAM_ID: "team_test",
  VERCEL_TEAM_SLUG: "purduehackers",
  VERCEL_DASHBOARD_BASE: "https://vercel.com/purduehackers",
}));

const mod = await import("./domains.ts");

beforeEach(() => {
  for (const group of [aliases, domains, dns, registrar, certs]) {
    for (const fn of Object.values(group)) fn.mockReset();
  }
});

describe("aliases", () => {
  it("list_aliases", async () => {
    aliases.listAliases.mockResolvedValueOnce({ aliases: [] });
    await mod.list_aliases.execute!({ domain: "example.com", limit: 5 }, toolOpts);
    expect(aliases.listAliases).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: "team_test", domain: "example.com", limit: 5 }),
    );
  });

  it("get_alias", async () => {
    aliases.getAlias.mockResolvedValueOnce({ uid: "a_1" });
    await mod.get_alias.execute!({ id_or_alias: "a_1" }, toolOpts);
    expect(aliases.getAlias).toHaveBeenCalledWith(expect.objectContaining({ idOrAlias: "a_1" }));
  });

  it("list_deployment_aliases", async () => {
    aliases.listDeploymentAliases.mockResolvedValueOnce({});
    await mod.list_deployment_aliases.execute!({ deployment_id: "dpl_1" }, toolOpts);
    expect(aliases.listDeploymentAliases).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dpl_1" }),
    );
  });

  it("assign_alias", async () => {
    aliases.assignAlias.mockResolvedValueOnce({ uid: "a_1" });
    await mod.assign_alias.execute!(
      { deployment_id: "dpl_1", alias: "staging.example.com" },
      toolOpts,
    );
    expect(aliases.assignAlias).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "dpl_1",
        requestBody: expect.objectContaining({ alias: "staging.example.com" }),
      }),
    );
  });

  it("delete_alias", async () => {
    aliases.deleteAlias.mockResolvedValueOnce({});
    await mod.delete_alias.execute!({ id_or_alias: "a_1" }, toolOpts);
    expect(aliases.deleteAlias).toHaveBeenCalledWith(expect.objectContaining({ aliasId: "a_1" }));
  });
});

describe("domains", () => {
  it("list", async () => {
    domains.getDomains.mockResolvedValueOnce({ domains: [] });
    await mod.list_domains.execute!({ limit: 5 }, toolOpts);
    expect(domains.getDomains).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }));
  });

  it("get", async () => {
    domains.getDomain.mockResolvedValueOnce({ name: "x.com" });
    await mod.get_domain.execute!({ domain: "x.com" }, toolOpts);
    expect(domains.getDomain).toHaveBeenCalledWith(expect.objectContaining({ domain: "x.com" }));
  });

  it("config", async () => {
    domains.getDomainConfig.mockResolvedValueOnce({});
    await mod.get_domain_config.execute!({ domain: "x.com" }, toolOpts);
    expect(domains.getDomainConfig).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "x.com" }),
    );
  });

  it("delete", async () => {
    domains.deleteDomain.mockResolvedValueOnce({});
    await mod.delete_domain.execute!({ domain: "x.com" }, toolOpts);
    expect(domains.deleteDomain).toHaveBeenCalled();
  });
});

describe("dns", () => {
  it("list records", async () => {
    dns.getRecords.mockResolvedValueOnce({ records: [] });
    await mod.list_dns_records.execute!({ domain: "x.com" }, toolOpts);
    expect(dns.getRecords).toHaveBeenCalledWith(expect.objectContaining({ domain: "x.com" }));
  });

  it("remove record", async () => {
    dns.removeRecord.mockResolvedValueOnce({});
    await mod.remove_dns_record.execute!({ domain: "x.com", record_id: "r_1" }, toolOpts);
    expect(dns.removeRecord).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "x.com", recordId: "r_1" }),
    );
  });
});

describe("registrar", () => {
  it("availability", async () => {
    registrar.getDomainAvailability.mockResolvedValueOnce({ available: true });
    await mod.check_domain_availability.execute!({ domain: "x.com" }, toolOpts);
    expect(registrar.getDomainAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "x.com" }),
    );
  });

  it("price", async () => {
    registrar.getDomainPrice.mockResolvedValueOnce({ price: 1000 });
    await mod.get_domain_price.execute!({ domain: "x.com" }, toolOpts);
    expect(registrar.getDomainPrice).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "x.com" }),
    );
  });

  it("auth code", async () => {
    registrar.getDomainAuthCode.mockResolvedValueOnce({ authCode: "abc" });
    await mod.get_domain_auth_code.execute!({ domain: "x.com" }, toolOpts);
    expect(registrar.getDomainAuthCode).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "x.com" }),
    );
  });

  it("supported TLDs", async () => {
    registrar.getSupportedTlds.mockResolvedValueOnce([]);
    await mod.list_supported_tlds.execute!({}, toolOpts);
  });
});

describe("certs", () => {
  it("issue", async () => {
    certs.issueCert.mockResolvedValueOnce({ id: "c_1" });
    await mod.issue_cert.execute!({ cns: ["x.com", "www.x.com"] }, toolOpts);
    expect(certs.issueCert).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: { cns: ["x.com", "www.x.com"] } }),
    );
  });

  it("remove", async () => {
    certs.removeCert.mockResolvedValueOnce({});
    await mod.remove_cert.execute!({ cert_id: "c_1" }, toolOpts);
    expect(certs.removeCert).toHaveBeenCalledWith(expect.objectContaining({ id: "c_1" }));
  });
});
