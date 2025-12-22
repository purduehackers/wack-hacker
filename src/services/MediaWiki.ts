import { Duration, Effect, Redacted } from "effect";

import { AppConfig } from "../config";
import { EVERGREEN_WIKI_URL, EVERGREEN_WIKI_USER, EVERGREEN_WIKI_ENDPOINT } from "../constants";
import { MediaWikiError } from "../errors";

const extractCookies = (res: Response): string => {
    const headers = res.headers as Headers & {
        getSetCookie?: () => string[];
    };
    if (typeof headers.getSetCookie === "function") {
        const set = headers.getSetCookie();
        if (Array.isArray(set) && set.length) {
            return set.map((s: string) => s.split(";")[0]).join("; ");
        }
    }
    const sc = headers.get?.("set-cookie");
    if (sc) {
        return sc
            .split(", ")
            .map((s: string) => s.split(";")[0])
            .join("; ");
    }
    return "";
};

export class MediaWiki extends Effect.Service<MediaWiki>()("MediaWiki", {
    dependencies: [AppConfig.Default],
    scoped: Effect.gen(function* () {
        const config = yield* AppConfig;
        const botKey = Redacted.value(config.MEDIAWIKI_BOT_KEY);

        const getToken = (tokenType: "csrf" | "login", cookies = "") =>
            Effect.tryPromise({
                try: async () => {
                    const headers: Record<string, string> = {
                        "User-Agent": EVERGREEN_WIKI_USER,
                    };
                    if (cookies) headers.Cookie = cookies;

                    const res = await fetch(
                        `${EVERGREEN_WIKI_URL}${EVERGREEN_WIKI_ENDPOINT}?action=query&meta=tokens&type=${tokenType}&format=json`,
                        { headers },
                    );
                    const data = (await res.json()) as {
                        query: { tokens: { csrftoken?: string; logintoken?: string } };
                    };
                    const token =
                        tokenType === "csrf"
                            ? data.query.tokens.csrftoken
                            : data.query.tokens.logintoken;
                    return { token: token!, cookies: extractCookies(res) };
                },
                catch: (e) => new MediaWikiError({ operation: "getToken", cause: e }),
            });

        const login = Effect.fn("MediaWiki.login")(function* () {
            yield* Effect.logDebug("mediawiki login initiated", {
                service_name: "MediaWiki",
                method: "login",
                operation_type: "authentication",
                wiki_url: EVERGREEN_WIKI_URL,
                user: EVERGREEN_WIKI_USER,
            });

            const { token: loginToken, cookies: initialCookies } = yield* getToken("login");

            const params = new URLSearchParams({
                action: "login",
                format: "json",
                lgname: EVERGREEN_WIKI_USER,
                lgpassword: botKey,
                lgtoken: loginToken,
            });

            const [duration, res] = yield* Effect.tryPromise({
                try: () =>
                    fetch(EVERGREEN_WIKI_URL + EVERGREEN_WIKI_ENDPOINT, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/x-www-form-urlencoded",
                            "User-Agent": EVERGREEN_WIKI_USER,
                            ...(initialCookies ? { Cookie: initialCookies } : {}),
                        },
                        body: params,
                    }),
                catch: (e) => new MediaWikiError({ operation: "login", cause: e }),
            }).pipe(Effect.timed);

            const duration_ms = Duration.toMillis(duration);

            const body = yield* Effect.tryPromise({
                try: () => res.json() as Promise<{ login?: { result: string } }>,
                catch: (e) => new MediaWikiError({ operation: "login.parse", cause: e }),
            });

            const loginResult = body?.login?.result || "Unknown";

            yield* Effect.annotateCurrentSpan({ 
                duration_ms,
                login_result: loginResult,
            });

            if (!body?.login || body.login.result !== "Success") {
                yield* Effect.logError("mediawiki login failed", {
                    service_name: "MediaWiki",
                    method: "login",
                    operation_type: "authentication",
                    wiki_url: EVERGREEN_WIKI_URL,
                    user: EVERGREEN_WIKI_USER,
                    login_result: loginResult,
                    duration_ms,
                    latency_ms: duration_ms,
                    error_type: "auth_failed",
                });

                return yield* Effect.fail(
                    new MediaWikiError({
                        operation: "login",
                        cause: new Error(`Login failed: ${JSON.stringify(body)}`),
                    }),
                );
            }

            yield* Effect.logInfo("mediawiki login completed", {
                service_name: "MediaWiki",
                method: "login",
                operation_type: "authentication",
                wiki_url: EVERGREEN_WIKI_URL,
                user: EVERGREEN_WIKI_USER,
                login_result: loginResult,
                duration_ms,
                latency_ms: duration_ms,
            });

            return extractCookies(res) || initialCookies;
        });

        const appendPage = Effect.fn("MediaWiki.appendPage")(function* (
            pageTitle: string,
            appendText: string,
            description: string,
        ) {
            yield* Effect.annotateCurrentSpan({
                page_title: pageTitle,
                append_text_length: appendText.length,
                description,
            });

            yield* Effect.logDebug("mediawiki page append initiated", {
                service_name: "MediaWiki",
                method: "appendPage",
                operation_type: "page_edit",
                page_title: pageTitle,
                append_text_length: appendText.length,
                description,
                wiki_url: EVERGREEN_WIKI_URL,
            });

            const cookies = yield* login();
            const { token } = yield* getToken("csrf", cookies);

            const params = new URLSearchParams({
                action: "edit",
                format: "json",
                title: pageTitle,
                appendtext: appendText,
                summary: description,
                token,
            });

            const [duration, res] = yield* Effect.tryPromise({
                try: () =>
                    fetch(EVERGREEN_WIKI_URL + EVERGREEN_WIKI_ENDPOINT, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/x-www-form-urlencoded",
                            "User-Agent": EVERGREEN_WIKI_USER,
                            Cookie: cookies,
                        },
                        body: params,
                    }),
                catch: (e) => new MediaWikiError({ operation: "appendPage", cause: e }),
            }).pipe(Effect.timed);

            const duration_ms = Duration.toMillis(duration);

            const data = yield* Effect.tryPromise({
                try: () =>
                    res.json() as Promise<{
                        edit?: { result: string; captcha?: unknown };
                    }>,
                catch: (e) => new MediaWikiError({ operation: "appendPage.parse", cause: e }),
            });

            const editResult = data?.edit?.result || "Unknown";
            const success = editResult === "Success";
            const pageUrl = `${EVERGREEN_WIKI_URL}/wiki/${pageTitle.replaceAll(" ", "_")}`;

            yield* Effect.annotateCurrentSpan({ 
                duration_ms,
                edit_result: editResult,
                success,
            });

            if (data?.edit?.captcha) {
                yield* Effect.logError("mediawiki edit requires captcha", {
                    service_name: "MediaWiki",
                    method: "appendPage",
                    operation_type: "page_edit",
                    page_title: pageTitle,
                    error_type: "captcha_required",
                    captcha: data.edit.captcha,
                    duration_ms,
                });
            }

            yield* Effect.logInfo("mediawiki page append completed", {
                service_name: "MediaWiki",
                method: "appendPage",
                operation_type: "page_edit",
                page_title: pageTitle,
                append_text_length: appendText.length,
                description,
                edit_result: editResult,
                success,
                page_url: pageUrl,
                duration_ms,
                latency_ms: duration_ms,
                wiki_url: EVERGREEN_WIKI_URL,
            });

            return {
                success,
                url: pageUrl,
            };
        });

        return { appendPage } as const;
    }).pipe(Effect.annotateLogs({ service: "MediaWiki" })),
}) {}

/** @deprecated Use MediaWiki.Default instead */
export const MediaWikiLive = MediaWiki.Default;
