import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingExcludes: {
    "/*": [
      "./output/**/*",
      "./state/**/*",
      "./logs/**/*",
      "./credentials/**/*",
      "./config/settings.json",
    ],
  },
};

export default nextConfig;
