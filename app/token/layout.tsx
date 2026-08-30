import type { ReactNode } from "react";
import "./token-page-reset.css";

/**
 * Deliberately does not import anything from `app/(app)/layout.tsx` — the
 * token page is a zero-friction, shareable public page for any token
 * (issue #203), not a screen inside the launchpad studio. Matches
 * `app/[slug]/layout.tsx`'s standalone pattern.
 *
 * The approved design (design/token-page-v2/hoodlums-token-page-v2.html,
 * issue #460) uses Inter for body/buttons, 'Archivo Black' for headings and
 * big figures, and 'IBM Plex Mono' for labels/numbers. Inter and IBM Plex
 * Mono are already loaded app-wide via app/globals.css, but this route
 * deliberately doesn't import that file (see below), and 'Archivo Black'
 * isn't loaded anywhere else in the app — so this route keeps its own font
 * link requesting exactly these three families. Next.js hoists `<link>`
 * tags rendered anywhere in the server tree into `<head>`, so these load
 * the same way the design reference itself does, scoped to just this route.
 */
export default function TokenPageLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap"
      />
      {children}
    </>
  );
}
