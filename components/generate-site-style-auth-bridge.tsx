"use client";

import { useEffect } from "react";

const GENERATE_SITE_STYLE_HEADER = "x-hoodlums-api-key";
const PROTECTED_GENERATION_ROUTES = [
  "/api/generate-site-style",
  "/api/generate-site-page",
] as const;

export function GenerateSiteStyleAuthBridge() {
  useEffect(() => {
    const secret = process.env.NEXT_PUBLIC_GENERATE_SITE_STYLE_SHARED_SECRET;
    if (!secret) return;

    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!PROTECTED_GENERATION_ROUTES.some((route) => url.includes(route))) {
        return originalFetch(input, init);
      }

      const headers = new Headers(init?.headers);
      headers.set(GENERATE_SITE_STYLE_HEADER, secret);
      return originalFetch(input, { ...init, headers });
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
