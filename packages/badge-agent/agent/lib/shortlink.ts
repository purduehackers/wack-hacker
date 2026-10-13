import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

const projectId = "prj_siLSuMS1YxYL6rz9MEHVQSXtBzza";
const teamId = "team_kOQWJUQYzGW4blWthdK71Y8A";
const version = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string().optional(),
  isLive: z.boolean().optional(),
  isStaging: z.boolean().optional(),
});
const versions = z.object({ versions: z.array(version) });
const redirect = z.looseObject({
  source: z.string(),
  destination: z.string(),
  statusCode: z.number().optional(),
});
const page = z.object({
  redirects: z.array(redirect),
  pagination: z.object({ numPages: z.int().nonnegative() }).optional(),
});

async function api(token: string, route: string, init?: RequestInit): Promise<unknown> {
  const url = new URL(`https://api.vercel.com/v1/bulk-redirects${route}`);
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("teamId", teamId);
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(
      `Badge redirect API returned ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  return response.json();
}

async function redirects(token: string, id: string) {
  const all: z.output<typeof redirect>[] = [];
  let count = 1;
  for (let index = 1; index <= count; index++) {
    const result = page.parse(
      await api(token, `?versionId=${encodeURIComponent(id)}&page=${index}&per_page=100`),
    );
    all.push(...result.redirects);
    count = result.pagination?.numPages ?? 1;
    if (count > 10) throw new Error("Badge redirect verification exceeds its page limit.");
  }
  return all;
}

/** Global Config keys cannot contain dots. Badge paths use Vercel project redirects. */
export async function writeBadgeLink(slug: string, destination: string, token: string) {
  const path = `/${z
    .string()
    .regex(/^badge-\d+\.\d+$/u)
    .parse(slug)}`;
  const shortlink = `https://phack.rs${path}`;
  const existing = await fetch(shortlink, {
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  if (
    existing.status >= 300 &&
    existing.status < 400 &&
    existing.headers.get("location") === destination
  )
    return;
  if (existing.status !== 404) throw new Error("The badge shortlink already has another response.");

  const before = versions.parse(await api(token, "/versions")).versions;
  const live = before.find((candidate) => candidate.isLive);
  const pending = before.find((candidate) => candidate.isStaging);
  const name = `wack ${slug}`;
  if (pending && pending.name !== name)
    throw new Error(
      "Another redirect change is staged. Finish it before publishing this badge link.",
    );
  const original = live ? await redirects(token, live.id) : [];
  const current = original.find((item) => item.source === path);
  if (current) {
    if (current.destination === destination) return;
    throw new Error("The badge shortlink already points somewhere else.");
  }
  const staged =
    pending ??
    z.object({ version }).parse(
      await api(token, "", {
        method: "PUT",
        body: JSON.stringify({
          projectId,
          teamId,
          name,
          overwrite: false,
          redirects: [{ source: path, destination, statusCode: 307, caseSensitive: true }],
        }),
      }),
    ).version;
  const proposed = await redirects(token, staged.id);
  const added = proposed.filter((item) => item.source === path);
  if (
    proposed.length !== original.length + 1 ||
    added.length !== 1 ||
    added[0]?.destination !== destination ||
    added[0]?.statusCode !== 307 ||
    original.some(
      (item) =>
        !isDeepStrictEqual(
          item,
          proposed.find((other) => other.source === item.source),
        ),
    )
  )
    throw new Error("The staged redirects contain changes beyond this badge link.");
  const latest = versions.parse(await api(token, "/versions")).versions;
  if (
    latest.find((candidate) => candidate.isLive)?.id !== live?.id ||
    latest.find((candidate) => candidate.isStaging)?.id !== staged.id
  )
    throw new Error("The redirect version changed during verification. Retry the badge link.");
  const promoted = z.object({ version }).parse(
    await api(token, "/versions", {
      method: "POST",
      body: JSON.stringify({ id: staged.id, action: "promote" }),
    }),
  );
  if (promoted.version.key !== staged.key)
    throw new Error("Vercel has not confirmed the badge redirect publication.");
}
