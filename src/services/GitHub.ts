import { Octokit } from "@octokit/rest";
import { Duration, Effect, Redacted } from "effect";

import { AppConfig } from "../config";
import { GitHubError } from "../errors";

export class GitHub extends Effect.Service<GitHub>()("GitHub", {
    dependencies: [AppConfig.Default],
    scoped: Effect.gen(function* () {
        const config = yield* AppConfig;
        const octokit = new Octokit({ auth: Redacted.value(config.GITHUB_TOKEN) });

        const getAssociations = Effect.fn("GitHub.getAssociations")(function* () {
            yield* Effect.logDebug("github api request initiated", {
                service_name: "GitHub",
                method: "getAssociations",
                operation_type: "api_request",
                repository: "purduehackers/dark-forest",
                path: "people/associations.json",
                ref: "main",
            });

            const [duration, response] = yield* Effect.tryPromise({
                try: () =>
                    octokit.rest.repos.getContent({
                        owner: "purduehackers",
                        repo: "dark-forest",
                        path: "people/associations.json",
                        ref: "main",
                    }),
                catch: (e) => new GitHubError({ operation: "getAssociations", cause: e }),
            }).pipe(Effect.timed);

            const duration_ms = Duration.toMillis(duration);

            yield* Effect.annotateCurrentSpan({ 
                duration_ms,
                http_status: response.status,
            });

            yield* Effect.logInfo("github api request completed", {
                service_name: "GitHub",
                method: "getAssociations",
                operation_type: "api_request",
                repository: "purduehackers/dark-forest",
                path: "people/associations.json",
                ref: "main",
                duration_ms,
                latency_ms: duration_ms,
                http_status: response.status,
            });

            if (response.status !== 200 || (response.data as { type?: string }).type !== "file") {
                yield* Effect.logError("github api request failed", {
                    service_name: "GitHub",
                    method: "getAssociations",
                    operation_type: "api_request",
                    repository: "purduehackers/dark-forest",
                    path: "people/associations.json",
                    http_status: response.status,
                    error_type: "invalid_response",
                    duration_ms,
                });

                return yield* Effect.fail(
                    new GitHubError({
                        operation: "getAssociations",
                        cause: new Error("Failed to fetch associations file"),
                    }),
                );
            }

            const content = Buffer.from(
                (response.data as { content: string }).content,
                "base64",
            ).toString("utf-8");

            const associations = JSON.parse(content) as Record<string, string>;
            const association_count = Object.keys(associations).length;

            yield* Effect.annotateCurrentSpan({ association_count });

            yield* Effect.logDebug("associations parsed", {
                service_name: "GitHub",
                method: "getAssociations",
                operation_type: "api_request",
                association_count,
                content_size_bytes: content.length,
            });

            return associations;
        });

        const createIssue = Effect.fn("GitHub.createIssue")(function* (
            title: string,
            body: string,
            assignees: string[],
        ) {
            const uniqueAssignees = Array.from(new Set(assignees));

            yield* Effect.annotateCurrentSpan({
                repository: "purduehackers/evergreen",
                assignee_count: uniqueAssignees.length,
                title_length: title.length,
                body_length: body.length,
            });

            yield* Effect.logDebug("github api request initiated", {
                service_name: "GitHub",
                method: "createIssue",
                operation_type: "api_request",
                repository: "purduehackers/evergreen",
                assignee_count: uniqueAssignees.length,
                title_length: title.length,
                body_length: body.length,
            });

            const [duration, response] = yield* Effect.tryPromise({
                try: () =>
                    octokit.request("POST /repos/purduehackers/evergreen/issues", {
                        owner: "purduehackers",
                        repo: "evergreen",
                        title,
                        body,
                        assignees: uniqueAssignees,
                    }),
                catch: (e) => new GitHubError({ operation: "createIssue", cause: e }),
            }).pipe(Effect.timed);

            const duration_ms = Duration.toMillis(duration);

            yield* Effect.annotateCurrentSpan({ 
                duration_ms,
                http_status: response.status,
            });

            if (response.status !== 201) {
                yield* Effect.logError("github api request failed", {
                    service_name: "GitHub",
                    method: "createIssue",
                    operation_type: "api_request",
                    repository: "purduehackers/evergreen",
                    http_status: response.status,
                    error_type: "create_failed",
                    duration_ms,
                    latency_ms: duration_ms,
                });

                return yield* Effect.fail(
                    new GitHubError({
                        operation: "createIssue",
                        cause: new Error("Failed to create issue"),
                    }),
                );
            }

            yield* Effect.logInfo("github issue created", {
                service_name: "GitHub",
                method: "createIssue",
                operation_type: "api_request",
                repository: "purduehackers/evergreen",
                issue_url: response.data.html_url,
                assignee_count: uniqueAssignees.length,
                title_length: title.length,
                body_length: body.length,
                duration_ms,
                latency_ms: duration_ms,
                http_status: response.status,
            });

            return { html_url: response.data.html_url };
        });

        return { getAssociations, createIssue } as const;
    }).pipe(Effect.annotateLogs({ service: "GitHub" })),
}) {}

/** @deprecated Use GitHub.Default instead */
export const GitHubLive = GitHub.Default;
