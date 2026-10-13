import type { BadgeStore } from "@repo/badges";
import type { Review } from "@repo/badges/contracts";
import { fixRole, reviewStep } from "@repo/badges/presentation";
import { renderSvg } from "@repo/badges/svg";
import { Resvg } from "@resvg/resvg-js";

function pair(images: string[], labels: [string, string]): string {
  const parts = images.map(
    (data, i) =>
      `<text x="${i * 600 + 300}" y="40" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#333">${labels[i]}</text><image x="${i * 600 + 24}" y="65" width="552" height="580" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${data}"/>`,
  );
  return Buffer.from(
    new Resvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="670"><rect width="1200" height="670" fill="white"/>${parts.join("")}</svg>`,
    )
      .render()
      .asPng(),
  ).toString("base64");
}
export async function previewFiles(review: Review, store: BadgeStore) {
  const step = reviewStep(review);
  if (step === "files") {
    const images = await Promise.all(
      review.uploads.map(async (upload) =>
        Buffer.from(renderSvg((await store.asset(upload.hash)).bytes.toString("utf8"))).toString(
          "base64",
        ),
      ),
    );
    return [
      {
        name: "designs.png",
        data: images.length === 2 ? pair(images, ["A", "B"]) : (images[0] ?? ""),
      },
    ];
  }
  if (step === "done" && review.manufacturing) {
    const images = await Promise.all(
      [review.manufacturing.badgePreview, review.manufacturing.stampPreview].map(async (digest) =>
        (await store.asset(digest)).bytes.toString("base64"),
      ),
    );
    return [{ name: "designs.png", data: pair(images, ["Badge", "Stamp impression"]) }];
  }
  const digest =
    step === "badge"
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
