import type { NextConfig } from "next";
const backend = process.env.GAME_HTTP_URL || "http://127.0.0.1:2567";
const config: NextConfig = {
  webpack(config, { dev }) {
    // Webpack's persistent production cache hangs hashing an ancestor directory
    // in this macOS workspace. Compilation works without that optional cache.
    if (!dev) config.cache = false;
    return config;
  },
  distDir: process.env.NEXT_BUILD_DIR || ".next",
  transpilePackages: [
    "@third-space/contracts",
    "@third-space/config",
    "@third-space/simulation",
  ],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};
export default config;
