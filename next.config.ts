import type { NextConfig } from "next";

import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["discord.js", "@libsql/client"],
};

export default withWorkflow(nextConfig);
