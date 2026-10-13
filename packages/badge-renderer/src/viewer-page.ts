import { materialDescription } from "@repo/badges/materials";
import { inspectSvg } from "@repo/badges/svg";

import type { RenderInput } from "./types.ts";

declare const BADGE_VIEWER: string;

/** The page contains one checked asset and no external scripts or resources. */
export function viewerPage(input: RenderInput): Response {
  const inspected = inspectSvg(input.svg, "badge");
  if (inspected.checks.some((check) => check.status !== "pass"))
    throw new Error("Check the SVG before viewing the badge.");
  const nonce = crypto.randomUUID();
  const data = JSON.stringify({ ...input, svg: inspected.source }).replaceAll("<", "\\u003c");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your badge in 3D</title>
<style nonce="${nonce}">
*{box-sizing:border-box}body{margin:0;background:#f3f3f3;color:#252525;font:16px/1.5 system-ui,sans-serif;height:100dvh;display:flex;flex-direction:column}
header,footer{padding:20px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}h1{font-size:22px;margin:0}p{margin:0;color:#555}main{position:relative;flex:1;min-height:160px;overflow:hidden}canvas{display:block;touch-action:none}[role=status]{position:absolute;inset:45% 20px auto;text-align:center}button{font:inherit;padding:9px 16px;border:1px solid #aaa;border-radius:8px;background:white;color:inherit;cursor:pointer}button:focus-visible{outline:3px solid #5865f2;outline-offset:3px}footer{font-size:14px}
</style></head><body>
<header><div><h1>Your badge in 3D</h1><p>Drag to rotate. Scroll or pinch to zoom.</p></div><button type="button">Reset view</button></header>
<main><p role="status">Loading your badge…</p></main>
<footer><p>${materialDescription({ materialId: input.material.id, thicknessMm: input.thicknessMm })}. Check fine details in your original design.</p></footer>
<script nonce="${nonce}">window.badgeInput=${data};${BADGE_VIEWER}</script>
</body></html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src data: blob:; base-uri 'none'; frame-ancestors 'none'`,
    },
  });
}
