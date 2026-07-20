"use client";

import { useEffect } from "react";
import { GENERATE_SITE_STYLE_HEADER } from "@/lib/server/api-protection";

export function GenerateSiteStyleAuthBridge() {
  useEffect(() => {
    const secret = process.env.NEXT_PUBLIC_GENERATE_SITE_STYLE_SHARED_SECRET;
    if (!secret) return;

    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/api/generate-site-style")) return originalFetch(input, init);

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
