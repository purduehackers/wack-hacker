async function browserBundle(entrypoint: string): Promise<string> {
  const bundle = await Bun.build({
    entrypoints: [entrypoint],
    target: "browser",
    format: "iife",
    minify: true,
  });
  if (!bundle.success || !bundle.outputs[0]) throw new Error("Badge browser build failed.");
  return bundle.outputs[0].text();
}
// Inline the trusted scene so the server bundle has no untraced browser assets.
const result = await Bun.build({
  entrypoints: ["./src/render.ts"],
  outdir: "./dist",
  naming: "index.js",
  target: "node",
  packages: "external",
  define: {
    BADGE_SCENE: JSON.stringify(await browserBundle("./src/capture.ts")),
    BADGE_VIEWER: JSON.stringify(await browserBundle("./src/viewer.ts")),
  },
});
if (!result.success) throw new Error("Badge renderer build failed.");
