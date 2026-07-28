import type { ReactNode } from "react";
import "./public-site-reset.css";

/**
 * Deliberately does not import anything from `app/(app)/layout.tsx` — a
 * published token site is a standalone public page, not a screen inside
 * the launchpad studio.
 */
export default function PublicSiteLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
