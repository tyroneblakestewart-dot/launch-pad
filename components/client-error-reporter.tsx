"use client";

import { usePathname } from "next/navigation";
import { Component, useEffect, useRef, type ErrorInfo, type ReactNode } from "react";
import { ACCOUNT_WALLET_STORAGE_KEY, parseStoredAccountWallet } from "@/lib/account-wallet-state";
import { sanitiseClientErrorMessage, sanitiseClientErrorStack } from "@/lib/client-error-sanitizer";
import { claimClientErrorSendSlot } from "@/lib/client-error-throttle";

// Client-side crash reporter (issue #353): global window.onerror /
// unhandledrejection handlers plus a React error boundary so a render crash
// reports instead of silently white-screening. Reporting is fire-and-forget
// and never throws or blocks the UI — every step below is defensively
// wrapped, and a throttle failure just means the report is skipped.

// Reads only the one already-established wallet-address key this app writes
// (see lib/account-wallet-state.ts) — not a general read of localStorage
// contents, which the privacy rules for this feature rule out.
function currentWalletAddress(): string | null {
  try {
    return parseStoredAccountWallet(localStorage.getItem(ACCOUNT_WALLET_STORAGE_KEY))?.account ?? null;
  } catch {
    return null;
  }
}

function reportClientError(rawMessage: string, rawStack: string | null, routePath: string): void {
  try {
    const message = sanitiseClientErrorMessage(rawMessage || "Unknown error");
    const key = `${routePath}::${message}`;
    if (!claimClientErrorSendSlot(key, sessionStorage)) return;

    const body = JSON.stringify({
      message,
      stack: rawStack ? sanitiseClientErrorStack(rawStack) : null,
      routePath,
      walletAddress: currentWalletAddress(),
      userAgent: navigator.userAgent,
      viewportWidth: window.innerWidth,
      buildId: process.env.NEXT_PUBLIC_CLIENT_ERROR_BUILD_ID || null,
    });

    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/client-errors", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Reporting must never itself throw or block the UI.
  }
}

type BoundaryProps = { routePath: string; children: ReactNode };
type BoundaryState = { hasError: boolean };

class ClientErrorBoundaryInner extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportClientError(error.message, error.stack ?? info.componentStack ?? null, this.props.routePath);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div role="alert" style={{ padding: 32, textAlign: "center" }}>
          <p>Something went wrong loading this page.</p>
          <button type="button" onClick={() => this.setState({ hasError: false })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function ClientErrorReporter({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const routePathRef = useRef(pathname || "/");

  useEffect(() => {
    routePathRef.current = pathname || "/";
  }, [pathname]);

  useEffect(() => {
    function onError(event: ErrorEvent): void {
      const error = event.error instanceof Error ? event.error : null;
      reportClientError(error?.message || event.message || "Unknown error", error?.stack ?? null, routePathRef.current);
    }
    function onUnhandledRejection(event: PromiseRejectionEvent): void {
      const error = event.reason instanceof Error ? event.reason : null;
      const message = error?.message || (typeof event.reason === "string" ? event.reason : "Unhandled promise rejection");
      reportClientError(message, error?.stack ?? null, routePathRef.current);
    }
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return <ClientErrorBoundaryInner routePath={pathname || "/"}>{children}</ClientErrorBoundaryInner>;
}
