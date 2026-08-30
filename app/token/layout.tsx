import type { ReactNode } from "react";
import "./token-page-reset.css";

/**
 * Deliberately does not import anything from `app/(app)/layout.tsx` — the
 * token page is a zero-friction, shareable public page for any token
 * (issue #203), not a screen inside the launchpad studio. Matches
 * `app/[slug]/layout.tsx`'s standalone pattern.
 *
 * The approved v2 design (design/token-page-v2/hoodlums-token-page-v2.html,
 * issue #443/#455) specifies Inter for body/buttons, 'Archivo Black' for
 * headings/big figures, and 'IBM Plex Mono' for labels/numbers. Inter and
 * IBM Plex Mono are already loaded app-wide by `app/globals.css` (imported
 * from `app/(app)/layout.tsx`) — but this route deliberately opts out of
 * that layout, so they aren't actually available here without their own
 * link tag. Rather than add a second, competing font dependency, this link
 * requests the exact same two families (matching `app/globals.css`'s own
 * weight list) alongside Archivo Black — no new font is introduced anywhere
 * in the app. Next.js hoists `<link>` tags rendered anywhere in the server
 * tree into `<head>`, so these load the same way the design reference
 * itself does, scoped to just this route.
 */
export default function TokenPageLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600;700;800&display=swap"
      />
      {children}
    </>
  );
}
