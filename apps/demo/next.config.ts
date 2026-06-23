import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@reineira-os/x402-rss-shared", "@reineira-os/x402-core"],
  serverExternalPackages: ["@cofhe/sdk", "node-tfhe", "tfhe"],
};

export default nextConfig;
