import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  const pagesBasePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const pagesDemo = process.env.PAGES_DEMO === "true";

  return {
    base: pagesDemo ? `${pagesBasePath}/` : "/",
    server: {
      host: "0.0.0.0",
    },
    plugins: [
      {
        name: "pages-demo-public-url-fallback",
        enforce: "pre",
        transform(code, id) {
          if (
            pagesDemo &&
            id.includes("/vinext/dist/") &&
            code.includes("http://localhost")
          ) {
            // Vinext uses localhost only as a URL-constructor base when there
            // is no browser origin. Keep that literal out of the public demo.
            return code.replaceAll("http://localhost", "https://example.invalid");
          }
        },
      },
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: {
          main: "./worker/index.ts",
          compatibility_flags: ["nodejs_compat"],
        },
      }),
    ],
  };
});
