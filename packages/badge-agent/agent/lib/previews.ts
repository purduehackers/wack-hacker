import type { BadgeStore } from "@repo/badges";
import type { Asset, Review } from "@repo/badges/contracts";
import { fixRole, reviewStep } from "@repo/badges/presentation";
import { renderSvg } from "@repo/badges/svg";
import { Resvg } from "@resvg/resvg-js";

function xmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function pair(images: string[], labels: string[], roles: string[] = []): string {
  const parts = images.map(
    (data, i) =>
      `<text x="${i * 600 + 300}" y="36" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#333">${xmlText((labels[i] ?? "").slice(0, 44))}${(labels[i]?.length ?? 0) > 44 ? "…" : ""}</text>${roles[i] ? `<text x="${i * 600 + 300}" y="66" text-anchor="middle" font-family="sans-serif" font-size="22" font-weight="bold" fill="#333">${xmlText(roles[i] ?? "")}</text>` : ""}<image x="${i * 600 + 24}" y="${roles.length ? 90 : 65}" width="552" height="${roles.length ? 550 : 580}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${data}"/>`,
  );
  return Buffer.from(
    new Resvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${images.length * 600}" height="670"><rect width="100%" height="670" fill="white"/>${parts.join("")}</svg>`,
    )
      .render()
      .asPng(),
  ).toString("base64");
}
async function filePreview(uploads: Asset[], store: BadgeStore, roles: string[] = []) {
  const images = await Promise.all(
    uploads.map(async (asset) =>
      Buffer.from(renderSvg((await store.asset(asset.hash)).bytes.toString("utf8"))).toString(
        "base64",
      ),
    ),
  );
  return {
    name: roles.length ? "selected-designs.png" : "designs.png",
    data: pair(
      images,
      uploads.map((asset) => asset.name),
      roles,
    ),
  };
}
export async function identifiedPreview(review: Review, store: BadgeStore) {
  if (!review.rolesConfirmed) return undefined;
  const entries = (["badge", "stamp"] as const).flatMap((role) =>
    review[role] ? [{ asset: review[role], label: role === "badge" ? "Badge" : "Stamp" }] : [],
  );
  return entries.length
    ? filePreview(
        entries.map((entry) => entry.asset),
        store,
        entries.map((entry) => entry.label),
      )
    : undefined;
}
export async function previewFiles(review: Review, store: BadgeStore) {
  const step = reviewStep(review);
  if (step === "files") {
    return [await filePreview(review.uploads, store)];
  }
  if (step === "done" && review.manufacturing) {
    const images = await Promise.all(
      [review.manufacturing.badgePreview, review.manufacturing.stampPreview].map(async (digest) =>
        (await store.asset(digest)).bytes.toString("base64"),
      ),
    );
    return [{ name: "designs.png", data: pair(images, ["Badge", "Stamp impression"]) }];
  }
  if (step === "badge" && review.manufacturing?.badge3d) {
    const images = await Promise.all(
      [review.manufacturing.badgePreview, review.manufacturing.badge3d.preview].map(
        async (digest) => (await store.asset(digest)).bytes.toString("base64"),
      ),
    );
    return [{ name: "preview.png", data: pair(images, ["Your design", "Material preview"]) }];
  }
  const digest =
    step === "event"
      ? review.previews[0]
      : step === "badge"
        ? review.manufacturing?.badgePreview
        : step === "stamp"
          ? review.manufacturing?.stampPreview
          : step === "layout"
            ? review.layouts.find((layout) => layout.id === review.selectedLayout)?.preview
            : step === "fix"
              ? review.previews[Number(fixRole(review) !== "badge")]
              : undefined;
  return digest
    ? [{ name: "preview.png", data: (await store.asset(digest)).bytes.toString("base64") }]
    : [];
}
