import type { ReactNode } from "react";
import { AccountOverlayShell } from "@/components/account-overlay-shell";

export default function TokenPageLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AccountOverlayShell />
      {children}
    </>
  );
}
