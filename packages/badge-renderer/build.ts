const scene = await Bun.build({
  entrypoints: ["./src/scene.ts"],
  target: "browser",
  format: "iife",
  minify: true,
});
if (!scene.success || !scene.outputs[0]) throw new Error("Badge scene build failed.");
// Inline the trusted scene so the server bundle has no untraced browser assets.
const result = await Bun.build({
  entrypoints: ["./src/render.ts"],
  outdir: "./dist",
  naming: "index.js",
  target: "node",
  packages: "external",
  define: { BADGE_SCENE: JSON.stringify(await scene.outputs[0].text()) },
});
if (!result.success) throw new Error("Badge renderer build failed.");
