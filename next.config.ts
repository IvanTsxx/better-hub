import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ["@prisma/client"],
  experimental: {
    staleTimes: {
      dynamic: 0,
      static: 180,
    },
  },
  async rewrites() {
    return {
      beforeFiles: [
        // GitHub uses singular /pull/:number but our routes use /pulls/:number
        {
          source: "/:owner/:repo/pull/:number",
          destination: "/repos/:owner/:repo/pulls/:number",
        },
        // GitHub uses singular /commit/:sha but our routes use /commits/:sha
        {
          source: "/:owner/:repo/commit/:sha",
          destination: "/repos/:owner/:repo/commits/:sha",
        },
        // GitHub uses /actions/runs/:runId but our routes use /actions/:runId
        {
          source: "/:owner/:repo/actions/runs/:runId",
          destination: "/repos/:owner/:repo/actions/:runId",
        },
      ],
      afterFiles: [],
      fallback: [
        { source: "/:owner/:repo", destination: "/repos/:owner/:repo" },
        {
          source: "/:owner/:repo/:path*",
          destination: "/repos/:owner/:repo/:path*",
        },
      ],
    };
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "github.com",
      },
      {
        protocol: "https",
        hostname: "raw.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "user-images.githubusercontent.com",
      },
    ],
  },
};

export default nextConfig;
