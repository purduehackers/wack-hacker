import { z } from "zod";

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
