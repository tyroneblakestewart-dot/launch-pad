import type { ReactNode } from "react";
import { AccountOverlayShell } from "@/components/account-overlay-shell";
import { AppNavigation, MobileBottomNavigation } from "@/components/app-navigation";

/**
 * Wires in the same site chrome every other route uses (issue #427) — the
 * token page previously rendered with no way back to the homepage, Hoodchat
 * or Support. Reuses `AppNavigation`/`MobileBottomNavigation` verbatim
 * (same components `app/(app)/layout.tsx` mounts) rather than duplicating
 * nav markup; their own CSS module already targets `body:has(.public-*)` /
 * `.full-generated-page-container` escape hatches for pages that must stay
 * chrome-free, so this route isn't one of those and just gets the standard
 * fixed sidebar / mobile header / bottom pill nav. Deliberately does not
 * pull in the rest of `app/(app)/layout.tsx` (its global theme CSS,
 * `WalletProviderSelector`, ambient glow, etc.) — the token page keeps its
 * own bespoke design system (`token-page-reset.css`, Archivo/JetBrains Mono
 * fonts) from `app/token/layout.tsx`, only the navigation itself is shared.
 */
export default function TokenPageLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppNavigation />
      <AccountOverlayShell />
      {children}
      <MobileBottomNavigation />
    </>
  );
}
