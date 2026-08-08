type PaymentOriginEnvironment = Record<string, string | undefined>;

export type PlanPaymentOriginIntent = "send" | "verify";

export type PlanPaymentOriginDecision = {
  allowed: boolean;
  requestOrigin: string | null;
  primaryOrigin: string | null;
  isPreview: boolean;
  previewPaymentsEnabled: boolean;
  intent: PlanPaymentOriginIntent;
  reason: string;
};

function normaliseOrigin(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
      return null;
    }
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function vercelSystemOrigin(value: string | undefined): string | null {
  const host = value
    ?.trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  if (!host || !/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) return null;
  return `https://${host.toLowerCase()}`;
}

function configuredPaymentOrigins(environment: PaymentOriginEnvironment): string[] {
  const origins = new Set<string>();
  const appOrigin = normaliseOrigin(environment.HOODLUMS_APP_ORIGIN);
  if (appOrigin) origins.add(appOrigin);

  for (const raw of (environment.HOODLUMS_PAYMENT_ALLOWED_ORIGINS || "").split(",")) {
    const origin = normaliseOrigin(raw);
    if (origin) origins.add(origin);
  }
  return [...origins];
}

export function getPlanPaymentOriginDecision(
  request: Request,
  intent: PlanPaymentOriginIntent = "verify",
  environment: PaymentOriginEnvironment = process.env,
): PlanPaymentOriginDecision {
  const requestOrigin = normaliseOrigin(request.headers.get("origin"));
  const requestUrlOrigin = normaliseOrigin(new URL(request.url).origin);
  const configured = configuredPaymentOrigins(environment);
  const isPreview = environment.VERCEL_ENV === "preview";
  const previewPaymentsEnabled = environment.HOODLUMS_PAYMENT_ALLOW_VERCEL_PREVIEWS === "true";

  const allowedOrigins = new Set(configured);
  if (isPreview) {
    // Preview verification/recovery is safe to allow because it cannot move funds:
    // the server still requires the exact on-chain transfer and a wallet signature
    // bound to this preview origin. Sending a new real payment remains blocked by
    // default and requires an explicit environment opt-in.
    if (intent === "verify" || previewPaymentsEnabled) {
      if (requestUrlOrigin) allowedOrigins.add(requestUrlOrigin);
      const deploymentOrigin = vercelSystemOrigin(environment.VERCEL_URL);
      const branchOrigin = vercelSystemOrigin(environment.VERCEL_BRANCH_URL);
      if (deploymentOrigin) allowedOrigins.add(deploymentOrigin);
      if (branchOrigin) allowedOrigins.add(branchOrigin);
    }
  } else if (requestUrlOrigin) {
    // Production and local development may use their own same-origin host in
    // addition to configured canonical origins.
    allowedOrigins.add(requestUrlOrigin);
  }

  const primaryOrigin = normaliseOrigin(environment.HOODLUMS_APP_ORIGIN) || requestUrlOrigin;
  if (!requestOrigin) {
    return {
      allowed: false,
      requestOrigin: null,
      primaryOrigin,
      isPreview,
      previewPaymentsEnabled,
      intent,
      reason: "The browser did not provide a valid payment request origin.",
    };
  }

  if (allowedOrigins.has(requestOrigin)) {
    return {
      allowed: true,
      requestOrigin,
      primaryOrigin,
      isPreview,
      previewPaymentsEnabled,
      intent,
      reason: "Payment origin is allowed.",
    };
  }

  const reason = isPreview && intent === "send" && !previewPaymentsEnabled
    ? `Real payments are disabled on Vercel previews. Open ${primaryOrigin || "the production Hoodlums site"} to pay. Existing transaction hashes can still be recovered without sending a second payment.`
    : `Payments are not allowed from ${requestOrigin}. Open ${primaryOrigin || "the approved Hoodlums origin"} to continue.`;

  return {
    allowed: false,
    requestOrigin,
    primaryOrigin,
    isPreview,
    previewPaymentsEnabled,
    intent,
    reason,
  };
}

export function isPlanPaymentOriginAllowed(
  request: Request,
  intent: PlanPaymentOriginIntent = "verify",
  environment: PaymentOriginEnvironment = process.env,
): boolean {
  return getPlanPaymentOriginDecision(request, intent, environment).allowed;
}
