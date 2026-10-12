import { createHmac } from "node:crypto";

import { createAppAuth } from "@octokit/auth-app";
import { contextHash, hash } from "@repo/badges";
import type { BadgeStore, Publisher, Review } from "@repo/badges";
import { bearerMatches } from "@repo/shared/bearer";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { writePhackLink } from "@repo/shared/phack";
import { Octokit } from "octokit";
import { z } from "zod";

import { env } from "../../../agents/agent/env.ts";

const repository = { owner: "purduehackers", repo: "badge-designs" };
function client(): Octokit {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY || !env.GITHUB_APP_INSTALLATION_ID)
    throw new Error("GitHub App access to badge-designs is not configured.");
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
      installationId: env.GITHUB_APP_INSTALLATION_ID,
    },
    request: { timeout: 15_000 },
  });
}
const directory = (review: Review): string => {
  if (!review.event) throw new Error("No CMS event selected.");
  return `badges/${review.event.version}`;
};

async function files(review: Review, store: BadgeStore): Promise<Map<string, Uint8Array>> {
  const { badge, stamp, event, settings } = review;
  const reviewer = review.decisions.at(-1)?.reviewer;
  const layout = review.layouts.find((candidate) => candidate.id === review.selectedLayout);
  if (!badge || !stamp || !event || !settings || !reviewer || !layout)
    throw new Error("Review evidence is incomplete.");
  const content = new Map<string, Uint8Array>();
  const sources = new Map([
    ["badge-source.svg", badge.hash],
    ["stamp-source.svg", stamp.hash],
    ["badge.svg", review.manufacturing?.badge],
    ["stamp.svg", review.manufacturing?.stamp],
    ["badge.png", review.previews[0]],
    ["stamp.png", review.manufacturing?.stampPreview],
    ["12x12.svg", layout.sheets[0]],
    ["12x18.svg", layout.sheets[1]],
  ]);
  for (const [name, digest] of sources) {
    if (!digest) throw new Error(`Missing ${name} evidence.`);
    content.set(name, (await store.asset(digest)).bytes);
  }
  content.set(
    "metadata.json",
    Buffer.from(
      `${JSON.stringify({ cms: { id: event.id, slug: event.slug }, author: review.author, reviewer }, undefined, 2)}\n`,
    ),
  );
  content.set(
    "README.md",
    Buffer.from(
      `# ${event.name}\n\n## Badge\n\n![Badge](badge.png)\n\n[Download](badge.svg)\n\n## Stamp\n\n![Stamp](stamp.png)\n\n[Download](stamp.svg)\n`,
    ),
  );
  return content;
}

class GithubPublisher implements Publisher {
  private readonly repository: BadgeStore;
  constructor(repository: BadgeStore) {
    this.repository = repository;
  }
  async archive(review: Review) {
    const github = client(),
      prefix = directory(review),
      content = await files(review, this.repository);
    const branch = `wack/badge-${review.id}`;
    const repo = (await github.rest.repos.get(repository)).data;
    const base = repo.default_branch;
    const baseRef = (await github.rest.git.getRef({ ...repository, ref: `heads/${base}` })).data
      .object.sha;
    const references = (
      await github.rest.git.listMatchingRefs({ ...repository, ref: `heads/${branch}` })
    ).data;
    const previous = references.find((ref) => ref.ref === `refs/heads/${branch}`)?.object.sha;
    const parent = previous ?? baseRef;
    await assertEventIdentity(github, review, baseRef);
    const parentCommit = (await github.rest.git.getCommit({ ...repository, commit_sha: parent }))
      .data;
    const marker = `Badge review ${review.id}`;
    if (
      previous &&
      previous !== review.repositoryHead &&
      !ownCommit(review.id, parentCommit.tree.sha, parentCommit.message)
    )
      throw new Error(
        "The review branch was edited outside wack hacker. Reattach the revised SVGs in a new review thread so they are checked again.",
      );
    const tree = await github.rest.git.createTree({
      ...repository,
      base_tree: parentCommit.tree.sha,
      tree: await Promise.all(
        [...content].map(async ([name, bytes]) => ({
          path: `${prefix}/${name}`,
          mode: "100644" as const,
          type: "blob" as const,
          sha: (
            await github.rest.git.createBlob({
              ...repository,
              content: Buffer.from(bytes).toString("base64"),
              encoding: "base64",
            })
          ).data.sha,
        })),
      ),
    });
    const commit =
      tree.data.sha === parentCommit.tree.sha
        ? parent
        : (
            await github.rest.git.createCommit({
              ...repository,
              message: `${marker}: ${contextHash(review)}\n\nwack-signature: ${commitSignature(review.id, tree.data.sha)}`,
              tree: tree.data.sha,
              parents: [parent],
            })
          ).data.sha;
    if (!previous)
      await github.rest.git.createRef({
        ...repository,
        ref: `refs/heads/${branch}`,
        sha: commit,
      });
    else if (commit !== parent)
      await github.rest.git.updateRef({
        ...repository,
        ref: `heads/${branch}`,
        sha: commit,
        force: false,
      });
    const existing = (
      await github.rest.pulls.list({
        ...repository,
        head: `${repository.owner}:${branch}`,
        state: "open",
      })
    ).data[0];
    const pr =
      existing ??
      (
        await github.rest.pulls.create({
          ...repository,
          head: branch,
          base,
          title: review.event?.name ?? "Badge review",
          draft: true,
          body: `Reviewed in Discord: https://discord.com/channels/${DISCORD_GUILD_ID}/${review.threadId}\n\nEvidence context: \`${contextHash(review)}\`. Do not edit or merge this PR directly: the bot verifies its exact content and requires final approval in Discord.`,
        })
      ).data;
    return { number: pr.number, head: commit, url: pr.html_url };
  }
  async publish(review: Review) {
    if (!review.pr || !review.approval || !env.VERCEL_API_TOKEN)
      throw new Error("Publication approval or phack.rs configuration is missing.");
    const github = client(),
      prefix = directory(review);
    const pr = (await github.rest.pulls.get({ ...repository, pull_number: review.pr.number })).data;
    const repo = (await github.rest.repos.get(repository)).data;
    if (
      pr.base.ref !== repo.default_branch ||
      pr.head.ref !== `wack/badge-${review.id}` ||
      pr.head.repo?.full_name !== `${repository.owner}/${repository.repo}`
    )
      throw new Error("The GitHub PR no longer targets the reviewed repository and branches.");
    await assertEventIdentity(github, review, pr.base.ref);
    if (pr.head.sha !== review.approval.head)
      throw new Error(
        "The GitHub revision changed after approval. Start a new review with the changed SVGs.",
      );
    // Independently read back all reviewed bytes at the exact head before merging.
    const expectedFiles = await files(review, this.repository);
    await verifyFiles(github, prefix, pr.head.sha, expectedFiles);
    const expectedPaths = new Set([...expectedFiles.keys()].map((name) => `${prefix}/${name}`));
    const changed = await github.paginate(github.rest.pulls.listFiles, {
      ...repository,
      pull_number: pr.number,
      per_page: 100,
    });
    if (
      changed.some(
        (file) =>
          !expectedPaths.has(file.filename) ||
          (file.previous_filename && !file.previous_filename.startsWith(`${prefix}/`)),
      )
    )
      throw new Error("The PR contains changes outside this badge version.");
    let commit = pr.merge_commit_sha ?? undefined;
    if (!pr.merged) {
      if (pr.draft)
        await github.graphql(
          `mutation Ready($id: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $id}) { pullRequest { id } } }`,
          { id: pr.node_id },
        );
      const merged = await github.rest.pulls.merge({
        ...repository,
        pull_number: pr.number,
        sha: review.approval.head,
        merge_method: "squash",
      });
      if (!merged.data.merged) throw new Error("GitHub has not merged this badge revision.");
      commit = merged.data.sha;
    }
    if (!commit) throw new Error("GitHub has not supplied a publication receipt.");
    const url = `https://github.com/${repository.owner}/${repository.repo}/tree/${repoDefault(pr.base.ref)}/${prefix}`;
    const slug = `badge-${review.event?.version ?? ""}`;
    const linked = await writePhackLink({
      slug,
      destination: url,
      token: env.VERCEL_API_TOKEN,
      signal: AbortSignal.timeout(15_000),
    });
    if (linked.kind !== "created" && linked.kind !== "same")
      throw new Error(
        `GitHub merged ${commit}, but phack.rs could not be verified (${linked.kind}). Retry to reconcile; the bot will not overwrite an existing unrelated link.`,
      );
    const shortlink = `https://phack.rs/${slug}`;
    const redirect = await fetch(shortlink, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (redirect.status < 300 || redirect.status >= 400 || redirect.headers.get("location") !== url)
      throw new Error(
        `GitHub merged ${commit}; waiting for the live shortlink to point to the verified assets. Retry publication.`,
      );
    return { commit, url, shortlink };
  }
}
export function createPublisher(repository: BadgeStore): Publisher {
  return new GithubPublisher(repository);
}
function repoDefault(branch: string): string {
  return encodeURIComponent(branch);
}

async function verifyFiles(
  github: Octokit,
  prefix: string,
  head: string,
  expectedFiles: Map<string, Uint8Array>,
): Promise<void> {
  for (const [name, expected] of expectedFiles) {
    const response = await github.rest.repos.getContent({
      ...repository,
      path: `${prefix}/${name}`,
      ref: head,
    });
    const value = response.data;
    if (Array.isArray(value) || !("content" in value))
      throw new Error(`Repository evidence is not a file: ${name}.`);
    // Contents omits bytes above 1 MB; generated sheets can be larger.
    const content =
      value.encoding === "base64"
        ? value.content
        : (await github.rest.git.getBlob({ ...repository, file_sha: value.sha })).data.content;
    if (hash(Buffer.from(content, "base64")) !== hash(expected))
      throw new Error(`Repository evidence differs: ${name}.`);
  }
}

async function assertEventIdentity(github: Octokit, review: Review, ref: string): Promise<void> {
  try {
    const response = await github.rest.repos.getContent({
      ...repository,
      path: directory(review) + "/metadata.json",
      ref,
    });
    const value = response.data;
    if (Array.isArray(value) || !("content" in value))
      throw new Error("Existing badge metadata is not a file.");
    const meta = z
      .object({ cms: z.object({ id: z.string() }) })
      .parse(JSON.parse(Buffer.from(value.content, "base64").toString("utf8")));
    if (meta.cms.id !== review.event?.id)
      throw new Error(
        "This badge version belongs to a different CMS event. Resolve the event version before publishing.",
      );
  } catch (cause) {
    if (z.object({ status: z.literal(404) }).safeParse(cause).success) return;
    throw cause;
  }
}

function commitSignature(id: string, tree: string): string {
  return createHmac("sha256", env.AGENT_INGRESS_SECRET).update(`${id}:${tree}`).digest("hex");
}
function ownCommit(id: string, tree: string, message: string): boolean {
  const signature = /wack-signature: ([a-f0-9]{64})$/u.exec(message)?.[1];
  return bearerMatches(signature ? `Bearer ${signature}` : undefined, commitSignature(id, tree));
}
