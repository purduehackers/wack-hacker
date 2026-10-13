import { inspectSvg } from "@repo/badges/svg";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

import type { RenderInput } from "./types.ts";

declare const BADGE_SCENE: string;

/** Each job uses a fresh browser profile; it never accesses a signed-in browser. */
export async function renderBadge(input: RenderInput): Promise<Uint8Array> {
  const inspected = inspectSvg(input.svg, "badge");
  if (inspected.checks.some((check) => check.status !== "pass"))
    throw new Error("Check the SVG before rendering the badge.");
  if (!Number.isFinite(input.thicknessMm) || input.thicknessMm <= 0 || input.thicknessMm > 100)
    throw new Error("Invalid preview thickness.");
  const localExecutable = process.env.BADGE_CHROMIUM_EXECUTABLE_PATH?.trim() || undefined;
  const browser = await puppeteer.launch({
    executablePath: localExecutable ?? (await chromium.executablePath()),
    args: localExecutable
      ? ["--enable-unsafe-swiftshader"]
      : chromium.args.filter(
          (arg) => !["--disable-web-security", "--allow-running-insecure-content"].includes(arg),
        ),
    headless: "shell",
    timeout: 20_000,
    protocolTimeout: 40_000,
  });
  // Close the browser even when triangulation or WebGL stops responding.
  const deadline = setTimeout(() => {
    browser.process()?.kill("SIGKILL");
  }, 45_000);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 640, height: 640, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (["data:", "blob:", "about:"].some((prefix) => request.url().startsWith(prefix)))
        void request.continue();
      else void request.abort();
    });
    await page.setContent('<html><body style="margin:0"></body></html>');
    await page.addScriptTag({ content: BADGE_SCENE });
    const data = await page.evaluate((options) => window.renderBadge(options), {
      ...input,
      svg: inspected.source,
    });
    if (!data.startsWith("data:image/png;base64,")) throw new Error("Badge preview is not a PNG.");
    return Buffer.from(data.slice("data:image/png;base64,".length), "base64");
  } finally {
    clearTimeout(deadline);
    await browser.close();
  }
}
