import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root so Next doesn't pick up a stray lockfile in $HOME.
  turbopack: {
    root: path.resolve("."),
  },
  // Hide the floating dev-tools badge (it overlaps the sidebar footer).
  devIndicators: false,
};

export default nextConfig;
