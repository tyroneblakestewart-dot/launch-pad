import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./admin-reset.css";

export const metadata: Metadata = {
  title: "Admin | HOODLUMS",
  description: "Private HOODLUMS platform control panel.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#050706",
};

/**
 * Deliberately does not import anything from `app/(app)/layout.tsx` — the
 * admin dashboard is a standalone private screen, not part of the public
 * studio nav chrome.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
