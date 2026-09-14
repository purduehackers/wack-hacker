import { messageOf, Transient, UpstreamError } from "@repo/shared/errors";
import { jsonCodec } from "@repo/shared/json";
import { Result } from "@repo/shared/result";
import { sliceText } from "@repo/shared/text";
import type { APIEmbed } from "discord.js";
import { z } from "zod";

const MAX_PREVIEWS = 3;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_LINES = 30;
const MAX_CODE_CHARS = 1_400;
const MAX_EMBED_CHARS = 6_000 / MAX_PREVIEWS;
const REQUEST_TIMEOUT_MS = 5_000;
const RAW_MEDIA_TYPE = "application/vnd.github.raw+json";
const MAX_CACHED_FILES = 32;
const MAX_CACHED_CHARS = 2 * 1024 * 1024; // At most 4 MiB of UTF-16 source.

const publicRepository = jsonCodec(
  z.object({ private: z.literal(false), visibility: z.literal("public") }),
);

export interface GitHubCodeLink {
  readonly url: string;
  readonly repository: string;
  /** Ref and path stay together because branch names can contain slashes. */
  readonly blobPath: string;
  readonly startLine: number;
  readonly endLine: number;
}

function parseLink(value: string): GitHubCodeLink | undefined {
  const url = URL.parse(value.replace(/[)\].,;!]+$/, ""));
  if (!url || url.origin !== "https://github.com" || url.username !== "" || url.password !== "")
    return undefined;

  const path = /^\/([\w-]{1,39})\/([\w.-]{1,100})\/blob\/(.+)$/.exec(url.pathname);
  const range = /^#L(\d+)(?:-L(\d+))?$/.exec(url.hash);
  const [, owner, repo, blobPath] = path ?? [];
  if (!owner || !repo || !blobPath || !range) return undefined;
  if (repo === "." || repo === ".." || !blobPath.includes("/")) return undefined;

  const startLine = Number(range[1]);
  const endLine = Number(range[2] ?? range[1]);
  if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine)) return undefined;
  if (startLine < 1 || endLine < startLine) return undefined;

  const decoded = Result.try(() => decodeURIComponent(blobPath));
  if (Result.isError(decoded)) return undefined;
  if (
    decoded.value
      .split("")
      .some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    return undefined;
  if (decoded.value.split("/").some((part) => part === "" || part === "." || part === ".."))
    return undefined;

  const repository = `${owner}/${repo}`;
  const anchor = startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`;
  return {
    url: `https://github.com/${repository}/blob/${blobPath}#${anchor}`,
    repository,
    blobPath,
    startLine,
    endLine,
  };
}

export function findGitHubCodeLinks(content: string): GitHubCodeLink[] {
  const visible = content.replace(/(`+)[\s\S]*?\1|<https?:\/\/[^>]+>/g, "");
  const unique = new Map<string, GitHubCodeLink>();
  for (const match of visible.matchAll(/https?:\/\/[^\s<>`]+/gi)) {
    const link = parseLink(match[0]);
    if (link) unique.set(link.url, link);
    if (unique.size === MAX_PREVIEWS) break;
  }
  return [...unique.values()];
}

/** Bound the stream, not just Content-Length, which may be missing or compressed. */
async function readText(response: Response): Promise<string | undefined> {
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_FILE_BYTES) return undefined;
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }

  const decoded = Result.try(() =>
    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
  );
  if (Result.isError(decoded) || decoded.value.includes("\u0000")) return undefined;
  return decoded.value;
}

const LANGUAGES = new Map([
  ["js", "javascript"],
  ["mjs", "javascript"],
  ["cjs", "javascript"],
  ["ts", "typescript"],
  ["py", "python"],
  ["rb", "ruby"],
  ["rs", "rust"],
  ["sh", "bash"],
  ["yml", "yaml"],
  ["md", "markdown"],
  ["kt", "kotlin"],
  ["cs", "csharp"],
]);

export function buildGitHubCodeEmbed(link: GitHubCodeLink, source: string): APIEmbed | undefined {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (link.endLine > lines.length) return undefined;

  const lastLine = Math.min(link.endLine, link.startLine + MAX_LINES - 1);
  const code = lines
    .slice(link.startLine - 1, lastLine)
    .join("\n")
    // Prevent source fences from closing the Discord code block.
    .replace(/`{3,}/g, (run) => run.split("").join("\u200b"));
  const extension = link.blobPath.split(".").at(-1)?.toLowerCase() ?? "";
  const language = LANGUAGES.get(extension) ?? (/^[a-z]{1,12}$/.test(extension) ? extension : "");
  const range =
    link.startLine === link.endLine ? `:${link.startLine}` : `:${link.startLine}-${link.endLine}`;
  // Only a full commit SHA gives us an unambiguous ref/path boundary. Preserve
  // branch and tag refs rather than mistake part of a slash-containing ref for a directory.
  const path = decodeURIComponent(link.blobPath.replace(/^[a-f\d]{40}\//i, ""));
  const title = `${sliceText(path, 256 - range.length)}${range}`;
  const footer = `${link.repository} | Added by GitHub`;
  const truncated = lastLine < link.endLine || code.length > MAX_CODE_CHARS;
  const more = truncated ? `\n[Show more…](<${link.url}>)` : "";
  // Three previews share Discord's 6,000-character embed budget. Long source
  // links in the description count toward it, unlike the embed's title URL.
  const budget = Math.min(
    MAX_CODE_CHARS,
    MAX_EMBED_CHARS - title.length - footer.length - language.length - more.length - 10,
  );
  if (budget < 1) return undefined;
  const snippet = truncated ? `${sliceText(code, budget)}\n…` : code;

  return {
    color: 0x24292f,
    title,
    url: link.url,
    description: `\`\`\`${language}\n${snippet}\n\`\`\`${more}`,
    footer: {
      text: footer,
      icon_url: "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
    },
  };
}

type GitHubCodeError = Transient | UpstreamError;
type GitHubRequest = (url: string, init: RequestInit) => Promise<Response>;

interface TextResponse {
  readonly text: string;
  readonly etag: string | undefined;
}

async function fetchText(
  request: GitHubRequest,
  url: string,
  signal: AbortSignal,
  options: { readonly accept?: string; readonly cached?: TextResponse } = {},
): Promise<TextResponse | undefined> {
  const { cached } = options;
  const response = await request(url, {
    headers: {
      Accept: options.accept ?? "application/vnd.github+json",
      "User-Agent": "wack-hacker-code-preview",
      ...(cached?.etag === undefined ? {} : { "If-None-Match": cached.etag }),
    },
    credentials: "omit",
    redirect: "error",
    signal,
  });
  // Only a successful conditional request authorizes reuse of cached code.
  if (response.status === 304 && cached?.etag !== undefined) {
    await response.body?.cancel();
    return cached;
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 404) return undefined;
    const limits = ["retry-after", "x-ratelimit-remaining", "x-ratelimit-reset"]
      .flatMap((name) => {
        const value = response.headers.get(name);
        return value === null ? [] : [`${name}=${value}`];
      })
      .join(", ");
    throw new UpstreamError({
      service: "github-code",
      status: response.status,
      detail: `code preview request failed${limits ? `; ${limits}` : ""}`,
    });
  }
  // Directory listings use JSON even when the raw media type is requested.
  if (
    options.accept === RAW_MEDIA_TYPE &&
    response.headers.get("content-type")?.split(";")[0] !== RAW_MEDIA_TYPE
  ) {
    await response.body?.cancel();
    return undefined;
  }
  const text = await readText(response);
  return text === undefined ? undefined : { text, etag: response.headers.get("etag") ?? undefined };
}

function cacheSource(cache: Map<string, TextResponse>, key: string, value: TextResponse) {
  cache.set(key, value);
  let characters = 0;
  for (const entry of cache.values()) characters += entry.text.length;
  for (const [oldest, entry] of cache) {
    if (cache.size <= MAX_CACHED_FILES && characters <= MAX_CACHED_CHARS) break;
    cache.delete(oldest);
    characters -= entry.text.length;
  }
}

async function fetchBranch(request: GitHubRequest, link: GitHubCodeLink) {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
  const metadata = fetchText(request, `https://api.github.com/repos/${link.repository}`, signal);
  // Settle early download failures while the public visibility check is pending.
  const download = Result.tryPromise({
    try: () =>
      fetchText(
        request,
        `https://raw.githubusercontent.com/${link.repository}/${link.blobPath}`,
        signal,
      ),
    catch: (cause) => cause,
  });
  try {
    const repository = await metadata;
    if (!repository || !publicRepository.safeParse(repository.text).success) return undefined;
    const result = await download;
    if (Result.isError(result)) throw result.error;
    return result.value?.text;
  } finally {
    controller.abort();
  }
}

export function createGitHubCodeClient(deps: { readonly request?: GitHubRequest } = {}) {
  const request = deps.request ?? fetch;
  const cache = new Map<string, TextResponse>();
  const pending = new Map<string, Promise<Result<string | undefined, GitHubCodeError>>>();

  return {
    preview: async (link: GitHubCodeLink) => {
      const key = `${link.repository.toLowerCase()}/${link.blobPath}`;
      let loading = pending.get(key);
      if (!loading) {
        loading = Result.tryPromise({
          try: async () => {
            const [, commit, path] = /^([a-f\d]{40})\/(.+)$/i.exec(link.blobPath) ?? [];
            if (!commit || !path) return fetchBranch(request, link);

            // Anonymous contents requests establish public access and retrieve code together.
            const cached = cache.get(key);
            cache.delete(key);
            const file = await fetchText(
              request,
              `https://api.github.com/repos/${link.repository}/contents/${path}?ref=${commit}`,
              AbortSignal.timeout(REQUEST_TIMEOUT_MS),
              { accept: RAW_MEDIA_TYPE, ...(cached && { cached }) },
            );
            if (file?.etag !== undefined) cacheSource(cache, key, file);
            return file?.text;
          },
          catch: (cause) =>
            cause instanceof UpstreamError
              ? cause
              : new Transient({ operation: "fetch GitHub code preview", detail: messageOf(cause) }),
        }).finally(() => pending.delete(key));
        pending.set(key, loading);
      }
      return Result.map(await loading, (source) =>
        source === undefined ? undefined : buildGitHubCodeEmbed(link, source),
      );
    },
  };
}

export type GitHubCodeClient = ReturnType<typeof createGitHubCodeClient>;
