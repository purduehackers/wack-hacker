import { defineConfig } from "nitro";
export default defineConfig({
  modules: ["workflow/nitro"],
  routes: {
    "/**": "./src/index.ts",
  },
  serverAssets: [
    { baseName: "prompts", dir: "./src/lib/ai" },
  ],
  vercel: {
    functions: {
      maxDuration: 10 * 60,
    },
  },
});
