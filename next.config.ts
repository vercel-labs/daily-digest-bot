import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@chat-adapter/slack",
    "@chat-adapter/state-redis",
    "@redis/client",
    "@slack/socket-mode",
    "@slack/web-api",
    "redis",
  ],
};

export default withWorkflow(nextConfig);
