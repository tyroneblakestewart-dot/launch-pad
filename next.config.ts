import type { NextConfig } from "next";

const isStaticExport = process.env.STATIC_EXPORT === "true";
const repositoryBasePath = "/launch-pad";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(isStaticExport ? { output: "export" as const } : {}),
  trailingSlash: isStaticExport,
  images: {
    unoptimized: isStaticExport,
  },
  basePath: isStaticExport ? repositoryBasePath : "",
  assetPrefix: isStaticExport ? repositoryBasePath : "",
};

export default nextConfig;
