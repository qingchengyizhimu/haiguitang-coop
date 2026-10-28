import type { NextConfig } from "next";

const pagesDemo = process.env.PAGES_DEMO === "true";
const pagesBasePath = process.env.NEXT_PUBLIC_BASE_PATH || "/haiguitang-coop";

const nextConfig: NextConfig = {
  ...(pagesDemo
    ? {
        // GitHub Pages serves this repository below /haiguitang-coop/. Keep
        // these settings opt-in so root-path and Worker builds are unchanged.
        output: "export" as const,
        assetPrefix: pagesBasePath,
        trailingSlash: true,
      }
    : {}),
};

export default nextConfig;
