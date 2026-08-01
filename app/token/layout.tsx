import type { ReactNode } from "react";
import "./token-page-reset.css";

/**
 * Deliberately does not import anything from `app/(app)/layout.tsx` — the
 * token page is a zero-friction, shareable public page for any token
 * (issue #203), not a screen inside the launchpad studio. Matches
 * `app/[slug]/layout.tsx`'s standalone pattern.
 */
export default function TokenPageLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
