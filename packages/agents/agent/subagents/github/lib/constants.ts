/**
 * @fileoverview Configuration, plus every input field more than one tool
 * declares.
 *
 * GitHub scopes almost everything to one organization and one repository, and
 * the owner half is never a tool input. It comes from `env.GITHUB_ORG`, so a
 * model only ever names the repo. Declaring the shared fields once is what
 * keeps the description a model reads identical in all 119 tools rather than
 * drifting per module.
 */

import { z } from "zod";

import { env as runtimeEnv } from "../../../env.ts";

/** Typed SDK configuration. The domain runtime denies execution before anything reads these fallbacks. */
export const env = {
  GITHUB_APP_ID: runtimeEnv.GITHUB_APP_ID ?? "",
  GITHUB_APP_PRIVATE_KEY: runtimeEnv.GITHUB_APP_PRIVATE_KEY ?? "",
  GITHUB_APP_INSTALLATION_ID: runtimeEnv.GITHUB_APP_INSTALLATION_ID ?? "",
  GITHUB_ORG: runtimeEnv.GITHUB_ORG ?? "",
};

export const perPageField = z.int().min(1).max(100).optional().describe("Page size (default 50)");

const pageField = z.int().min(1).optional().describe("Page number (default 1)");

/** Offset-style pagination. Spread into a tool's `z.strictObject({...})`. */
export const paginationInputShape = {
  per_page: perPageField,
  page: pageField,
};

/**
 * A repository name inside the managed organization — the owner half is always
 * supplied from configuration, so the model only ever names the repo. GitHub
 * restricts these to ASCII letters, digits, `.`, `-` and `_`, up to 100 chars.
 */
export const repoName = z.stringFormat("github-repo-name", /^[A-Za-z0-9._-]{1,100}$/u);

export const repoField = repoName.describe("Repository name");

/** `repo` plus offset pagination — the shape every repository listing tool shares. */
export const repoPaginatedInputShape = {
  repo: repoField,
  ...paginationInputShape,
};

/** A GitHub numeric resource id (issue, run, release, hook, …). */
export const resourceId = z.int().positive();

/**
 * A calendar date or a full timestamp. GitHub documents these fields as ISO
 * 8601 timestamps but accepts the date-only spelling too, so both decode and
 * neither reaches the API as an unvalidated string.
 */
export const isoDateOrDateTime = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Workflows are addressable by their numeric id or by their file name. */
export const workflowRef = z.union([resourceId, z.string().min(1)]);

export const runId = resourceId.describe("Workflow run ID");

/**
 * Names Actions accepts for a secret or a variable: alphanumerics and
 * underscores, never leading with a digit.
 */
const actionsName = z.stringFormat("github-actions-name", /^[A-Za-z_][A-Za-z0-9_]*$/u);

export const secretName = actionsName.describe("Secret name");

export const variableName = actionsName.describe("Variable name");

export const visibilityField = z
  .enum(["all", "private", "selected"])
  .describe("Repository visibility scope");

export const selectedRepositoryIds = z
  .array(resourceId)
  .exactOptional()
  .describe("Repo IDs (required when visibility is 'selected')");

// ---------------------------------------------------------------------------
// Git objects
// ---------------------------------------------------------------------------

export const branchName = z.string().min(1).describe("Branch name");

export const commitSha = z.stringFormat("git-object-sha", /^[0-9a-fA-F]{40}$/u);

// ---------------------------------------------------------------------------
// Issues, pull requests, and their comments
// ---------------------------------------------------------------------------

export const issueNumber = resourceId.describe("Issue number");

export const commentId = resourceId.describe("Comment ID");

export const pullNumber = resourceId.describe("PR number");

/** `repo` plus the PR number and offset pagination — the shape every PR listing shares. */
export const pullPaginatedInputShape = {
  repo: repoField,
  pull_number: pullNumber,
  ...paginationInputShape,
};

export const reactionSchema = z
  .enum(["+1", "-1", "laugh", "confused", "heart", "hooray", "rocket", "eyes"])
  .describe("Reaction emoji");

// ---------------------------------------------------------------------------
// Organization, teams, and webhooks
// ---------------------------------------------------------------------------

export const username = z.string().min(1).describe("GitHub username");

export const teamSlug = z.string().min(1).describe("Team slug");

export const hookId = resourceId.describe("Webhook ID");

export const webhookUrl = z.url({ protocol: /^https?$/u }).describe("Webhook payload URL");

// ---------------------------------------------------------------------------
// Environments, packages, and releases
// ---------------------------------------------------------------------------

export const environmentName = z.string().min(1).describe("Environment name");

export const packageTypeSchema = z.enum([
  "npm",
  "maven",
  "rubygems",
  "docker",
  "nuget",
  "container",
]);

export const packageName = z.string().min(1).describe("Package name");

export const releaseId = resourceId.describe("Release ID");
