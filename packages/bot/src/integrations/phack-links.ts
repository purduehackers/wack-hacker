import { messageOf, Transient, UpstreamError } from "@repo/shared/errors";
import { writePhackLink } from "@repo/shared/phack";
import { Result } from "@repo/shared/result";

export type CreateLinkOutcome = "created" | "exists" | "same";
export type CreateLinkError = Transient | UpstreamError;

export interface PhackLinkWriter {
  readonly create: (
    slug: string,
    destination: string,
  ) => Promise<Result<CreateLinkOutcome, CreateLinkError>>;
}

export function createPhackLinkWriter(token: string): PhackLinkWriter {
  return {
    create: (slug, destination) =>
      Result.tryPromise({
        try: async () => {
          const result = await writePhackLink({
            slug,
            destination,
            token,
            signal: AbortSignal.timeout(10_000),
          });
          if (!("detail" in result)) return result.kind;
          throw result.status !== undefined && result.status < 500
            ? new UpstreamError({
                service: "vercel-global-config",
                status: result.status,
                detail: result.detail,
              })
            : new Transient({ operation: "create phack.rs link", detail: result.detail });
        },
        catch: (cause) =>
          cause instanceof UpstreamError || cause instanceof Transient
            ? cause
            : new Transient({ operation: "create phack.rs link", detail: messageOf(cause) }),
      }),
  };
}
