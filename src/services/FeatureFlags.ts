import { createClient } from "@vercel/edge-config";
import { Effect } from "effect";

import { AppConfig } from "../config";
import { FeatureFlagError } from "../errors";

export type Flags = {
    commitOverflow: boolean;
    dashboard: boolean;
    hackNightPhotos: boolean;
    autoThread: boolean;
    welcomer: boolean;
    meetingNotes: boolean;
};

export class FeatureFlags extends Effect.Service<FeatureFlags>()("FeatureFlags", {
    dependencies: [AppConfig.Default],
    scoped: Effect.gen(function* () {
        const config = yield* AppConfig;

        yield* Effect.logInfo("feature flags service initializing", {
            service_name: "FeatureFlags",
            operation_type: "initialization",
        });

        const client = yield* Effect.try({
            try: () => createClient(config.FEATURE_FLAGS_EDGE_CONFIG),
            catch: (cause) => new FeatureFlagError({ cause }),
        });

        yield* Effect.logInfo("feature flags edge config client created", {
            service_name: "FeatureFlags",
            operation_type: "initialization",
        });

        const fetchFlags = Effect.tryPromise({
            try: () => client.getAll<Record<string, boolean>>(),
            catch: (cause) => new FeatureFlagError({ cause }),
        });

        // Cache Edge Config reads with a 5-minute TTL
        const cached = yield* Effect.cachedWithTTL(fetchFlags, "5 minutes");

        const getFlags: Effect.Effect<Flags> = Effect.gen(function* () {
            const raw = yield* cached.pipe(
                Effect.tapError((e) =>
                    Effect.logWarning("feature flags fetch failed, using defaults", {
                        service_name: "FeatureFlags",
                        operation_type: "fetch",
                        error_message: e instanceof Error ? e.message : String(e),
                    }),
                ),
                Effect.orElseSucceed(() => ({}) as Record<string, boolean>),
            );

            const flags: Flags = {
                commitOverflow: raw.commit_overflow ?? false,
                dashboard: raw.dashboard ?? true,
                hackNightPhotos: raw.hack_night_photos ?? true,
                autoThread: raw.auto_thread ?? true,
                welcomer: raw.welcomer ?? true,
                meetingNotes: raw.meeting_notes ?? true,
            };

            yield* Effect.logDebug("feature flags resolved", {
                service_name: "FeatureFlags",
                operation_type: "fetch",
                ...flags,
            });

            return flags;
        });

        yield* Effect.logInfo("feature flags service initialized", {
            service_name: "FeatureFlags",
            operation_type: "initialization",
        });

        return { getFlags } as const;
    }).pipe(Effect.annotateLogs({ service: "FeatureFlags" })),
}) {}
