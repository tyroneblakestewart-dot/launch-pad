import type { ReactNode } from "react";
import { AccountOverlayShell } from "@/components/account-overlay-shell";
import { MobileBottomNavigation } from "@/components/app-navigation";

/**
 * Wires in the same account overlay and mobile bottom nav every other route
 * uses (issue #427), but NOT the desktop `AppNavigation` sidebar — issue
 * #443 part 1 makes this route full-screen so the header band can span the
 * entire viewport width with the v2 design's own margins, matching
 * `design/token-page-v2/hoodlums-token-page-v2.html`. Mobile keeps its
 * bottom pill nav (there's no competing full-width chrome to conflict with
 * on a phone). Deliberately does not pull in the rest of
 * `app/(app)/layout.tsx` (its global theme CSS, `WalletProviderSelector`,
 * ambient glow, etc.) — the token page keeps its own bespoke design system
 * (`token-page-reset.css`, Archivo/JetBrains Mono fonts) from
 * `app/token/layout.tsx`, only the account overlay and mobile nav are
 * shared.
 */
export default function TokenPageLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AccountOverlayShell />
      {children}
      <MobileBottomNavigation />
    </>
  );
}
