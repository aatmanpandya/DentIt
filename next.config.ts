import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bottom-left is where the nav rail's "Powered by DentIt" credit sits; keep the dev
  // indicator (and its error surfacing) out of its way.
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
