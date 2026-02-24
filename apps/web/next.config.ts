import type { NextConfig } from "next";

/**
 * Known first-segment routes that should NOT be rewritten to /repos/...
 * Includes all top-level app routes, API routes, and Next.js internals.
 */
const KNOWN_ROUTES = [
	"api",
	"dashboard",
	"debug",
	"extension",
	"issues",
	"notifications",
	"orgs",
	"prompt",
	"repos",
	"search",
	"trending",
	"users",
	"_next",
];

const nextConfig: NextConfig = {
	devIndicators: false,
	serverExternalPackages: ["@prisma/client"],
	experimental: {
		staleTimes: {
			dynamic: 300,
			static: 180,
		},
	},
	images: {
		...(process.env.NODE_ENV === "development" && {
			dangerouslyAllowLocalIP: true,
		}),
		remotePatterns: [
			{
				protocol: "https",
				hostname: "**",
			},
		],
	},
	async rewrites() {
		return {
			beforeFiles: [
				// Rewrite /:owner/:repo(/:path*) → /repos/:owner/:repo(/:path*)
				// Only when the first segment is NOT a known app route.
				// The negative lookahead excludes all known routes so only
				// owner/repo patterns get rewritten.
				{
					source: `/:owner((?!${KNOWN_ROUTES.join("|")})\\w[\\w.\\-]*)/:repo/:path*`,
					destination: "/repos/:owner/:repo/:path*",
				},
				{
					source: `/:owner((?!${KNOWN_ROUTES.join("|")})\\w[\\w.\\-]*)/:repo`,
					destination: "/repos/:owner/:repo",
				},
			],
		};
	},
};

export default nextConfig;
