"use client";

import { useEffect } from "react";
import { createWalletClient, custom } from "viem";
import {
  BESPOKE_SITE_UPSELL_EVENT,
  type BespokeSiteChallengeResponse,
  type BespokeSiteUpsellEventDetail,
} from "@/lib/bespoke-site-access";
import { getInjectedEvmProvider } from "@/lib/wallet-provider";

const GENERATE_SITE_STYLE_HEADER = "x-hoodlums-api-key";
const PROTECTED_GENERATION_ROUTES = [
  "/api/generate-site-style",
  "/api/generate-site-page/challenge",
  "/api/generate-site-page",
  "/api/generate-free-site",
] as const;
const BESPOKE_CHALLENGE_ROUTE = "/api/generate-site-page/challenge";
const BESPOKE_GENERATION_ROUTE = "/api/generate-site-page";
const FALLBACK_UPSELL =
  "Bespoke AI design requires Bond + Pro Site, Pro, or Pro Bundle. Your free artwork-matched site remains available.";

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

function showUpgrade(message: string): Error {
  window.dispatchEvent(
    new CustomEvent<BespokeSiteUpsellEventDetail>(BESPOKE_SITE_UPSELL_EVENT, {
      detail: { message, checkoutPlan: "bond-pro-site" },
    }),
  );
  return generationAbort(message);
}

function protectedHeaders(
  init: RequestInit | undefined,
  secret: string | undefined,
): Headers {
  const headers = new Headers(init?.headers);
  if (secret) headers.set(GENERATE_SITE_STYLE_HEADER, secret);
  return headers;
}

async function responsePayload(response: Response): Promise<{
  code?: unknown;
  error?: unknown;
  message?: unknown;
}> {
  return response.clone().json().catch(() => ({}));
}

async function withBespokeWalletProof(input: {
  init: RequestInit | undefined;
  originalFetch: typeof window.fetch;
  secret: string | undefined;
}): Promise<RequestInit> {
  const { init, originalFetch, secret } = input;
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
    throw showUpgrade(
      "Bespoke AI design is a premium feature. Connect the wallet that already owns access, or continue to the Bond + Pro Site checkout; the free site generator remains available.",
    );
  }

  const walletClient = createWalletClient({ transport: custom(provider) });
  let walletAddress: `0x${string}`;
  try {
    const [account] = await walletClient.requestAddresses();
    if (!account) throw new Error("The wallet returned no account.");
    walletAddress = account;
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    throw generationAbort(
      code === 4001
        ? "Wallet connection was cancelled. No funds were sent, and the free site generator remains available."
        : "The wallet could not be connected for plan verification. No funds were sent, and the free site generator remains available.",
    );
  }

  const challengeResponse = await originalFetch(BESPOKE_CHALLENGE_ROUTE, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: protectedHeaders(
      { headers: { "Content-Type": "application/json" } },
      secret,
    ),
    body: JSON.stringify({ walletAddress, project: body }),
  });

  if (!challengeResponse.ok) {
    const payload = await responsePayload(challengeResponse);
    const message =
      typeof payload.message === "string"
        ? payload.message
        : typeof payload.error === "string"
          ? payload.error
          : "Bespoke plan access could not be checked. Your free site generator remains available.";
    if (challengeResponse.status === 403 && payload.code === "bespoke-plan-required") {
      throw showUpgrade(message || FALLBACK_UPSELL);
    }
    throw generationAbort(message);
  }

  const challenge =
    (await challengeResponse.json()) as BespokeSiteChallengeResponse;
  if (
    typeof challenge.challengeId !== "string" ||
    typeof challenge.nonce !== "string" ||
    typeof challenge.message !== "string"
  ) {
    throw generationAbort(
      "The one-time wallet approval was invalid. No AI generation was started.",
    );
  }

  let signature: `0x${string}`;
  try {
    signature = await walletClient.signMessage({
      account: walletAddress,
      message: challenge.message,
    });
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    throw generationAbort(
      code === 4001
        ? "Wallet verification was cancelled. No funds were sent, and the free site generator remains available."
        : "The connected wallet could not sign the one-time bespoke approval. No funds were sent, and the free site generator remains available.",
    );
  }

  return {
    ...init,
    body: JSON.stringify({
      ...body,
      accessProof: {
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        signature,
      },
    }),
  };
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
          ? await withBespokeWalletProof({ init, originalFetch, secret })
          : { ...(init ?? {}) };
      const headers = protectedHeaders(nextInit, secret);

      const response = await originalFetch(input, { ...nextInit, headers });
      if (path === BESPOKE_GENERATION_ROUTE && response.status === 403) {
        const payload = await responsePayload(response);
        if (payload.code === "bespoke-plan-required") {
          throw showUpgrade(
            typeof payload.message === "string"
              ? payload.message
              : FALLBACK_UPSELL,
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
