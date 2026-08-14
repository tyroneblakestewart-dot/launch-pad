import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { SUBDOMAIN_REWRITE_HEADER } from "@/lib/subdomain-routing";
import { decideSubdomainRequest } from "@/lib/server/public-site-subdomain";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};

function page(title: string, heading: string, copy: string, action?: { href: string; label: string }) {
  const link = action
    ? `<a href="${action.href}">${action.label}</a>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${title}</title>
<style>
  :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:#071009;color:#f5f3e8;font-family:Arial,sans-serif}.card{width:min(100%,620px);border:1px solid #315c3c;border-radius:16px;padding:clamp(24px,6vw,48px);background:#0d1810;box-shadow:0 18px 60px rgba(0,0,0,.35)}.eyebrow{color:#8bd49c;font:700 12px/1.4 monospace;letter-spacing:.12em;text-transform:uppercase}h1{margin:14px 0;font-size:clamp(28px,7vw,48px);line-height:1.04}p{margin:0;color:#c6cec7;font-size:17px;line-height:1.65}a{display:inline-block;margin-top:24px;min-height:44px;padding:12px 18px;border-radius:8px;background:#2e7d3f;color:white;font-weight:800;text-decoration:none}
</style>
</head>
<body><main class="card"><span class="eyebrow">HOODLUMS · PUBLISHED SITE</span><h1>${heading}</h1><p>${copy}</p>${link}</main></body>
</html>`;
}

function notFoundResponse(reason: string) {
  return new NextResponse(
    page(
      "Subdomain not found",
      "This Hoodlums subdomain is not available.",
      reason,
      { href: "https://hoodlums.dev", label: "Return to Hoodlums" },
    ),
    { status: 404, headers: NO_STORE_HEADERS },
  );
}

export async function proxy(request: NextRequest) {
  const decision = await decideSubdomainRequest({
    host: request.headers.get("host"),
    pathname: request.nextUrl.pathname,
  });

  if (decision.kind === "next") return NextResponse.next();

  if (decision.kind === "rewrite") {
    if (request.nextUrl.searchParams.has("preview")) {
      return notFoundResponse(
        "Draft preview links remain available only at their normal hoodlums.dev/slug path and never acquire a wildcard subdomain.",
      );
    }

    const destination = request.nextUrl.clone();
    destination.pathname = decision.pathname;
    const headers = new Headers(request.headers);
    // Diagnostic only. This header is never trusted as an input because a
    // browser can forge request headers. Every request above is re-evaluated.
    headers.set(SUBDOMAIN_REWRITE_HEADER, decision.slug);
    return NextResponse.rewrite(destination, { request: { headers } });
  }

  if (decision.kind === "upgrade-required") {
    return new NextResponse(
      page(
        "Bond + Pro Site subdomain",
        "This site is published, but its subdomain is not active.",
        decision.message,
        { href: decision.pathUrl, label: `Open hoodlums.dev/${decision.slug}` },
      ),
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  if (decision.kind === "unavailable") {
    return new NextResponse(
      page(
        "Subdomain temporarily unavailable",
        "The paid-site access check could not complete.",
        "No site was exposed without a server entitlement decision. Use the normal hoodlums.dev path and try again shortly.",
        { href: "https://hoodlums.dev", label: "Open Hoodlums" },
      ),
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const reason =
    decision.reason === "disabled"
      ? "Wildcard routing is installed but has not been activated yet. Normal hoodlums.dev site paths continue to work."
      : decision.reason === "reserved"
        ? "That hostname is reserved for Hoodlums infrastructure and cannot be claimed by a token."
        : "No public token site is available at this hostname and path.";
  return notFoundResponse(reason);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
