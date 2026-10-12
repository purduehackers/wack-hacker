import { messageOf } from "@repo/shared/errors";

import { contextHash, ready, remainingCriteria, reviewable, staticPassed } from "./contracts.ts";
import type { Review } from "./contracts.ts";
import { physicalSvg, renderManufacturing } from "./manufacturing.ts";
import { pack } from "./packing.ts";
import { assertCurrentEvent, CmsEventChanged } from "./service.ts";
import type { Cms } from "./service.ts";
import { StaleReview } from "./store.ts";
import type { BadgeStore } from "./store.ts";
import { crops, inspectSvg, renderSvg } from "./svg.ts";

export interface Publisher {
  archive(review: Review): Promise<NonNullable<Review["pr"]>>;
  publish(review: Review): Promise<NonNullable<Review["publication"]>>;
}

export function createWorker(store: BadgeStore, cms: Cms, publisher: Publisher) {
  async function advance(review: Review, kind: string): Promise<Review> {
    switch (kind) {
      case "inspect":
        return inspect(review, store);
      case "prepare":
        return prepare(review, store);
      case "pack": {
        if (!staticPassed(review) || !review.badge || !review.settings)
          throw new Error(
            "Static checks and manufacturing settings must be complete before packing.",
          );
        const source = (await store.asset(review.badge.hash)).bytes.toString("utf8");
        return {
          ...review,
          layouts: await pack(source, inspectSvg(source, "badge").cut, review.settings, store),
        };
      }
      case "archive": {
        if (!reviewable(review) || remainingCriteria(review).length !== 0) return review;
        await assertCurrentEvent(review, cms);
        const pr = await publisher.archive(review);
        return { ...review, pr, repositoryHead: pr.head };
      }
      case "publish": {
        if (
          !ready(review) ||
          !review.approval ||
          review.approval.context !== contextHash(review) ||
          review.approval.head !== review.pr?.head
        )
          throw new Error("Publication approval does not match this revision.");
        await assertCurrentEvent(review, cms);
        return { ...review, publication: await publisher.publish(review) };
      }
      default:
        throw new Error("Unsupported badge job.");
    }
  }
  async function process(): Promise<boolean> {
    const job = await store.claim();
    if (!job) return false;
    const stored = await store.get(job.reviewId);
    if (!stored || stored.review.generation !== job.generation) {
      await store.finish(job.id, job.lease);
      return true;
    }
    const { review, version } = stored;
    try {
      const next = await advance(review, job.kind);
      const { failure: _failure, ...clean } = next;
      await store.save({
        review: clean,
        expected: version,
        actorId: "worker",
        eventId: `job:${job.id}`,
        jobs:
          job.kind === "inspect" && staticPassed(clean) && clean.settings && clean.event
            ? ["pack"]
            : [],
      });
      await store.finish(job.id, job.lease);
    } catch (cause) {
      if (cause instanceof StaleReview) {
        await store.finish(job.id, job.lease);
        return true;
      }
      const failure = messageOf(cause).slice(0, 1500);
      await store.finish(job.id, job.lease, failure);
      const current = await store.get(review.id);
      if (current && current.review.generation === job.generation) {
        // CMS verification happens before any publishing effect. Reopen controls
        // so the maker can refresh instead of trapping a stale approval in retries.
        const { approval, ...withoutApproval } = current.review;
        const failed =
          cause instanceof CmsEventChanged ? withoutApproval : { ...withoutApproval, approval };
        await store.save({
          review: { ...failed, failure },
          expected: current.version,
          actorId: "worker",
          eventId: `failure:${job.id}:${job.attempts}`,
          jobs: [],
        });
      }
    }
    return true;
  }
  return { process };
}

async function prepare(review: Review, store: BadgeStore): Promise<Review> {
  const layout = review.layouts.find((item) => item.id === review.selectedLayout);
  if (!layout || !review.badge || !review.stamp || !review.settings || !staticPassed(review))
    throw new Error("Select a valid layout before preparing physical assets.");
  const badge = physicalSvg(
    (await store.asset(review.badge.hash)).bytes.toString("utf8"),
    "badge",
    layout.sizeIn,
    false,
  );
  const stamp = physicalSvg(
    (await store.asset(review.stamp.hash)).bytes.toString("utf8"),
    "stamp",
    review.settings.stampSizeIn,
    review.settings.mirrorStamp,
  );
  return {
    ...review,
    manufacturing: {
      badge: await store.putAsset(Buffer.from(badge), "image/svg+xml"),
      stamp: await store.putAsset(Buffer.from(stamp), "image/svg+xml"),
      stampPreview: await store.putAsset(renderManufacturing(stamp), "image/png"),
    },
  };
}

async function inspect(review: Review, store: BadgeStore): Promise<Review> {
  if (!review.badge || !review.stamp || !review.rolesConfirmed)
    throw new Error("Identify the badge and stamp first.");
  const badge = inspectSvg((await store.asset(review.badge.hash)).bytes.toString("utf8"), "badge");
  const stamp = inspectSvg((await store.asset(review.stamp.hash)).bytes.toString("utf8"), "stamp");
  const previews = await Promise.all(
    [badge.source, stamp.source, ...crops(badge.source)].map((source) =>
      store.putAsset(renderSvg(source), "image/png"),
    ),
  );
  return { ...review, checks: [...badge.checks, ...stamp.checks], previews };
}
