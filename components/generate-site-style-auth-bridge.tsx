"use client";

import { useEffect } from "react";
import { createWalletClient, custom } from "viem";
import { createUnsignedBespokeSiteAccessProof } from "@/lib/bespoke-site-access";
import { getInjectedEvmProvider } from "@/lib/wallet-provider";

const GENERATE_SITE_STYLE_HEADER = "x-hoodlums-api-key";
const PROTECTED_GENERATION_ROUTES = [
  "/api/generate-site-style",
  "/api/generate-site-page",
  "/api/generate-free-site",
] as const;
const BESPOKE_GENERATION_ROUTE = "/api/generate-site-page";

function requestPath(input: RequestInfo | URL): string {
  const value =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  try {
    return new URL(value, window.location.href).pathname;
  } catch {
    return value;
  }
}

function generationAbort(message: string): Error {
  window.dispatchEvent(
    new CustomEvent("launchpad:site-generation-failed", {
      detail: { message, previewAvailable: true },
    }),
  );
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

async function withBespokeWalletProof(init: RequestInit | undefined): Promise<RequestInit> {
  if (typeof init?.body !== "string") {
    throw generationAbort(
      "The bespoke generation request could not be prepared. Your free site generator remains available.",
    );
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(init.body) as Record<string, unknown>;
  } catch {
    throw generationAbort(
      "The bespoke generation request was invalid. Your free site generator remains available.",
    );
  }

  const provider = getInjectedEvmProvider();
  if (!provider) {
    throw generationAbort(
      "Connect the EVM wallet that owns Bond + Pro Site, Pro, or Pro Bundle to generate a bespoke AI design. The free site generator remains available.",
    );
  }

  try {
    const walletClient = createWalletClient({ transport: custom(provider) });
    const [walletAddress] = await walletClient.requestAddresses();
    if (!walletAddress) {
      throw new Error("The wallet returned no account.");
    }

    const { proof, message } = createUnsignedBespokeSiteAccessProof({
      walletAddress,
      origin: window.location.origin,
      project: body,
    });
    const signature = await walletClient.signMessage({
      account: walletAddress,
      message,
    });

    return {
      ...init,
      body: JSON.stringify({
        ...body,
        accessProof: { ...proof, signature },
      }),
    };
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    throw generationAbort(
      code === 4001
        ? "Wallet verification was cancelled. No funds were sent, and the free site generator remains available."
        : "The connected wallet could not prove plan access. No funds were sent, and the free site generator remains available.",
    );
  }
}

export function GenerateSiteStyleAuthBridge() {
  useEffect(() => {
    const secret = process.env.NEXT_PUBLIC_GENERATE_SITE_STYLE_SHARED_SECRET;
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(input);
      const protectedRoute = PROTECTED_GENERATION_ROUTES.includes(
        path as (typeof PROTECTED_GENERATION_ROUTES)[number],
      );
      if (!protectedRoute) return originalFetch(input, init);

      const nextInit =
        path === BESPOKE_GENERATION_ROUTE
          ? await withBespokeWalletProof(init)
          : { ...(init ?? {}) };
      const headers = new Headers(nextInit.headers);
      if (secret) headers.set(GENERATE_SITE_STYLE_HEADER, secret);

      const response = await originalFetch(input, { ...nextInit, headers });
      if (path === BESPOKE_GENERATION_ROUTE && response.status === 403) {
        const payload = (await response.clone().json().catch(() => ({}))) as {
          code?: unknown;
          message?: unknown;
        };
        if (payload.code === "bespoke-plan-required") {
          throw generationAbort(
            typeof payload.message === "string"
              ? payload.message
              : "Bespoke AI design requires Bond + Pro Site, Pro, or Pro Bundle. Your free site generator remains available.",
          );
        }
      }
      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
