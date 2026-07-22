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
  env: {
    GENERATE_SITE_STYLE_SHARED_SECRET: generationSharedToken,
    NEXT_PUBLIC_GENERATE_SITE_STYLE_SHARED_SECRET: generationSharedToken,
    GENERATE_SITE_STYLE_ALLOWED_ORIGIN: generationAllowedOrigin,
  },
};

export default nextConfig;
