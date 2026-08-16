import type { NextConfig } from "next";

const isStaticExport = process.env.STATIC_EXPORT === "true";
const repositoryBasePath = "/launch-pad";
const generationSharedToken =
  process.env.GENERATE_SITE_STYLE_SHARED_SECRET ||
  process.env.NEXT_PUBLIC_GENERATE_SITE_STYLE_SHARED_SECRET ||
  "hoodlums-generation-bridge-v1";
const generationAllowedOrigin =
  process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN || "https://hoodlums.dev";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(isStaticExport ? { output: "export" as const } : {}),
  trailingSlash: isStaticExport,
  images: {
    unoptimized: isStaticExport,
  },
  basePath: isStaticExport ? repositoryBasePath : "",
  assetPrefix: isStaticExport ? repositoryBasePath : "",
  async redirects() {
    if (isStaticExport) return [];
    return [
      {
        source: "/account",
        destination: "/?account=open",
        permanent: false,
      },
    ];
  },
  env: {
    GENERATE_SITE_STYLE_SHARED_SECRET: generationSharedToken,
    NEXT_PUBLIC_GENERATE_SITE_STYLE_SHARED_SECRET: generationSharedToken,
    GENERATE_SITE_STYLE_ALLOWED_ORIGIN: generationAllowedOrigin,
    // Bridges the server-only Vercel commit SHA to the client bundle so
    // crash reports (issue #353) can be tied to a release without relying
    // on the Vercel project's "expose system env vars" toggle being on.
    NEXT_PUBLIC_CLIENT_ERROR_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA || "",
  },
};

export default nextConfig;
