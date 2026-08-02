import type { ReactNode } from "react";
import "./token-page-reset.css";

/**
 * Deliberately does not import anything from `app/(app)/layout.tsx` — the
 * token page is a zero-friction, shareable public page for any token
 * (issue #203), not a screen inside the launchpad studio. Matches
 * `app/[slug]/layout.tsx`'s standalone pattern.
 *
 * The approved design (public/design-refs/hoodlums-token-page.html, issue
 * #225) uses Archivo/Archivo Black headings and JetBrains Mono labels,
 * which aren't loaded anywhere else in this app (the rest of the studio
 * uses system fonts) — Next.js hoists `<link>` tags rendered anywhere in
 * the server tree into `<head>`, so these load the same way the design
 * reference itself does, scoped to just this route.
 */
export default function TokenPageLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;900&family=Archivo+Black&family=JetBrains+Mono:wght@400;500;700&display=swap"
      />
      {children}
    </>
  );
}
