import { messageOf } from "@repo/shared/errors";

import { contextHash, ready, remainingCriteria, reviewable, staticPassed } from "./contracts.ts";
import type { JobKind, Review } from "./contracts.ts";
import type { createBadgeInventory } from "./inventory.ts";
import { physicalDimensions, physicalSvg, renderManufacturing } from "./manufacturing.ts";
import { pack } from "./packing.ts";
import { assertCurrentEvent, CmsEventChanged } from "./service.ts";
import type { Cms } from "./service.ts";
import { StaleReview } from "./store.ts";
import type { BadgeStore } from "./store.ts";
import { inspectSvg, renderSvg } from "./svg.ts";

export interface Publisher {
  archive(review: Review): Promise<NonNullable<Review["pr"]>>;
  publish(
    review: Review,
    beforeMerge: () => Promise<void>,
  ): Promise<NonNullable<Review["publication"]>>;
  link(review: Review): Promise<string>;
}
export type BadgeRenderer = (
  svg: string,
) => Promise<{ image: Uint8Array; material: string; materialId?: string; thicknessMm?: number }>;
type Inventory = Pick<
  ReturnType<typeof createBadgeInventory>,
  "plan" | "reserve" | "consume" | "release"
>;
function nextJobs(review: Review, kind: string): JobKind[] {
  if (kind === "inspect" && staticPassed(review) && review.event && review.settings)
    return ["prepare"];
  if (kind === "prepare" && reviewable(review) && remainingCriteria(review).length === 0)
    return ["pack"];
  if (kind === "archive") return ["publish"];
  if (kind === "publish") return ["link"];
  return [];
}
export function createWorker(
  store: BadgeStore,
  cms: Cms,
  publisher: Publisher,
  renderer?: BadgeRenderer,
  inventory?: Inventory,
) {
  async function advance(review: Review, kind: string): Promise<Review> {
    switch (kind) {
      case "inspect":
        return inspect(review, store);
      case "prepare":
        return prepare(review, store, renderer);
      case "pack":
        return arrange(review, store, cms, inventory);
      case "archive": {
        assertApproval(review);
        await assertCurrentEvent(review, cms);
        await inventory?.reserve(review);
        const pr = await publisher.archive(review);
        return {
          ...review,
          pr,
          repositoryHead: pr.head,
          approval: {
            ...review.approval,
            context: contextHash(review),
            reviewer: approvalReviewer(review),
            head: pr.head,
          },
        };
      }
      case "publish": {
        assertApproval(review);
        if (!review.pr || review.approval?.head !== review.pr.head)
          throw new Error("Publication approval does not match this revision.");
        const publication = await publisher.publish(review, () => assertCurrentEvent(review, cms));
        const published = { ...review, publication };
        await inventory?.consume(published);
        return published;
      }
      case "link": {
        if (!review.publication) throw new Error("Save the files before creating their link.");
        return {
          ...review,
          publication: { ...review.publication, shortlink: await publisher.link(review) },
        };
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
        jobs: nextJobs(clean, job.kind),
      });
      await store.finish(job.id, job.lease);
    } catch (cause) {
      // The publisher checks CMS immediately before merging. A merged retry instead
      // verifies its receipt and consumes stock even if CMS has since changed.
      if (cause instanceof CmsEventChanged) await inventory?.release(review);
      await failJob(store, job, cause);
    }
    return true;
  }
  return { process };
}
async function arrange(
  review: Review,
  store: BadgeStore,
  cms: Cms,
  inventory?: Inventory,
): Promise<Review> {
  if (!reviewable(review) || remainingCriteria(review).length || !review.badge || !review.settings)
    throw new Error("Confirm both designs before arranging them.");
  await assertCurrentEvent(review, cms);
  const source = (await store.asset(review.badge.hash)).bytes.toString("utf8");
  const layouts = await pack(
    source,
    inspectSvg(source, "badge").cut,
    review.settings,
    store,
    review.layoutAttempt,
  );
  const stockPlan = await inventory?.plan(
    layouts[0]?.placements.map((placement) => placement.sheet),
  );
  return {
    ...review,
    layouts,
    selectedLayout: layouts[0]?.id,
    ...(stockPlan ? { stockPlan } : {}),
  };
}
async function failJob(
  store: BadgeStore,
  job: NonNullable<Awaited<ReturnType<BadgeStore["claim"]>>>,
  cause: unknown,
) {
  if (cause instanceof StaleReview) {
    await store.finish(job.id, job.lease);
    return;
  }
  const failure = messageOf(cause).slice(0, 1500);
  await store.finish(job.id, job.lease, failure);
  const current = await store.get(job.reviewId);
  if (current && current.review.generation === job.generation) {
    const { approval, ...withoutApproval } = current.review;
    const failed =
      cause instanceof CmsEventChanged
        ? { ...withoutApproval, contextChanged: true }
        : { ...withoutApproval, approval };
    await store.save({
      review: { ...failed, failure },
      expected: current.version,
      actorId: "worker",
      eventId: `failure:${job.id}:${job.attempts}`,
      jobs: [],
    });
  }
}
function approvalReviewer(review: Review) {
  if (!review.approval) throw new Error("Publication needs approval.");
  return review.approval.reviewer;
}
function assertApproval(review: Review) {
  if (!ready(review) || review.approval?.context !== contextHash(review))
    throw new Error("Publication approval does not match this revision.");
}
async function prepare(
  review: Review,
  store: BadgeStore,
  renderer?: BadgeRenderer,
): Promise<Review> {
  if (!review.badge || !review.stamp || !review.settings || !staticPassed(review))
    throw new Error("Check the files before preparing them.");
  const badgeSource = (await store.asset(review.badge.hash)).bytes.toString("utf8");
  const stampSource = (await store.asset(review.stamp.hash)).bytes.toString("utf8");
  const badge = physicalSvg(badgeSource, "badge", review.settings.badgeSizeIn, false);
  const impression = physicalSvg(stampSource, "stamp", 1.5, false);
  const stamp = physicalSvg(stampSource, "stamp", 1.5, true);
  const badgeSize = physicalDimensions(
    inspectSvg(badgeSource, "badge").cut,
    "badge",
    review.settings.badgeSizeIn,
  );
  const stampSize = physicalDimensions(inspectSvg(stampSource, "stamp").cut, "stamp", 1.5);
  const preview3d = await renderer?.(badge);
  return {
    ...review,
    manufacturing: {
      badge: await store.putAsset(Buffer.from(badge), "image/svg+xml"),
      stamp: await store.putAsset(Buffer.from(stamp), "image/svg+xml"),
      badgePreview: await store.putAsset(renderManufacturing(badge), "image/png"),
      ...(preview3d
        ? {
            badge3d: {
              preview: await store.putAsset(preview3d.image, "image/png"),
              material: preview3d.material,
              ...(preview3d.materialId ? { materialId: preview3d.materialId } : {}),
              ...(preview3d.thicknessMm ? { thicknessMm: preview3d.thicknessMm } : {}),
            },
          }
        : {}),
      stampPreview: await store.putAsset(renderManufacturing(impression), "image/png"),
      badgeWidthIn: badgeSize.widthIn,
      badgeHeightIn: badgeSize.heightIn,
      stampWidthIn: stampSize.widthIn,
      stampHeightIn: stampSize.heightIn,
    },
  };
}
async function inspect(review: Review, store: BadgeStore): Promise<Review> {
  if (!review.badge || !review.stamp || !review.rolesConfirmed)
    throw new Error("Identify the badge and stamp first.");
  const badge = inspectSvg((await store.asset(review.badge.hash)).bytes.toString("utf8"), "badge");
  const stamp = inspectSvg((await store.asset(review.stamp.hash)).bytes.toString("utf8"), "stamp");
  const previews = await Promise.all(
    [badge.source, stamp.source].map((source) => store.putAsset(renderSvg(source), "image/png")),
  );
  const fixes = [badge, stamp].flatMap((item) =>
    item.checks.filter((check) => check.status !== "pass"),
  );
  return {
    ...review,
    checks: [...badge.checks, ...stamp.checks],
    previews,
    ...(fixes[0] ? { pendingRole: fixes[0].role } : {}),
  };
}
